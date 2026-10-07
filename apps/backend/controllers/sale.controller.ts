import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import {
  invalidateCache,
  getOrSetCache,
  getCacheVersion,
  bumpCacheVersion,
  buildPaginatedKey,
} from "../lib/redis.js";
import { Sale } from "../models/Sale.js";
import { ExchangeRate } from "../models/ExchangeRate.js";
import { SaleDetail } from "../models/SaleDetail.js";
import {
  createSaleProcess,
  fetchSaleById,
  cancelSaleProcess,
  updateSaleProcess,
} from "../services/sale.service.js";
import { BranchId, CustomerId } from "../types/brands.js";
import { withTransactionRetry } from "../utils/transaction-retry.js";

// Venezuela = UTC-4. El backend corre en UTC (Vercel).
// Sin esta corrección, setHours(0,0,0,0) pondría la medianoche en UTC,
// causando un desfase de 4h → "Ayer" mostraría ventas del día equivocado.
const VE_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Devuelve { start, end } en UTC correspondientes al inicio y fin
 * del día `offsetDays` relativo a hoy en hora Venezuela.
 * offsetDays = 0 → hoy VE, -1 → ayer VE, -6 → hace 6 días VE, etc.
 */
function dayRangeVE(offsetDays = 0): { start: Date; end: Date } {
  const nowVE = new Date(Date.now() - VE_OFFSET_MS);
  const y = nowVE.getUTCFullYear();
  const m = nowVE.getUTCMonth();
  const d = nowVE.getUTCDate() + offsetDays;
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) + VE_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) + VE_OFFSET_MS);
  return { start, end };
}

export const createSale = async (req: Request, res: Response): Promise<any> => {
  // Se garantiza existencia previa vía requireBranchHeader
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const branchId = req.branchId!;

  // injectBusinessContext resolvió:
  //   req.businessOwnerId = ID del dueño del negocio (tenant)
  //   req.actorId = ID real de quien hizo login (empleado o dueño)
  const ownerId = req.businessOwnerId;
  const soldBy = req.actorId;

  // 🔒 Validación cruzada de sucursal para empleados:
  if (req.userRole === "employee") {
    const authorized = req.assignedBranches ?? [];
    if (!authorized.includes(String(branchId))) {
      const err: any = new Error(
        "Acceso denegado: No tienes autorización para operar en esta sucursal.",
      );
      err.status = 403;
      throw err;
    }
  }

  const { items, payment_method, exchange_rate, customer_id } = req.body;

  // Validación Just-In-Time (JIT) de la tasa de cambio
  if (exchange_rate != null) {
    const latestRateDoc = await ExchangeRate.findOne({ customer_id: ownerId })
      .sort({ date: -1 })
      .lean();
    const currentBackendRate = latestRateDoc?.rate ?? null;

    if (currentBackendRate !== null) {
      const currentRateNum = Number(currentBackendRate.toString());
      const incomingRateNum = Number(exchange_rate);
      // Tolerancia de punto flotante
      if (Math.abs(currentRateNum - incomingRateNum) > 0.001) {
        const err: any = new Error(
          "La tasa de cambio ha sido actualizada en el servidor. Por favor, actualiza la caja registradora.",
        );
        err.status = 409;
        err.codeString = "EXCHANGE_RATE_MISMATCH";
        err.current_rate = currentBackendRate;
        throw err;
      }
    }
  }

  try {
    const sale = await withTransactionRetry((session) => {
      const customerId = customer_id
        ? (new Types.ObjectId(customer_id) as unknown as CustomerId)
        : null;

      return createSaleProcess(
        ownerId,
        soldBy,
        branchId,
        items,
        payment_method,
        exchange_rate,
        req.cashShift?._id,
        customerId,
        session,
      );
    });

    // Invalidar caché paginada de ventas y productos
    const keysToInvalidate: string[] = [];
    for (const item of items) {
      keysToInvalidate.push(`product:${item.product_id}:${ownerId}`);
    }
    await Promise.all([
      bumpCacheVersion("sales", String(ownerId)),
      keysToInvalidate.length > 0
        ? invalidateCache(...keysToInvalidate)
        : Promise.resolve(),
    ]);

    return {
      success: true,
      message: "Venta registrada exitosamente",
      sale,
    };
  } catch (error: any) {
    console.error("CREATE SALE ERROR:", error);
    let status = 500;
    if (
      error.message.includes("Stock insuficiente") ||
      error.message.includes("Freno de emergencia")
    )
      status = 400;
    else if (error.message.includes("no encontrado")) status = 404;

    error.status = status;
    throw error;
  }
};

export const getSales = async (req: Request, res: Response): Promise<any> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string) || 20),
    );
    const skip = (page - 1) * limit;

    // Usar contexto inyectado por injectBusinessContext (evita consulta redundante a DB)
    const isEmployee = req.userRole === "employee";
    const ownerId = req.businessOwnerId;

    // ── Filtro de sucursal (Validación Estricta Fail-Closed) ────────────────
    let branchIdFilter: string | null = null;

    if (isEmployee) {
      // 1. Bloqueo por defecto: Si no hay sucursales asignadas en DB, acceso denegado.
      if (!req.assignedBranches || req.assignedBranches.length === 0) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Acceso denegado: Empleado sin sucursales asignadas.",
          });
      }

      // 2. Extraemos la sucursal activa de la sesión (header x-branch-id inyectado por Axios)
      const requestedBranch = req.branchId ? req.branchId.toString() : null;

      // 3. Validación criptográfica: Intersección estricta.
      if (!requestedBranch || !req.assignedBranches.includes(requestedBranch)) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Acceso denegado: No tienes permiso para consultar esta sucursal o no declaraste contexto de sucursal.",
          });
      }

      // Asignación directa y singular, sin $in
      branchIdFilter = requestedBranch;
    } else {
      // Dueño (Tenant): puede filtrar explícitamente por query param o ver todas.
      branchIdFilter = (req.query.branchId as string) || null;
    }

    // Empleado: ve solo SUS ventas (sold_by) dentro del scope del dueño
    // Dueño:    ve todas las ventas de su negocio + filtro opcional por vendedor
    const sellerId =
      !isEmployee && req.query.seller ? (req.query.seller as string) : null;
    const paymentMethod = isEmployee
      ? null
      : (req.query.paymentMethod as string) || null;

    // --- Resolver filtro de fechas ---
    let dateFrom = req.query.dateFrom as string | null;
    let dateTo = req.query.dateTo as string | null;
    let dateFilterParam = req.query.dateFilter as string | undefined; // today | 7days | 30days | month | custom | all

    // Restricciones para el empleado: solo ventas del día de hoy
    if (isEmployee) {
      dateFilterParam = "today";
      dateFrom = null;
      dateTo = null;
    }
    let dateFilter: Record<string, Date> | null = null;

    // Períodos rápidos → calcular rango en hora Venezuela (UTC-4)
    if (
      dateFilterParam &&
      dateFilterParam !== "all" &&
      dateFilterParam !== "custom"
    ) {
      if (dateFilterParam === "today") {
        const { start, end } = dayRangeVE(0);
        dateFilter = { $gte: start, $lte: end };
      } else if (dateFilterParam === "ayer") {
        const { start, end } = dayRangeVE(-1);
        dateFilter = { $gte: start, $lte: end };
      } else if (dateFilterParam === "7days") {
        const { start } = dayRangeVE(-6);
        const { end } = dayRangeVE(0);
        dateFilter = { $gte: start, $lte: end };
      } else if (dateFilterParam === "30days") {
        const { start } = dayRangeVE(-29);
        const { end } = dayRangeVE(0);
        dateFilter = { $gte: start, $lte: end };
      } else if (dateFilterParam === "month") {
        const nowVE = new Date(Date.now() - VE_OFFSET_MS);
        const firstDay = new Date(
          Date.UTC(nowVE.getUTCFullYear(), nowVE.getUTCMonth(), 1, 0, 0, 0, 0) +
            VE_OFFSET_MS,
        );
        const { end } = dayRangeVE(0);
        dateFilter = { $gte: firstDay, $lte: end };
      }

      // Rango manual (custom) → usar dateFrom / dateTo
    } else if (dateFrom || dateTo) {
      dateFilter = {} as Record<string, Date>;
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (!isNaN(from.getTime())) dateFilter.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (!isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999);
          dateFilter.$lte = to;
        }
      }
    }

    // Scope de caché separado por empleado para evitar cruzar datos entre usuarios
    const cacheScope = isEmployee
      ? `${ownerId}:emp:${req.actorId}`
      : String(ownerId);

    const version = await getCacheVersion("sales", String(ownerId));
    // Incluir el rango de fechas en el cache key para que no colisionen rangos distintos
    const dateSegment =
      dateFilterParam && dateFilterParam !== "all"
        ? `:df${dateFilterParam}`
        : dateFrom || dateTo
          ? `:df${dateFrom || ""}:dt${dateTo || ""}`
          : "";
    // Incluir segmento de sucursal en la cache key para evitar colisiones entre sesiones
    const branchSegment = branchIdFilter ? `:br${branchIdFilter}` : "";
    const cacheKey =
      buildPaginatedKey("sales", version, page, limit, cacheScope) +
      (sellerId ? `:s${sellerId}` : "") +
      (paymentMethod && paymentMethod !== "all" ? `:pm${paymentMethod}` : "") +
      dateSegment +
      branchSegment;

    const { data, fromCache } = await getOrSetCache(
      cacheKey,
      async () => {
        const filter: Record<string, unknown> = {};

        if (isEmployee) {
          // Empleado: ventas donde ÉL fue el vendedor, acotadas a sus sucursales autorizadas
          filter.business_owner_id = ownerId;
          filter.sold_by = req.actorId;
          // 🔒 Restricción de sucursal (Fail-Closed garantizado arriba)
          if (branchIdFilter) {
            filter.branch_id = branchIdFilter;
          }
        } else {
          // Dueño: todas las ventas de su negocio, con filtros opcionales por vendedor y sucursal
          filter.business_owner_id = req.businessOwnerId;
          if (sellerId) filter.sold_by = sellerId;
          // Filtro opcional por sucursal específica (seleccionada en el frontend)
          if (branchIdFilter && typeof branchIdFilter === "string") {
            filter.branch_id = branchIdFilter;
          }
        }

        // Aplicar rango de fechas al campo createdAt
        if (dateFilter) filter.createdAt = dateFilter;

        // Aplicar filtro de método de pago (exacto, gracias al enum estandarizado)
        if (paymentMethod && paymentMethod !== "all") {
          filter.payment_method = paymentMethod;
        }

        // Para el aggregation pipeline es estrictamente necesario que los IDs sean ObjectId
        const aggFilter = { ...filter } as Record<string, unknown>;
        if (aggFilter.business_owner_id)
          aggFilter.business_owner_id = new mongoose.Types.ObjectId(
            aggFilter.business_owner_id as string,
          );
        if (aggFilter.sold_by)
          aggFilter.sold_by = new mongoose.Types.ObjectId(
            aggFilter.sold_by as string,
          );
        // branch_id puede ser un string directo o un { $in: string[] }
        if (aggFilter.branch_id) {
          const brVal = aggFilter.branch_id as string | { $in: string[] };
          if (typeof brVal === "string") {
            aggFilter.branch_id = new mongoose.Types.ObjectId(brVal);
          } else if (brVal && typeof brVal === "object" && "$in" in brVal) {
            aggFilter.branch_id = {
              $in: (brVal.$in as string[]).map(
                (id) => new mongoose.Types.ObjectId(id),
              ),
            };
          }
        }

        const [sales, total, totalAmountAgg] = await Promise.all([
          Sale.find(filter)
            .populate("customer_id", "name email")
            .populate("sold_by", "name email")
            .populate("branch_id", "name")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
          Sale.countDocuments(filter),
          Sale.aggregate([
            { $match: aggFilter },
            { $group: { _id: null, totalAmount: { $sum: "$total_amount" } } },
          ]),
        ]);

        const totalAmount =
          totalAmountAgg.length > 0 ? totalAmountAgg[0].totalAmount : 0;

        return {
          sales,
          total,
          totalAmount,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
        };
      },
      120,
    );

    res.status(200).json({
      success: true,
      sales: data.sales,
      total: data.total,
      totalAmount: data.totalAmount,
      totalPages: data.totalPages,
      currentPage: data.currentPage,
      fromCache,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getSaleById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    // Usar contexto inyectado por injectBusinessContext
    const isEmployee = req.userRole === "employee";
    const cacheKey = `sale:${id}:${req.actorId}`;

    // Empleado → busca por sold_by (su ID real)
    // Dueño   → busca por customer_id (ownerId)
    const lookupId = isEmployee ? req.actorId : req.businessOwnerId;

    const { data, fromCache } = await getOrSetCache(
      cacheKey,
      () => fetchSaleById(id as string, lookupId, isEmployee),
      300,
    );

    if (!data) {
      res.status(404).json({ success: false, message: "Venta no encontrada" });
      return;
    }

    res.status(200).json({ success: true, sale: data, fromCache });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cancelSale = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    // Restricción estricta: Los empleados no pueden anular ventas
    if (req.userRole === "employee") {
      res
        .status(403)
        .json({
          success: false,
          message: "Los empleados no tienen permisos para anular ventas.",
        });
      return;
    }

    const ownerId = req.businessOwnerId;

    const cancelledSale = await withTransactionRetry(() =>
      cancelSaleProcess(id as string, ownerId),
    );

    // Invalidar caché (ventas, productos y la venta específica)
    await Promise.all([
      bumpCacheVersion("sales", String(ownerId)),
      invalidateCache(`sale:${id}:${req.actorId}`),
    ]);

    res.status(200).json({
      success: true,
      message: "Venta anulada exitosamente y stock restaurado",
      sale: cancelledSale,
    });
  } catch (error: any) {
    res
      .status(error.message.includes("encontrada") ? 404 : 400)
      .json({ success: false, message: error.message });
  }
};

export const updateSale = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { items, payment_method } = req.body;

    // Solo dueños pueden editar
    if (req.userRole === "employee") {
      res
        .status(403)
        .json({
          success: false,
          message: "Los empleados no tienen permisos para editar ventas.",
        });
      return;
    }

    const ownerId = req.businessOwnerId;

    // El servicio transaccional maneja stock, SaleDetails y campos simples en una sola sesión ACID
    const updatedSale = await withTransactionRetry(() =>
      updateSaleProcess(id as string, ownerId, { items, payment_method }),
    );

    // Invalidar caché de ventas, productos (si hubo cambios de stock) y la venta individual
    await Promise.all([
      bumpCacheVersion("sales", String(ownerId)),
      invalidateCache(`sale:${id}:${req.actorId}`),
    ]);

    res.status(200).json({
      success: true,
      message: "Venta actualizada exitosamente",
      sale: updatedSale,
    });
  } catch (error: any) {
    let status = 500;
    if (error.message.includes("encontrada")) status = 404;
    else if (
      error.message.includes("insuficiente") ||
      error.message.includes("anulada")
    )
      status = 400;
    res.status(status).json({ success: false, message: error.message });
  }
};

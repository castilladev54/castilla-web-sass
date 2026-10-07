import mongoose from "mongoose";
import Big from "big.js";
import { Sale } from "../models/Sale.js";
import { SaleDetail } from "../models/SaleDetail.js";
import { Product } from "../models/Product.js";
import { Inventory } from "../models/Inventory.js";
import { StockMovement, StockMovementType } from "../models/StockMovement.js";
import { Branch } from "../models/Branch.js";
import { Customer } from "../models/Customer.js";
import {
  BusinessOwnerId,
  ActorId,
  ProductId,
  BranchId,
  CustomerId,
} from "../types/brands.js";
import type { PaymentMethod } from "@inventory/shared";
import { bumpBranchCacheVersion } from "../lib/redis.js";
import { InsufficientStockError } from "../errors/InsufficientStockError.js";
// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface SaleItemInput {
  product_id: ProductId;
  quantity: string;
  unit_price: string;
}

// PaymentMethod importado de @inventory/shared

// ─── Crear Venta ─────────────────────────────────────────────────────────────

/**
 * Servicio transaccional para crear ventas.
 *
 * Garantías ACID:
 *   - Verifica que la sucursal destino existe y se encuentra activa (is_active: true)
 *   - Verifica ownership del producto (filtro tenant: user === businessOwnerId)
 *   - Decrementa BranchInventory.stock de forma atómica y condicionada a stock suficiente ($gte)
 *   - Si cualquier paso falla, MongoDB revierte todos los cambios
 *
 * @param businessOwnerId  ID del dueño del negocio (tenant)
 * @param soldBy           ID del operador que registra la venta
 * @param branchId         ID de la sucursal desde la que se vende (OBLIGATORIO)
 * @param items            Líneas de la venta
 * @param payment_method   Método de pago
 * @param exchange_rate    Tasa de cambio opcional
 * @param shiftId          ID del turno de caja activo (inyectado por ensureCashShiftOpen)
 */
export const createSaleProcess = async (
  businessOwnerId: BusinessOwnerId,
  soldBy: ActorId,
  branchId: BranchId,
  items: SaleItemInput[],
  payment_method: PaymentMethod,
  exchange_rate: string | null,
  shiftId: mongoose.Types.ObjectId | undefined,
  customerId: CustomerId | null,
  session: mongoose.ClientSession,
) => {
  // 0. Validar que la sucursal existe y está activa
  const branch = await Branch.findOne({
    _id: branchId,
    owner_id: businessOwnerId,
    is_active: true,
  }).session(session);

  if (!branch) {
    throw new Error("La sucursal de venta no existe o se encuentra inactiva.");
  }

  let total_amount = "0";

  // OPTIMIZACIÓN: una sola consulta trae todos los productos (evita N+1).
  // El filtro de tenant (user === businessOwnerId) garantiza aislamiento multi-tenant.
  const productIds = items.map((i) => i.product_id);
  const products = await Product.find({
    _id: { $in: productIds },
    user: businessOwnerId,
  })
    .populate("category", "max_debt_limit")
    .session(session);
  const productsMap = new Map(products.map((p) => [p._id.toString(), p]));

  // Validar existencia/dueño de productos y computar total antes de modificar
  for (const item of items) {
    const product = productsMap.get(item.product_id.toString());
    if (!product) {
      throw new Error(
        `Producto con ID ${item.product_id} no encontrado o no te pertenece.`,
      );
    }

    // Fase 8: Backend Domain Validation
    const qty = Big(item.quantity);

    if (qty.lte(0)) {
      throw new Error(
        `La cantidad para el producto ${product.name} debe ser mayor a cero.`,
      );
    }
    if (product.unit_type === "unidad") {
      if (!qty.eq(qty.round(0, 0))) {
        // round mode 0 is ROUND_DOWN
        throw new Error(
          `El producto ${product.name} se vende por unidades y no acepta decimales.`,
        );
      }
    }

    const lineTotal = qty.times(Big(item.unit_price));
    total_amount = Big(total_amount).plus(lineTotal).toString();
  }

  // Decrementar stock en BranchInventory — mutación atómica.
  // El filtro $gte integra la validación de stock suficiente directamente en
  // la consulta de escritura, eliminando la ventana de race condition del
  // patrón Read-Modify-Write.
  for (const item of items) {
    const product = productsMap.get(item.product_id.toString())!;
    const qtyDecimal = mongoose.Types.Decimal128.fromString(item.quantity);
    const negQtyDecimal = mongoose.Types.Decimal128.fromString(
      Big(item.quantity).times(-1).toString(),
    );

    // TODO: Ajustar según tu regla de dominio real
    const allowNegativeStock = false;

    const preInventory = await Inventory.findOne({
      branch_id: branchId,
      product_id: item.product_id,
      owner_id: businessOwnerId,
    }).session(session);
    const previousQuantity =
      preInventory?.quantity ?? mongoose.Types.Decimal128.fromString("0");

    let result = await Inventory.findOneAndUpdate(
      {
        branch_id: branchId,
        product_id: item.product_id,
        owner_id: businessOwnerId,
        quantity: { $gte: qtyDecimal },
      },
      { $inc: { quantity: negQtyDecimal } },
      { session, new: true },
    );

    if (!result) {
      if (!allowNegativeStock) {
        throw new InsufficientStockError(
          product.name,
          item.product_id.toString(),
        );
      }

      result = await Inventory.findOneAndUpdate(
        {
          branch_id: branchId,
          product_id: item.product_id,
          owner_id: businessOwnerId,
        },
        {
          $inc: { quantity: negQtyDecimal },
          $setOnInsert: {
            min_stock_alert: mongoose.Types.Decimal128.fromString("0"),
          },
        },
        { session, new: true, upsert: true },
      );
    }

    if (!result) throw new Error("Error al actualizar inventario en la venta");
    // Registrar movimiento de stock (event sourcing)
    await StockMovement.create(
      [
        {
          inventory_id: result._id,
          product_id: item.product_id,
          branch_id: branchId,
          owner_id: businessOwnerId,
          type: StockMovementType.SALE,
          quantity_change: negQtyDecimal,
          previous_quantity: previousQuantity,
          new_quantity: result.quantity,
          reference_id: undefined, // se enlazará a la venta después de crearla
          created_by: soldBy,
        },
      ],
      { session },
    );
  }

  // Crear el documento de Venta (shift_id proviene del middleware de turno activo)
  const sale = new Sale({
    shift_id: shiftId,
    business_owner_id: businessOwnerId,
    customer_id: customerId ?? null,
    sold_by: soldBy,
    branch_id: branchId,
    total_amount,
    payment_method: (payment_method === "Pago Móvil"
      ? "Pago Movil"
      : payment_method) as any,
    exchange_rate,
    status: "completed",
  });
  await sale.save({ session });

  for (const item of items) {
    const detail = new SaleDetail({
      sale_id: sale._id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
    });

    await detail.save({ session });
  }

  await bumpBranchCacheVersion(
    "products",
    String(businessOwnerId),
    String(branchId),
  );

  return sale;
};

// ─── Listar Ventas ────────────────────────────────────────────────────────────

export const fetchSales = async (
  businessOwnerId: BusinessOwnerId,
  sellerId: ActorId | null = null,
) => {
  const filter: Record<string, unknown> = { business_owner_id: businessOwnerId };
  if (sellerId) filter.sold_by = sellerId;

  return Sale.find(filter)
    .populate("customer_id", "name email")
    .populate("sold_by", "name email")
    .sort({ createdAt: -1 })
    .lean();
};

// ─── Detalle de una Venta ─────────────────────────────────────────────────────

export const fetchSaleById = async (
  id: string,
  businessOwnerId: BusinessOwnerId,
  isEmployee = false,
) => {
  const filter = isEmployee
    ? { _id: id, sold_by: businessOwnerId }
    : { _id: id, business_owner_id: businessOwnerId };

  const sale = await Sale.findOne(filter)
    .populate("customer_id", "name email")
    .populate("sold_by", "name email")
    .lean();

  if (!sale) return null;

  const items = await SaleDetail.find({ sale_id: id })
    .populate("product_id", "name price")
    .lean();

  return { ...sale, items };
};

// ─── Editar Venta ─────────────────────────────────────────────────────────────

export interface UpdateSaleInput {
  items?: SaleItemInput[];
  payment_method?: PaymentMethod;
  branchId?: BranchId;
}

/**
 * Servicio Transaccional para Editar una Venta.
 *
 * Estrategia de stock sobre Inventory (dentro de una sola transacción ACID):
 *   1. Restaurar el stock de los ítems ORIGINALES en Inventory.
 *   2. Validar disponibilidad y descontar el stock de los NUEVOS ítems.
 *   3. Reemplazar los SaleDetail y actualizar la venta.
 */
export const updateSaleProcess = async (
  saleId: string,
  ownerId: BusinessOwnerId,
  { items, payment_method, branchId }: UpdateSaleInput,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sale = await Sale.findOne({
      _id: saleId,
      business_owner_id: ownerId,
    }).session(session);
    if (!sale)
      throw new Error("Venta no encontrada o no pertenece a tu negocio.");
    if (sale.status === "cancelled")
      throw new Error("No se puede editar una venta anulada.");

    // Usar el branchId de la venta original si no se especifica uno nuevo
    const effectiveBranchId = (branchId ?? sale.branch_id) as BranchId;

    // Validar que la sucursal de destino existe y se encuentra activa
    const branch = await Branch.findOne({
      _id: effectiveBranchId,
      owner_id: ownerId,
      is_active: true,
    }).session(session);

    if (!branch) {
      throw new Error(
        "La sucursal de destino no existe o se encuentra inactiva.",
      );
    }

    if (items && items.length > 0) {
      // 1. Restaurar stock original en Inventory (usando upsert por seguridad si el registro fue borrado)
      const originalDetails = await SaleDetail.find({
        sale_id: saleId,
      }).session(session);
      for (const detail of originalDetails) {
        await Inventory.findOneAndUpdate(
          {
            branch_id: effectiveBranchId,
            product_id: detail.product_id,
            owner_id: ownerId,
          },
          { $inc: { quantity: detail.quantity } },
          { session, upsert: true },
        );
      }

      // 2. Verificar existencia de los NUEVOS productos y computar total
      const newProductIds = items.map((i) => i.product_id);
      const products = await Product.find({
        _id: { $in: newProductIds },
        user: ownerId,
      })
        .populate("category", "max_debt_limit")
        .session(session);
      const productsMap = new Map(products.map((p) => [p._id.toString(), p]));

      let newTotal = "0";
      for (const item of items) {
        const product = productsMap.get(item.product_id.toString());
        if (!product)
          throw new Error(
            `Producto con ID ${item.product_id} no encontrado o no te pertenece.`,
          );

        // Fase 8: Backend Domain Validation
        const qty = Big(item.quantity);

        console.log("🔥 SALE DOMAIN VALIDATION", {
          productId: item.product_id,
          quantity: item.quantity,
          unitType: product.unit_type,
        });

        if (qty.lte(0)) {
          throw new Error(
            `La cantidad para el producto ${product.name} debe ser mayor a cero.`,
          );
        }
        if (product.unit_type === "unidad") {
          if (!qty.eq(qty.round(0, 0))) {
            throw new Error(
              `El producto ${product.name} se vende por unidades y no acepta decimales.`,
            );
          }
        }

        const lineTotal = qty.times(Big(item.unit_price));
        newTotal = Big(newTotal).plus(lineTotal).toString();
      }

      // 3. Decrementar stock en Inventory — mutación atómica con filtro $gte.
      for (const item of items) {
        const product = productsMap.get(item.product_id.toString())!;
        const qtyDecimal = mongoose.Types.Decimal128.fromString(item.quantity);
        const negQtyDecimal = mongoose.Types.Decimal128.fromString(
          Big(item.quantity).times(-1).toString(),
        );

        // TODO: Ajustar según tu regla de dominio real
        const allowNegativeStock = true;

        const preInventory = await Inventory.findOne({
          branch_id: effectiveBranchId,
          product_id: item.product_id,
          owner_id: ownerId,
        }).session(session);
        const previousQuantity =
          preInventory?.quantity ?? mongoose.Types.Decimal128.fromString("0");

        let result = await Inventory.findOneAndUpdate(
          {
            branch_id: effectiveBranchId,
            product_id: item.product_id,
            owner_id: ownerId,
            quantity: { $gte: qtyDecimal },
          },
          { $inc: { quantity: negQtyDecimal } },
          { session, returnDocument: "after" },
        );

        if (!result) {
          if (!allowNegativeStock) {
            throw new InsufficientStockError(
              product.name,
              item.product_id.toString(),
            );
          }

          // Stock insuficiente, pero se permiten cantidades negativas.
          // IMPORTANTE: no usar upsert.
          result = await Inventory.findOneAndUpdate(
            {
              branch_id: effectiveBranchId,
              product_id: item.product_id,
              owner_id: ownerId,
            },
            { $inc: { quantity: negQtyDecimal } },
            { session, returnDocument: "after" },
          );

          // No existe Inventory para ese producto/sucursal.
          if (!result) {
            throw new InsufficientStockError(
              product.name,
              item.product_id.toString(),
            );
          }
        }

        if (!result)
          throw new Error(
            "Error al actualizar inventario en la edición de venta",
          );
        // Registrar movimiento de stock (event sourcing)
        await StockMovement.create(
          [
            {
              inventory_id: result._id,
              product_id: item.product_id,
              branch_id: effectiveBranchId,
              owner_id: ownerId,
              type: StockMovementType.SALE,
              quantity_change: negQtyDecimal,
              previous_quantity: previousQuantity,
              new_quantity: result.quantity,
              reference_id: undefined,
              created_by: ownerId,
            },
          ],
          { session },
        );
      }

      // 4. Reemplazar SaleDetail
      await SaleDetail.deleteMany({ sale_id: saleId }, { session });
      for (const item of items) {
        const detail = new SaleDetail({
          sale_id: saleId,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
        });
        await detail.save({ session });
      }

      sale.total_amount = newTotal as any;
    }

    if (payment_method !== undefined) {
      sale.payment_method = (
        payment_method === "Pago Móvil" ? "Pago Movil" : payment_method
      ) as any;
    }

    await sale.save({ session });
    await session.commitTransaction();
    session.endSession();

    await bumpBranchCacheVersion(
      "products",
      String(ownerId),
      String(effectiveBranchId),
    );

    return sale;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Anular Venta ─────────────────────────────────────────────────────────────

/**
 * Servicio Transaccional para Anular Ventas.
 * Restaura el stock en BranchInventory de la sucursal donde se realizó la venta.
 */
export const cancelSaleProcess = async (
  saleId: string,
  ownerId: BusinessOwnerId,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sale = await Sale.findOne({
      _id: saleId,
      business_owner_id: ownerId,
    }).session(session);
    if (!sale)
      throw new Error("Venta no encontrada o no pertenece a tu negocio.");
    if (sale.status === "cancelled")
      throw new Error("La venta ya ha sido anulada anteriormente.");

    const effectiveBranchId = sale.branch_id as BranchId;

    // Validar que la sucursal original se encuentra activa
    const branch = await Branch.findOne({
      _id: effectiveBranchId,
      owner_id: ownerId,
      is_active: true,
    }).session(session);

    if (!branch) {
      throw new Error(
        "La sucursal de la venta original se encuentra inactiva. No se puede anular la venta.",
      );
    }

    const details = await SaleDetail.find({ sale_id: saleId }).session(session);

    // Restaurar stock en Inventory — filtro de tenant garantizado por la verificación previa
    for (const detail of details) {
      await Inventory.findOneAndUpdate(
        {
          branch_id: effectiveBranchId,
          product_id: detail.product_id,
          owner_id: ownerId,
        },
        { $inc: { quantity: detail.quantity } },
        { session, upsert: true },
      );
    }

    sale.status = "cancelled";
    sale.total_amount = "0" as any;
    await sale.save({ session });

    await session.commitTransaction();
    session.endSession();

    await bumpBranchCacheVersion(
      "products",
      String(ownerId),
      String(effectiveBranchId),
    );

    return sale;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

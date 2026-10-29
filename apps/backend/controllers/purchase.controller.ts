import { Request, Response } from 'express';
import { invalidateCache, getOrSetCache, bumpCacheVersion, getCacheVersion, buildPaginatedKey } from '../lib/redis.js';
import { PurchaseService } from '../services/purchase.service.js';
import { ExchangeRate } from '../models/ExchangeRate.js';
import { createPurchaseBodySchema } from '@inventory/shared/validations';
import { BusinessOwnerId, BranchId } from '../types/brands.js';

export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  public createPurchase = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Contexto de sucursal opcional
      const rawBranch = req.branchId || req.headers['x-branch-id'];
      const branchId = rawBranch ? (rawBranch as unknown as BranchId) : undefined;
      const ownerId = req.businessOwnerId as BusinessOwnerId;

      // 2. Validación estricta del body
      const payload = createPurchaseBodySchema.parse(req.body);

      // Validación Just-In-Time (JIT) de la tasa de cambio
      if (payload.exchange_rate != null) {
        const latestRateDoc = await ExchangeRate.findOne({ customer_id: ownerId }).sort({ date: -1 }).lean();
        const currentBackendRate = latestRateDoc?.rate ?? null;
        
        if (currentBackendRate !== null) {
          const currentBackendRateString = currentBackendRate.toString();

          if (
            Math.abs(
              parseFloat(currentBackendRateString) -
              parseFloat(payload.exchange_rate)
            ) > 0.001
          ) {
            res.status(409).json({
              success: false,
              error: 'EXCHANGE_RATE_MISMATCH',
              message:
                'La tasa de cambio ha sido actualizada en el servidor. Por favor, actualiza la caja registradora.',
              current_rate: currentBackendRateString,
            });
            return;
          }
        }
      }

      // 3. Ejecución de servicio transaccional ACID
      const purchase = await this.purchaseService.createPurchase({
        ownerId,
        branchId,
        payload
      });

      // Invalidar caché de compras y productos
      const individualKeysToInvalidate = [];
      for (const item of payload.items) {
        individualKeysToInvalidate.push(`product:${item.product_id}:${ownerId}`);
      }
      await Promise.all([
        bumpCacheVersion('purchases', String(ownerId)),
        individualKeysToInvalidate.length > 0
          ? invalidateCache(...individualKeysToInvalidate)
          : Promise.resolve()
      ]);

      res.status(201).json({
        success: true,
        message: "Compra registrada exitosamente",
        purchase
      });

    } catch (error: any) {
      console.error("DEBUG 500 ERROR IN PURCHASE:", error);
      const status = error.message?.includes?.("encontrado") ? 404 : 500;
      res.status(status).json({ success: false, message: error.message || 'Error interno' });
    }
  };

  public getPurchases = async (req: Request, res: Response): Promise<void> => {
    try {
      const page  = Math.max(1, parseInt(req.query.page as string)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const skip  = (page - 1) * limit;

      const status = req.query.status as string;
      const filterBy = req.query.filterBy as string;
      const filters: any = {};

      if (status) filters.status = status;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (filterBy === 'expiringSoon') {
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        filters.status   = { $ne: 'PAID' };
        filters.due_date = { $gte: today, $lte: nextWeek };
      } else if (filterBy === 'overdue') {
        filters.status   = { $ne: 'PAID' };
        filters.due_date = { $lt: today };
      }

      const hasFilters = status || filterBy;
      const ownerId = req.businessOwnerId as BusinessOwnerId;

      if (hasFilters) {
        const [purchases, total] = await Promise.all([
          this.purchaseService.fetchPurchases(ownerId, filters, skip, limit),
          this.purchaseService.fetchPurchasesCount(ownerId, filters)
        ]);
        res.status(200).json({
          success: true,
          purchases,
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page
        });
        return;
      }

      const version  = await getCacheVersion('purchases', String(ownerId));
      const cacheKey = buildPaginatedKey('purchases', version, page, limit, String(ownerId));

      const { data, fromCache } = await getOrSetCache(cacheKey, async () => {
        const [purchases, total] = await Promise.all([
          this.purchaseService.fetchPurchases(ownerId, {}, skip, limit),
          this.purchaseService.fetchPurchasesCount(ownerId, {})
        ]);
        return {
          purchases,
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page
        };
      }, 120);

      if (data.currentPage > data.totalPages && data.totalPages > 0) {
        res.status(200).json({
          success: true,
          purchases: [],
          total: data.total,
          totalPages: data.totalPages,
          currentPage: page,
          fromCache
        });
        return;
      }

      res.status(200).json({
        success: true,
        purchases: data.purchases,
        total: data.total,
        totalPages: data.totalPages,
        currentPage: data.currentPage,
        fromCache
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  public getPurchaseById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (typeof id !== 'string') {
        res.status(400).json({
          success: false,
          message: 'El ID de la compra es requerido.',
        });
        return;
      }

      const ownerId = req.businessOwnerId as BusinessOwnerId;
      const data = await this.purchaseService.fetchPurchaseById(id, ownerId);

      if (!data) {
        res.status(404).json({ success: false, message: "Compra no encontrada" });
        return;
      }

      res.status(200).json({
        success: true,
        purchase: data.purchase,
        details: data.details
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  public payPurchase = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (typeof id !== 'string') {
        res.status(400).json({
          success: false,
          message: 'El ID de la compra es requerido.',
        });
        return;
      }

      const { amount } = req.body;
      const ownerId = req.businessOwnerId as BusinessOwnerId;
      
      if (!amount || amount <= 0) {
        res.status(400).json({ success: false, message: "El monto debe ser mayor a cero." });
        return;
      }

      const purchase = await this.purchaseService.registerPayment(id, ownerId, amount);

      await Promise.all([
        bumpCacheVersion('purchases', String(ownerId)),
        invalidateCache(`purchase:${id}:${ownerId}`)
      ]);

      res.status(200).json({
        success: true,
        message: "Pago registrado exitosamente",
        purchase
      });
    } catch (error: any) {
      const status = error.message?.includes?.("encontrada") ? 404 : 400;
      res.status(status).json({ success: false, message: error.message || 'Error interno' });
    }
  };

  public getPayments = async (req: Request, res: Response): Promise<void> => {
    try {
      const ownerId = req.businessOwnerId as BusinessOwnerId;
      const payments = await this.purchaseService.fetchPayments(ownerId);
      res.status(200).json({ success: true, payments });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}

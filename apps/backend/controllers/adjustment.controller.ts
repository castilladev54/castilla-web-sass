import { Request, Response, NextFunction } from 'express';
import { createAdjustmentSchema } from '../validations/adjustment.validation.js';
import { executeAdjustment, fetchAdjustments, fetchAdjustmentsCount } from '../services/adjustment.service.js';
import { AppError } from '../lib/error.js';
import { Branch } from '../models/Branch.js';
import { ROLES } from '../models/User.js';
import {
  getOrSetCache,
  getCacheVersion,
  buildPaginatedKey
} from '../lib/redis.js';

export const createAdjustmentController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parseResult = createAdjustmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(400, 'Datos de ajuste inválidos');
    }

    const { product_id, branch_id, quantity, reason, notes } = parseResult.data;
    let targetBranchId = (branch_id ?? req.branchId)?.toString();

    if (!targetBranchId) {
      if (req.userRole === ROLES.TENANT_OWNER || req.userRole === ROLES.ADMIN) {
        // Resolver sucursal activa predeterminada del negocio
        const defaultBranch = await Branch.findOne({
          owner_id: req.businessOwnerId,
          is_active: true
        }).sort({ createdAt: 1 });

        if (defaultBranch) {
          targetBranchId = defaultBranch._id.toString();
        } else {
          // Si el negocio aún no tiene ninguna sucursal registrada, crear la sucursal principal
          const newBranch = await Branch.create({
            name: 'Sede Principal',
            address: 'Sede Principal',
            is_active: true,
            owner_id: req.businessOwnerId,
          });
          targetBranchId = newBranch._id.toString();
        }
      } else {
        throw new AppError(
          400,
          'Debe especificar branch_id en el cuerpo o enviar la cabecera x-branch-id'
        );
      }
    }

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const result = await executeAdjustment({
      product_id,
      targetBranchId,
      quantity,
      reason,
      notes,
      actorId: req.userId!,
      ownerId: req.businessOwnerId!,
      idempotencyKey
    });

    res.status(201).json({
      success: true,
      message: 'Ajuste de inventario procesado correctamente',
      data: result
    });
  } catch (error: any) {
    if (error.code === 11000 && error.message && error.message.includes('idempotency_key')) {
      return next(new AppError(409, 'Petición rechazada por duplicidad (idempotencia)'));
    }
    next(error);
  }
};

export const getAdjustments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // ─── Paginación con defaults seguros ────────────────────────────────
    const page  = Math.max(1, parseInt(req.query.page as string)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip  = (page - 1) * limit;

    // ─── Caché versionada (invalida en bloque al crear/editar ajuste) ───
    const version  = await getCacheVersion('adjustments', req.businessOwnerId!);
    const cacheKey = buildPaginatedKey('adjustments', version, page, limit, req.businessOwnerId!);

    const { data, fromCache } = await getOrSetCache(cacheKey, async () => {
      const [adjustments, total] = await Promise.all([
        fetchAdjustments(req.businessOwnerId!, skip, limit),
        fetchAdjustmentsCount(req.businessOwnerId!)
      ]);

      return {
        adjustments,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page
      };
    }, 300); // TTL 5 min

    // Protección: página fuera de rango → devolver vacío sin error
    if (data.currentPage > data.totalPages && data.totalPages > 0) {
      res.status(200).json({
        success: true,
        adjustments: [],
        total: data.total,
        totalPages: data.totalPages,
        currentPage: page,
        fromCache
      });
      return;
    }

    res.status(200).json({
      success: true,
      adjustments: data.adjustments,
      total: data.total,
      totalPages: data.totalPages,
      currentPage: data.currentPage,
      fromCache
    });
  } catch (error) {
    next(error);
  }
};

import express, { Request, Response, NextFunction } from 'express';
import { createAdjustmentController, getAdjustments } from '../controllers/adjustment.controller.js';
import { cacheMiddleware } from '../middleware/cache.middleware.js';
import { requireBranchHeader } from '../middleware/requireBranchHeader.js';
import { ROLES } from '../models/User.js';

const router = express.Router();

/**
 * Middleware de contexto de sucursal para Ajustes:
 * - TENANT_OWNER y ADMIN pueden operar sin cabecera x-branch-id (se resuelve automáticamente o por body).
 * - Si se envía la cabecera x-branch-id, se valida con requireBranchHeader.
 * - Empleados sin sucursal ni en body ni en header son rechazados con requireBranchHeader.
 */
const flexibleBranchForAdjustment = (req: Request, res: Response, next: NextFunction): void => {
  const isOwnerOrAdmin = req.userRole === ROLES.TENANT_OWNER || req.userRole === ROLES.ADMIN;
  const hasBranchHeader = Boolean(req.headers['x-branch-id']);
  const hasBranchInBody = Boolean(req.body?.branch_id);

  if (hasBranchHeader) {
    return requireBranchHeader(req, res, next);
  }

  if (isOwnerOrAdmin || hasBranchInBody) {
    return next();
  }

  return requireBranchHeader(req, res, next);
};

// 2. Definición de rutas
router.get('/', cacheMiddleware('adjustments', 'adjustments'), getAdjustments);

// Inyección de Middleware: Proteger el endpoint permitiendo contexto global para dueños/admins
router.post('/', flexibleBranchForAdjustment, createAdjustmentController);

export default router;

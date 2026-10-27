import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { CashShift } from '../models/CashShift.model.js';

/**
 * Middleware de Guardia para Turnos de Caja.
 *
 * Verifica que el operador tenga un turno OPEN en la sucursal indicada por x-branch-id.
 * Si existe, inyecta el documento del turno en req.cashShift para uso downstream.
 *
 * Requisitos previos en la cadena de middleware:
 *   1. verifyToken          → req.userId
 *   2. injectBusinessContext → req.assignedBranches, req.branchId
 *   3. requireBranchHeader   → Garantiza presencia de x-branch-id
 */
export const ensureCashShiftOpen = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.actorId ?? req.userId;
    const branchId = req.branchId;

    if (!userId) {
      res.status(401).json({ success: false, message: 'No autenticado.' });
      return;
    }

    if (!branchId) {
      res.status(400).json({
        success: false,
        message: 'El header x-branch-id es requerido para operar con turnos de caja.',
      });
      return;
    }

    // Consulta del turno activo en la BD
    const activeShift = await CashShift.findOne({
      branch_id: new Types.ObjectId(String(branchId)),
      cashier_id: new Types.ObjectId(String(userId)),
      status: 'OPEN',
    });

    if (!activeShift) {
      res.status(403).json({
        success: false,
        message:
          'No existe un turno de caja abierto para este operador en la sucursal indicada. Debe abrir un turno antes de registrar ventas.',
      });
      return;
    }

    // Inyección segura en el contexto del request
    req.cashShift = activeShift;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Busca el turno abierto sin bloquear la petición si no existe.
 *
 * Se utiliza en operaciones idempotentes que deben poder recuperar
 * un pago previamente registrado aunque el turno ya esté cerrado.
 * El servicio decide si se trata de un pago existente o uno nuevo.
 */
export const attachOpenCashShiftIfExists = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.actorId ?? req.userId;
    const branchId = req.branchId;

    if (!userId || !branchId) {
      next();
      return;
    }

    const activeShift = await CashShift.findOne({
      branch_id: new Types.ObjectId(String(branchId)),
      cashier_id: new Types.ObjectId(String(userId)),
      status: 'OPEN',
    });

    if (activeShift) {
      req.cashShift = activeShift;
    }

    next();
  } catch (error) {
    next(error);
  }
};

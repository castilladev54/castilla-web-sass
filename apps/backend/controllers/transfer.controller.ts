import type { Request, Response } from 'express';

import {
  transferStockBetweenBranches,
} from '../services/transfer.service.js';

import {
  updateTransferStatus,
} from '../services/transferStatus.service.js';

import {
  TransferStatus,
} from '../models/transferStatus.enum.js';

import { AppError } from '../lib/error.js';

export const executeStockTransfer = async (
  req: Request,
  res: Response,
) => {
  try {
    const {
      sourceBranchId,
      destinationBranchId,
      items,
      notes,
    } = req.body;

    const businessOwnerId = req.businessOwnerId;
    const actorId = req.actorId;

    if (!businessOwnerId || !actorId) {
      throw new AppError(
        401,
        'No se pudo identificar al usuario autenticado.',
      );
    }

    const result = await transferStockBetweenBranches({
      sourceBranchId,
      destinationBranchId,
      businessOwnerId,
      actorId,
      items,
      notes,
    });

    return res.status(200).json(result);
  } catch (error: unknown) {

    console.error('TRANSFER POST ERROR:', error);
    if (error instanceof AppError) {
      return res.status(error.status).json({
        error: error.message,
      });
    }

    if (error instanceof Error) {
      console.error('TRANSFER POST MESSAGE:', error.message);
      console.error('TRANSFER POST STACK:', error.stack);
    }


    return res.status(500).json({
      error: 'Unexpected error',
    });
  }
};

export const setTransferStatus = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;

    if (typeof id !== 'string' || id.length === 0) {
      throw new AppError(400, 'ID de transferencia inválido.');
    }

    const { status } = req.body as {
      status: TransferStatus;
    };

    const businessOwnerId = req.businessOwnerId;
    const actorId = req.actorId;

    if (!businessOwnerId || !actorId) {
      throw new AppError(
        401,
        'No se pudo identificar al usuario autenticado.',
      );
    }

    const updated = await updateTransferStatus({
      transferId: id,
      newStatus: status,
      actorId,
      businessOwnerId,
    });

    return res.status(200).json({
      success: true,
      transfer: updated,
    });
  } catch (error: unknown) {

    if (error instanceof AppError) {
      return res.status(error.status).json({
        error: error.message,
      });
    }

    return res.status(500).json({
      error: 'Unexpected error',
    });
  }
};

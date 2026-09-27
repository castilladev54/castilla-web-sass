import mongoose from 'mongoose';

import {
  StockTransferModel,
} from '../models/stockTransfer.model.js';

import {
  TransferStatus,
} from '../models/transferStatus.enum.js';

import { AppError } from '../lib/error.js';

export interface UpdateTransferStatusParams {
  transferId: string;
  newStatus: TransferStatus;
  actorId: string;
  businessOwnerId: string;
}

export const updateTransferStatus = async ({
  transferId,
  newStatus,
  actorId,
  businessOwnerId,
}: UpdateTransferStatusParams) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const transfer = await StockTransferModel.findOne({
      _id: transferId,
      businessOwnerId,
    }).session(session);

    if (!transfer) {
      throw new AppError(
        404,
        'Transferencia no encontrada.',
      );
    }

    if (
      transfer.status === TransferStatus.COMPLETED &&
      newStatus === TransferStatus.COMPLETED
    ) {
      throw new AppError(
        409,
        'La transferencia ya está completada.',
      );
    }

    if (
      transfer.status === TransferStatus.COMPLETED &&
      newStatus === TransferStatus.CANCELED
    ) {
      throw new AppError(
        409,
        'Una transferencia completada no puede cancelarse sin revertir primero el inventario.',
      );
    }

    if (
      transfer.status === TransferStatus.CANCELED &&
      newStatus !== TransferStatus.CANCELED
    ) {
      throw new AppError(
        409,
        'Una transferencia cancelada no puede cambiar de estado.',
      );
    }

    if (
      transfer.status === TransferStatus.PENDING &&
      newStatus === TransferStatus.COMPLETED
    ) {
      throw new AppError(
        409,
        'Las transferencias PENDING no pueden completarse mediante este endpoint porque el movimiento de inventario se realiza al crear la transferencia.',
      );
    }

    transfer.status = newStatus;

    // actorId se recibe para mantener trazabilidad del endpoint.
    // Si posteriormente quieres auditar cambios de estado,
    // añadiremos un historial específico.
    void actorId;

    await transfer.save({ session });

    await session.commitTransaction();

    return transfer;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

import mongoose from 'mongoose';
import Big from 'big.js';

import { Branch } from '../models/Branch.js';
import { Inventory } from '../models/Inventory.js';
import {
  StockMovement,
  StockMovementType,
} from '../models/StockMovement.js';
import { Product } from '../models/Product.js';
import {
  StockTransferModel,
  type StockTransferItem,
} from '../models/stockTransfer.model.js';
import { TransferStatus } from '../models/transferStatus.enum.js';
import { AppError } from '../lib/error.js';

interface TransferItem {
  product_id: string;
  quantity: string;
}

interface TransferParams {
  sourceBranchId: string;
  destinationBranchId: string;
  businessOwnerId: string;
  actorId: string;
  items: TransferItem[];
  notes?: string;
}

export const transferStockBetweenBranches = async ({
  sourceBranchId,
  destinationBranchId,
  businessOwnerId,
  actorId,
  items,
  notes,
}: TransferParams) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    if (sourceBranchId === destinationBranchId) {
      throw new AppError(
        400,
        'La sucursal de origen y destino no pueden ser la misma.',
      );
    }

    if (items.length === 0) {
      throw new AppError(
        400,
        'La transferencia debe contener al menos un producto.',
      );
    }

    const productIds = items.map((item) => item.product_id);
    const uniqueProductIds = new Set(productIds);

    if (uniqueProductIds.size !== productIds.length) {
      throw new AppError(
        400,
        'No se puede repetir el mismo producto dentro de una transferencia.',
      );
    }

    const [sourceBranch, destinationBranch] = await Promise.all([
      Branch.findOne({
        _id: sourceBranchId,
        owner_id: businessOwnerId,
      })
        .session(session)
        .lean(),

      Branch.findOne({
        _id: destinationBranchId,
        owner_id: businessOwnerId,
      })
        .session(session)
        .lean(),
    ]);

    if (!sourceBranch) {
      throw new AppError(
        404,
        'Sucursal de origen no encontrada o no pertenece a su tenant.',
      );
    }

    if (!destinationBranch) {
      throw new AppError(
        404,
        'Sucursal de destino no encontrada o no pertenece a su tenant.',
      );
    }

    const products = await Product.find({
      _id: { $in: productIds },
      user: businessOwnerId,
    })
      .session(session)
      .lean();

    if (products.length !== productIds.length) {
      throw new AppError(
        400,
        'Uno o más productos no fueron encontrados o no pertenecen a su negocio.',
      );
    }

    for (const item of items) {
      const { product_id, quantity } = item;

      let decimalQuantity: mongoose.Types.Decimal128;

      try {
        const bigQuantity = new Big(quantity);

        if (bigQuantity.lte(0)) {
          throw new AppError(
            400,
            'La cantidad a transferir debe ser mayor a 0.',
          );
        }

        decimalQuantity =
          mongoose.Types.Decimal128.fromString(quantity);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        throw new AppError(
          400,
          `Cantidad inválida para el producto ${product_id}.`,
        );
      }

      const decimalNegativeQuantity =
        mongoose.Types.Decimal128.fromString(`-${quantity}`);

      const sourceInventory = await Inventory.findOneAndUpdate(
        {
          branch_id: sourceBranchId,
          product_id,
          owner_id: businessOwnerId,
          quantity: { $gte: decimalQuantity },
        },
        {
          $inc: {
            quantity: decimalNegativeQuantity,
          },
        },
        {
          new: false,
          session,
        },
      );

      if (!sourceInventory) {
        throw new AppError(
          400,
          `Stock insuficiente o producto no encontrado en sucursal de origen para ${product_id}.`,
        );
      }

      const previousSourceQuantity =
        sourceInventory.quantity.toString();

      const newSourceQuantity = Big(previousSourceQuantity)
        .minus(quantity)
        .toString();

      await StockMovement.create(
        [
          {
            inventory_id: sourceInventory._id,
            product_id,
            branch_id: sourceBranchId,
            owner_id: businessOwnerId,
            type: StockMovementType.TRANSFER_OUT,
            quantity_change: Big(quantity).times(-1).toString(),
            previous_quantity: previousSourceQuantity,
            new_quantity: newSourceQuantity,
            created_by: actorId,
            reason:
              notes ||
              `Transferencia hacia sucursal ${destinationBranch.name}`,
          },
        ],
        { session },
      );

      const destinationInventory =
        await Inventory.findOneAndUpdate(
          {
            branch_id: destinationBranchId,
            product_id,
            owner_id: businessOwnerId,
          },
          {
            $inc: {
              quantity: decimalQuantity,
            },
            $setOnInsert: {
              owner_id: businessOwnerId,
              min_stock_alert: '0',
            },
          },
          {
            upsert: true,
            new: true,
            session,
          },
        );

      if (!destinationInventory) {
        throw new AppError(
          500,
          'No fue posible actualizar el inventario de destino.',
        );
      }

      const newDestinationQuantity =
        destinationInventory.quantity.toString();

      const previousDestinationQuantity = Big(
        newDestinationQuantity,
      )
        .minus(quantity)
        .toString();

      await StockMovement.create(
        [
          {
            inventory_id: destinationInventory._id,
            product_id,
            branch_id: destinationBranchId,
            owner_id: businessOwnerId,
            type: StockMovementType.TRANSFER_IN,
            quantity_change: quantity,
            previous_quantity: previousDestinationQuantity,
            new_quantity: newDestinationQuantity,
            created_by: actorId,
            reason:
              notes ||
              `Transferencia desde sucursal ${sourceBranch.name}`,
          },
        ],
        { session },
      );
    }

    const transferItems: StockTransferItem[] = items.map(
      (item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
      }),
    );

    const [transfer] = await StockTransferModel.create(
      [
        {
          sourceBranchId,
          destinationBranchId,
          items: transferItems,
          status: TransferStatus.COMPLETED,
          createdBy: actorId,
          businessOwnerId,
          notes,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    return {
      success: true,
      message: 'Transferencia completada exitosamente.',
      transfer,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

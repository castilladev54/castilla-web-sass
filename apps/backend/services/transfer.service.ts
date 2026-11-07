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
  idempotencyKey: string;
  notes?: string;
}

const isSameTransfer = (
  existing: {
    sourceBranchId: string;
    destinationBranchId: string;
    items: StockTransferItem[];
    notes?: string;
  },
  input: {
    sourceBranchId: string;
    destinationBranchId: string;
    items: StockTransferItem[];
    notes?: string;
  },
): boolean => {
  try {
    const normalizeItems = (transferItems: StockTransferItem[]) =>
      transferItems
        .map((item) => ({
          product_id: item.product_id,
          quantity: new Big(item.quantity).toString(),
        }))
        .sort((a, b) => a.product_id.localeCompare(b.product_id));

    return (
      existing.sourceBranchId === input.sourceBranchId &&
      existing.destinationBranchId === input.destinationBranchId &&
      (existing.notes ?? '').trim() === (input.notes ?? '').trim() &&
      JSON.stringify(normalizeItems(existing.items)) ===
        JSON.stringify(normalizeItems(input.items))
    );
  } catch {
    return false;
  }
};

const isIdempotencyDuplicateKeyError = (
  error: unknown,
): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const mongoError = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };

  return (
    mongoError.code === 11000 &&
    mongoError.keyPattern?.businessOwnerId === 1 &&
    mongoError.keyPattern?.idempotency_key === 1
  );
};

export const transferStockBetweenBranches = async ({
  sourceBranchId,
  destinationBranchId,
  businessOwnerId,
  actorId,
  items,
  idempotencyKey,
  notes,
}: TransferParams) => {
  const session = await mongoose.startSession();
  let transferItems: StockTransferItem[] = [];
  const normalizedNotes = notes?.trim() || undefined;

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

    /*
     * ============================================================
     * 1. VALIDAR Y NORMALIZAR CANTIDADES
     * ============================================================
     * Se valida antes de consultar la idempotencia para que
     * una solicitud inválida nunca llegue a las existencias ni
     * al registro histórico.
     */

    const validatedItems = items.map((item) => {
      const { product_id, quantity } = item;

      try {
        if (
          typeof quantity !== 'string' ||
          !/^\d+(?:\.\d{1,4})?$/.test(quantity)
        ) {
          throw new Error('Formato o precisión inválida');
        }

        const bigQuantity = new Big(quantity);

        if (bigQuantity.lte(0)) {
          throw new Error('La cantidad debe ser positiva');
        }

        return {
          product_id,
          quantity: bigQuantity.toString(),
          bigQuantity,
          decimalQuantity: mongoose.Types.Decimal128.fromString(
            bigQuantity.toString(),
          ),
          decimalNegativeQuantity: mongoose.Types.Decimal128.fromString(
            bigQuantity.times(-1).toString(),
          ),
        };
      } catch {
        throw new AppError(
          400,
          `Cantidad inválida para el producto ${product_id}. Debe ser positiva y tener máximo cuatro decimales.`,
        );
      }
    });

    transferItems = validatedItems.map(({ product_id, bigQuantity }) => ({
      product_id,
      quantity: bigQuantity.toString(),
    }));

    /*
     * ============================================================
     * 2. CONTROL DE IDEMPOTENCIA PREVIO
     * ============================================================
     * Se evalúa antes de consultar sucursales y productos para que
     * un reintento no dependa del estado actual del negocio.
     */

    const existingTransfer = await StockTransferModel.findOne({
      businessOwnerId,
      idempotency_key: idempotencyKey,
    }).session(session);

    if (existingTransfer) {
      if (
        !isSameTransfer(existingTransfer, {
          sourceBranchId,
          destinationBranchId,
          items: transferItems,
          notes: normalizedNotes,
        })
      ) {
        throw new AppError(
          409,
          'La clave de idempotencia ya fue utilizada para otra transferencia.',
        );
      }

      await session.commitTransaction();

      return {
        success: true,
        message: 'Esta transferencia ya había sido procesada.',
        transfer: existingTransfer,
      };
    }

    /*
     * ============================================================
     * 3. VALIDAR SUCURSAL DE ORIGEN
     * ============================================================
     */

    const sourceBranch = await Branch.findOne({
      _id: sourceBranchId,
      owner_id: businessOwnerId,
      is_active: true,
    })
      .session(session)
      .lean();

    if (!sourceBranch) {
      throw new AppError(
        404,
        'Sucursal de origen no encontrada o no pertenece a su tenant.',
      );
    }

    /*
     * ============================================================
     * 4. VALIDAR SUCURSAL DE DESTINO
     * ============================================================
     */

    const destinationBranch = await Branch.findOne({
      _id: destinationBranchId,
      owner_id: businessOwnerId,
      is_active: true,
    })
      .session(session)
      .lean();

    if (!destinationBranch) {
      throw new AppError(
        404,
        'Sucursal de destino no encontrada o no pertenece a su tenant.',
      );
    }

    /*
     * ============================================================
     * 5. VALIDAR PRODUCTOS
     * ============================================================
     */

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

    /*
     * ============================================================
     * 6. CREAR REGISTRO DE TRANSFERENCIA
     * ============================================================
     */

    const [transfer] = await StockTransferModel.create(
      [
        {
          sourceBranchId,
          destinationBranchId,
          items: transferItems,
          status: TransferStatus.COMPLETED,
          createdBy: actorId,
          businessOwnerId,
          idempotency_key: idempotencyKey,
          notes: normalizedNotes,
        },
      ],
      { session },
    );

    if (!transfer) {
      throw new AppError(
        500,
        'No fue posible crear el registro de la transferencia.',
      );
    }

    /*
     * ============================================================
     * 7. TRANSFERIR CADA PRODUCTO
     * ============================================================
     */

    for (const item of validatedItems) {
      const {
        product_id,
        quantity,
        decimalQuantity,
        decimalNegativeQuantity,
      } = item;

      /*
       * ------------------------------------------------------------
       * 7.1 DESCONTAR STOCK DE ORIGEN
       * ------------------------------------------------------------
       */

      const sourceInventory =
        await Inventory.findOneAndUpdate(
          {
            branch_id: sourceBranchId,
            product_id,
            owner_id: businessOwnerId,
            quantity: {
              $gte: decimalQuantity,
            },
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

      /*
       * ------------------------------------------------------------
       * 7.2 MOVIMIENTO TRANSFER_OUT
       * ------------------------------------------------------------
       */

      await StockMovement.create(
        [
          {
            inventory_id: sourceInventory._id,
            product_id,
            branch_id: sourceBranchId,
            owner_id: businessOwnerId,
            type: StockMovementType.TRANSFER_OUT,
            quantity_change: Big(quantity)
              .times(-1)
              .toString(),
            previous_quantity: previousSourceQuantity,
            new_quantity: newSourceQuantity,
            reference_id: transfer._id,
            created_by: actorId,
            reason:
              normalizedNotes ??
              `Transferencia hacia sucursal ${destinationBranch.name}`,
          },
        ],
        {
          session,
        },
      );

      /*
       * ------------------------------------------------------------
       * 7.3 AUMENTAR / CREAR STOCK DESTINO
       * ------------------------------------------------------------
       */

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

      /*
       * ------------------------------------------------------------
       * 7.4 MOVIMIENTO TRANSFER_IN
       * ------------------------------------------------------------
       */

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
            reference_id: transfer._id,
            created_by: actorId,
            reason:
              normalizedNotes ??
              `Transferencia desde sucursal ${sourceBranch.name}`,
          },
        ],
        {
          session,
        },
      );
    }

    /*
     * ============================================================
     * 8. COMMIT
     * ============================================================
     */

    await session.commitTransaction();

    return {
      success: true,
      message: 'Transferencia completada exitosamente.',
      transfer,
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (isIdempotencyDuplicateKeyError(error)) {
      const existingTransfer = await StockTransferModel.findOne({
        businessOwnerId,
        idempotency_key: idempotencyKey,
      }).lean();

      if (existingTransfer) {
        const sameTransfer = isSameTransfer(existingTransfer, {
          sourceBranchId,
          destinationBranchId,
          items: transferItems,
          notes: normalizedNotes,
        });

        if (!sameTransfer) {
          throw new AppError(
            409,
            'La clave de idempotencia ya fue utilizada para otra transferencia.',
          );
        }

        return {
          success: true,
          message: 'Esta transferencia ya había sido procesada.',
          transfer: existingTransfer,
        };
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

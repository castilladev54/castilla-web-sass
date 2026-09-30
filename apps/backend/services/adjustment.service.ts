import mongoose, { ClientSession } from 'mongoose';
import Big from 'big.js';
import { Inventory } from '../models/Inventory.js';
import { Product } from '../models/Product.js';
import { Branch } from '../models/Branch.js';
import { StockMovement, StockMovementType } from '../models/StockMovement.js';
import { AppError } from '../lib/error.js';
import { CreateAdjustmentDTO } from '../validations/adjustment.validation.js';
import { BusinessOwnerId, ActorId, ProductId, BranchId } from '../types/brands.js';
import { bumpCacheVersion, invalidateCache, bumpBranchCacheVersion } from '../lib/redis.js';

interface AdjustmentParams extends CreateAdjustmentDTO {
  actorId: string;
  ownerId: string;
  targetBranchId: string;
  idempotencyKey?: string;
}

const asDecimal128 = (value: unknown) => {
  if (value instanceof mongoose.Types.Decimal128) return value;
  if (value === undefined || value === null || value === '') return mongoose.Types.Decimal128.fromString('0');
  return mongoose.Types.Decimal128.fromString(String(value));
};

export const executeAdjustment = async ({
  product_id,
  targetBranchId,
  quantity,
  reason,
  notes,
  actorId,
  ownerId,
  idempotencyKey
}: AdjustmentParams) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const branch = await Branch.findOne({
      _id: targetBranchId,
      owner_id: ownerId,
      is_active: true
    }).session(session);

    if (!branch) {
      throw new AppError(
        404,
        'La sucursal a ajustar no existe o se encuentra inactiva.'
      );
    }

    const productExists = await Product.exists({ _id: product_id, user: ownerId }).session(session);
    if (!productExists) {
      throw new AppError(404, 'El producto especificado no existe en el catálogo de este negocio.');
    }

    const stringQty = String(quantity);
    const decimalQuantity = asDecimal128(stringQty);

    const updatedInventory = await Inventory.findOneAndUpdate(
      {
        branch_id: targetBranchId,
        product_id: product_id,
        owner_id: ownerId,
      },
      {
        $inc: { quantity: decimalQuantity },
        $setOnInsert: {
          owner_id: ownerId,
          min_stock_alert: '0'
        }
      },
      {
        upsert: true,
        returnDocument: 'after',
        session
      }
    );

    const inventoryId = updatedInventory._id;
    const newQuantity = updatedInventory.quantity.toString();
    const appliedQuantity = decimalQuantity.toString();
    const previousQuantity = Big(newQuantity).minus(appliedQuantity).toString();

    await StockMovement.create(
      [
        {
          inventory_id: inventoryId,
          product_id: product_id,
          branch_id: targetBranchId,
          owner_id: ownerId,
          type: StockMovementType.MANUAL_ADJUSTMENT,
          quantity_change: appliedQuantity,
          previous_quantity: previousQuantity,
          new_quantity: newQuantity,
          created_by: actorId,
          reason: `AJUSTE [${reason}]: ${notes || 'Sin especificación'}`,
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
        }
      ],
      { session }
    );

    await session.commitTransaction();

    await Promise.all([
      bumpBranchCacheVersion('products', String(ownerId), String(targetBranchId)),
      bumpCacheVersion('adjustments', ownerId),
      invalidateCache(`product:${product_id}:${ownerId}`)
    ]);

    return {
      success: true,
      previous_quantity: previousQuantity,
      new_quantity: newQuantity
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export const fetchAdjustments = async (
  businessOwnerId: BusinessOwnerId | string,
  skip = 0,
  limit = 0
) => {
  const query = StockMovement.find({
    owner_id: businessOwnerId,
    type: StockMovementType.MANUAL_ADJUSTMENT
  })
    .populate('product_id', 'name barcode price')
    .sort({ createdAt: -1 })
    .skip(skip);

  if (limit > 0) query.limit(limit);

  const adjustments = await query.lean();
  return adjustments.map(adj => {
    return {
      ...adj,
      user_id: adj.owner_id,
      difference: Number(adj.quantity_change.toString()),
      previous_stock: Number(adj.previous_quantity.toString()),
      new_stock: Number(adj.new_quantity.toString())
    };
  });
};

export const fetchAdjustmentsCount = async (businessOwnerId: BusinessOwnerId | string) => {
  return StockMovement.countDocuments({
    owner_id: businessOwnerId,
    type: StockMovementType.MANUAL_ADJUSTMENT
  });
};

export const createAdjustmentProcess = async (
  actorId: ActorId | string,
  businessOwnerId: BusinessOwnerId | string,
  branchId: BranchId | string,
  product_id: ProductId | string,
  new_stock: number,
  reason: string,
  notes: string,
  extSession: ClientSession | null = null
) => {
  const ownSession = !extSession;
  const session = extSession ?? await mongoose.startSession();

  if (ownSession) session.startTransaction();

  try {
    const branch = await Branch.findOne({
      _id: branchId,
      owner_id: businessOwnerId,
      is_active: true
    }).session(session);

    if (!branch) {
      throw new AppError(404, 'La sucursal a ajustar no existe o se encuentra inactiva.');
    }

    const product = await Product.findOne({ _id: product_id, user: businessOwnerId }).session(session);
    if (!product) {
      throw new AppError(404, 'Producto no encontrado o no te pertenece');
    }

    const inventoryItem = await Inventory.findOne({
      product_id,
      branch_id: branchId,
      owner_id: businessOwnerId
    }).session(session);

    const previous_stock = inventoryItem ? Number(inventoryItem.quantity.toString()) : 0;
    const difference = new_stock - previous_stock;

    if (difference === 0) {
      throw new AppError(400, 'El nuevo stock es igual al stock actual. No hay nada que ajustar.');
    }

    const updatedInventory = await Inventory.findOneAndUpdate(
      { product_id, branch_id: branchId, owner_id: businessOwnerId },
      { $set: { quantity: new_stock } },
      { upsert: true, new: true, session, runValidators: true }
    );

    const adjustment = new StockMovement({
      inventory_id: updatedInventory._id,
      product_id,
      branch_id: branchId,
      owner_id: businessOwnerId,
      type: StockMovementType.MANUAL_ADJUSTMENT,
      quantity_change: difference,
      previous_quantity: previous_stock,
      new_quantity: new_stock,
      created_by: actorId,
      reason: reason + (notes ? ` - ${notes}` : '')
    });

    await adjustment.save({ session });

    if (ownSession) {
      await session.commitTransaction();
      await bumpBranchCacheVersion('products', String(businessOwnerId), String(branchId));
    }

    return adjustment;
  } catch (error) {
    if (ownSession && session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (ownSession) {
      session.endSession();
    }
  }
};

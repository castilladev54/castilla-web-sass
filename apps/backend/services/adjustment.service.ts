import mongoose, { ClientSession } from 'mongoose';
import Big from 'big.js';

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
}: any) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const branch = await (await import('../models/Branch.js')).Branch.findOne({
      _id: targetBranchId,
      owner_id: ownerId,
      is_active: true
    }).session(session);

    if (!branch) {
      throw new Error('La sucursal a ajustar no existe o se encuentra inactiva.');
    }

    const productExists = await (await import('../models/Product.js')).Product.exists({ _id: product_id, user: ownerId }).session(session);
    if (!productExists) {
      throw new Error('El producto especificado no existe en el catálogo de este negocio.');
    }

    const stringQty = String(quantity);
    const decimalQuantity = asDecimal128(stringQty);

    const updatedInventory = await (await import('../models/Inventory.js')).Inventory.findOneAndUpdate(
      {
        branch_id: targetBranchId,
        product_id,
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

    await (await import('../models/StockMovement.js')).StockMovement.create(
      [{
        inventory_id: inventoryId,
        product_id,
        branch_id: targetBranchId,
        owner_id: ownerId,
        type: (await import('../models/StockMovement.js')).StockMovementType.MANUAL_ADJUSTMENT,
        quantity_change: appliedQuantity,
        previous_quantity: previousQuantity,
        new_quantity: newQuantity,
        created_by: actorId,
        reason: `AJUSTE [${reason}]: ${notes || 'Sin especificación'}`,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
      }],
      { session }
    );

    await session.commitTransaction();
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

export const createAdjustmentProcess = async (
  actorId: any,
  businessOwnerId: any,
  branchId: any,
  product_id: any,
  new_stock: number,
  reason: string,
  notes: string,
  extSession: ClientSession | null = null
) => {
  const ownSession = !extSession;
  const session = extSession ?? await mongoose.startSession();

  if (ownSession) session.startTransaction();

  try {
    const branch = await (await import('../models/Branch.js')).Branch.findOne({
      _id: branchId,
      owner_id: businessOwnerId,
      is_active: true
    }).session(session);

    if (!branch) {
      throw new Error('La sucursal a ajustar no existe o se encuentra inactiva.');
    }

    const product = await (await import('../models/Product.js')).Product.findOne({ _id: product_id, user: businessOwnerId }).session(session);
    if (!product) {
      throw new Error('Producto no encontrado o no te pertenece');
    }

    const inventoryItem = await (await import('../models/Inventory.js')).Inventory.findOne({
      product_id,
      branch_id: branchId,
      owner_id: businessOwnerId
    }).session(session);

    const previous_stock = inventoryItem ? Number(inventoryItem.quantity.toString()) : 0;
    const difference = new_stock - previous_stock;

    if (difference === 0) {
      throw new Error('El nuevo stock es igual al stock actual. No hay nada que ajustar.');
    }

    const updatedInventory = await (await import('../models/Inventory.js')).Inventory.findOneAndUpdate(
      { product_id, branch_id: branchId, owner_id: businessOwnerId },
      { $set: { quantity: new_stock } },
      { upsert: true, new: true, session, runValidators: true }
    );

    const adjustment = new (await import('../models/StockMovement.js')).StockMovement({
      inventory_id: updatedInventory._id,
      product_id,
      branch_id: branchId,
      owner_id: businessOwnerId,
      type: (await import('../models/StockMovement.js')).StockMovementType.MANUAL_ADJUSTMENT,
      quantity_change: difference,
      previous_quantity: previous_stock,
      new_quantity: new_stock,
      created_by: actorId,
      reason: reason + (notes ? ` - ${notes}` : '')
    });

    await adjustment.save({ session });

    if (ownSession) {
      await session.commitTransaction();
      session.endSession();
    }

    return adjustment;
  } catch (error) {
    if (ownSession && session.inTransaction()) {
      await session.abortTransaction();
    }
    if (ownSession) {
      session.endSession();
    }
    throw error;
  }
};

export const fetchAdjustments = async (businessOwnerId: any, skip = 0, limit = 0) => {
  const query = (await import('../models/StockMovement.js')).StockMovement.find({
    owner_id: businessOwnerId,
    type: (await import('../models/StockMovement.js')).StockMovementType.MANUAL_ADJUSTMENT
  })
    .populate('product_id', 'name barcode price')
    .sort({ createdAt: -1 })
    .skip(skip);

  if (limit > 0) query.limit(limit);

  const adjustments = await query.lean();
  return adjustments.map(adj => ({
    ...adj,
    user_id: adj.owner_id,
    difference: Number(adj.quantity_change.toString()),
    previous_stock: Number(adj.previous_quantity.toString()),
    new_stock: Number(adj.new_quantity.toString())
  }));
};

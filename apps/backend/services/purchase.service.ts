import mongoose, { ClientSession } from 'mongoose';
import Big from 'big.js';
import { Purchase } from '../models/Purchase.js';
import { PurchaseDetail } from '../models/PurchaseDetail.js';
import { Product } from '../models/Product.js';
import { Inventory } from '../models/Inventory.js';
import { StockMovement, StockMovementType } from '../models/StockMovement.js';
import { SupplierPayment } from '../models/SupplierPayment.js';
import { Branch } from '../models/Branch.js';
import { BusinessOwnerId, ProductId, BranchId } from '../types/brands.js';
import { bumpBranchCacheVersion } from '../lib/redis.js';
import { CreatePurchaseDTO } from '@inventory/shared/validations';

export interface PurchaseFilters {
  status?: 'PENDING' | 'PARTIAL' | 'PAID';
  due_date?: Record<string, Date>;
  [key: string]: unknown;
}

export interface CreatePurchaseParams {
  ownerId: BusinessOwnerId;
  branchId: BranchId;
  payload: CreatePurchaseDTO;
}

const asDecimal128 = (value: unknown) => {
  if (value instanceof mongoose.Types.Decimal128) return value;
  if (value === undefined || value === null || value === '') return mongoose.Types.Decimal128.fromString('0');
  return mongoose.Types.Decimal128.fromString(String(value));
};

export class PurchaseService {
  public async createPurchase(params: CreatePurchaseParams, externalSession?: ClientSession) {
    const { ownerId, branchId, payload } = params;
    const { supplier, items, dueDate, exchange_rate } = payload;

    const isLocalSession = !externalSession;
    const session = externalSession || await mongoose.startSession();

    if (isLocalSession) {
      session.startTransaction();
    }

    try {
      const branch = await Branch.findOne({
        _id: branchId,
        owner_id: ownerId,
        is_active: true
      }).session(session);

      if (!branch) {
        throw new Error('La sucursal destino no existe o se encuentra inactiva.');
      }

      let total_cost = '0';

      const productIds = items.map(i => i.product_id);
      const products = await Product.find({ _id: { $in: productIds }, user: ownerId }).session(session);
      const productsMap = new Map(products.map(p => [p._id.toString(), p]));

      for (const item of items) {
        if (!productsMap.has(item.product_id.toString())) {
          throw new Error(`Producto con ID ${item.product_id} no encontrado o no te pertenece.`);
        }
        if (Big(String(item.quantity)).lte(0)) {
          throw new Error(`La cantidad para el producto ${productsMap.get(item.product_id.toString())!.name} debe ser mayor a cero.`);
        }
        const lineTotal = Big(String(item.quantity)).times(Big(String(item.unit_cost)));
        total_cost = Big(total_cost).plus(lineTotal).toString();
      }

      const defaultDueDate = new Date();
      defaultDueDate.setDate(defaultDueDate.getDate() + 30);

      const purchase = new Purchase({
        admin_id: ownerId,
        branch_id: branchId,
        supplier,
        total_cost,
        due_date: dueDate ? new Date(dueDate) : defaultDueDate,
        exchange_rate
      });
      await purchase.save({ session });

      for (const item of items) {
        const preInv = await Inventory.findOne({ branch_id: branchId, product_id: item.product_id, owner_id: ownerId }).session(session);
        const prevQty = preInv?.quantity ?? mongoose.Types.Decimal128.fromString('0');
        const quantityDecimal = asDecimal128(item.quantity);

        const invResult = await Inventory.findOneAndUpdate(
          { branch_id: branchId, product_id: item.product_id, owner_id: ownerId },
          { $inc: { quantity: quantityDecimal } },
          { upsert: true, session, new: true }
        );
        if (!invResult) throw new Error('Error al actualizar inventario en la compra');

        await StockMovement.create([{
          inventory_id: invResult._id,
          product_id: item.product_id,
          branch_id: branchId,
          owner_id: ownerId,
          type: StockMovementType.PURCHASE,
          quantity_change: quantityDecimal,
          previous_quantity: prevQty,
          new_quantity: invResult.quantity,
          created_by: ownerId
        }], { session });

        const detail = new PurchaseDetail({
          purchase_id: purchase._id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_cost: item.unit_cost
        });
        await detail.save({ session });
      }

      if (isLocalSession) {
        await session.commitTransaction();
        session.endSession();
      }

      await bumpBranchCacheVersion('products', String(ownerId), String(branchId));

      return purchase;
    } catch (error) {
      if (isLocalSession && session.inTransaction()) {
        await session.abortTransaction();
      }
      if (isLocalSession) {
        session.endSession();
      }
      throw error;
    }
  }

  public async fetchPurchases(
    businessOwnerId: BusinessOwnerId,
    filters: PurchaseFilters = {},
    skip = 0,
    limit = 0
  ) {
    const query = Purchase.find({ admin_id: businessOwnerId, ...filters } as Record<string, unknown>)
      .populate('admin_id', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip);

    if (limit > 0) query.limit(limit);

    return query.lean();
  }

  public async fetchPurchasesCount(
    businessOwnerId: BusinessOwnerId,
    filters: PurchaseFilters = {}
  ) {
    return Purchase.countDocuments({ admin_id: businessOwnerId, ...filters } as Record<string, unknown>);
  }

  public async fetchPurchaseById(
    id: string,
    businessOwnerId: BusinessOwnerId
  ) {
    const purchase = await Purchase.findOne({ _id: id, admin_id: businessOwnerId })
      .populate('admin_id', 'name email')
      .lean();

    if (!purchase) return null;

    const details = await PurchaseDetail.find({ purchase_id: id })
      .populate('product_id', 'name')
      .lean();

    return { purchase, details };
  }

  public async registerPayment(
    purchaseId: string,
    businessOwnerId: BusinessOwnerId,
    amount: number
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const purchase = await Purchase.findOne({ _id: purchaseId, admin_id: businessOwnerId }).session(session);
      if (!purchase) throw new Error('Compra no encontrada.');
      if (purchase.status === 'PAID') throw new Error('La compra ya se encuentra pagada completamente.');

      const currentPaidAmount = Big(purchase.paid_amount?.toString() || '0');
      const totalCost = Big(purchase.total_cost?.toString() || '0');
      const paymentAmount = Big(amount);

      let newPaidAmount = currentPaidAmount.plus(paymentAmount);
      let actualAmountPaid = paymentAmount;

      if (newPaidAmount.gte(totalCost)) {
        purchase.status = 'PAID';
        actualAmountPaid = paymentAmount.minus(newPaidAmount.minus(totalCost));
        purchase.paid_amount = totalCost.toString() as any;
        purchase.payment_date = new Date().toISOString() as any;
      } else {
        purchase.status = 'PARTIAL';
        purchase.paid_amount = newPaidAmount.toString() as any;
      }

      await purchase.save({ session });

      if (actualAmountPaid.gt(0)) {
        const payment = new SupplierPayment({
          purchase_id: purchase._id,
          admin_id: businessOwnerId,
          amount: actualAmountPaid.toString()
        });
        await payment.save({ session });
      }

      await session.commitTransaction();
      session.endSession();
      return purchase;
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
      throw error;
    }
  }

  public async fetchPayments(businessOwnerId: BusinessOwnerId) {
    return SupplierPayment.find({ admin_id: businessOwnerId })
      .populate('purchase_id', 'supplier')
      .sort({ createdAt: -1 })
      .lean();
  }
}

export const createPurchaseProcess = async (
  ownerId: BusinessOwnerId,
  branchId: BranchId,
  supplier: string,
  items: Array<{ product_id: ProductId | string; quantity: number | string; unit_cost: number | string }>,
  dueDate?: Date | string,
  exchange_rate?: string | null
) => {
  const payload: CreatePurchaseDTO = {
    supplier,
    items: items.map(item => ({
      product_id: item.product_id as any,
      quantity: Number(item.quantity),
      unit_cost: Number(item.unit_cost),
    })),
    ...(dueDate ? { dueDate } : {}),
    ...(exchange_rate !== undefined ? { exchange_rate } : {}),
  } as any;

  return new PurchaseService().createPurchase({ ownerId, branchId, payload });
};

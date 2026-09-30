import mongoose from 'mongoose';
import Big from 'big.js';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { Product } from '../models/Product.js';
import { Inventory } from '../models/Inventory.js';
import { StockMovement, StockMovementType } from '../models/StockMovement.js';
import { Branch } from '../models/Branch.js';
import { BusinessOwnerId, ActorId, ProductId, BranchId } from '../types/brands.js';
import type { PaymentMethod } from '@inventory/shared';
import { bumpBranchCacheVersion } from '../lib/redis.js';
import { InsufficientStockError } from '../errors/InsufficientStockError.js';

export interface SaleItemInput {
  product_id: ProductId;
  quantity: string;
  unit_price: string;
}

const asDecimal128 = (value: unknown) => {
  if (value instanceof mongoose.Types.Decimal128) return value;
  if (value === undefined || value === null || value === '') return mongoose.Types.Decimal128.fromString('0');
  return mongoose.Types.Decimal128.fromString(String(value));
};

export const createSaleProcess = async (
  businessOwnerId: BusinessOwnerId,
  soldBy: ActorId,
  branchId: BranchId,
  items: Array<{ product_id: ProductId | string; quantity: number | string; unit_price: number | string }>,
  payment_method: PaymentMethod,
  exchange_rate: string | null = null,
  shiftId?: mongoose.Types.ObjectId,
  sessionArg?: mongoose.ClientSession
) => {
  const shouldCreateSession = !sessionArg;
  const session = sessionArg ?? await mongoose.startSession();

  if (shouldCreateSession) {
    session.startTransaction();
  }

  try {
    const branch = await Branch.findOne({
      _id: branchId,
      owner_id: businessOwnerId,
      is_active: true
    }).session(session);

    if (!branch) {
      throw new Error('La sucursal de venta no existe o se encuentra inactiva.');
    }

    let total_amount = '0';
    const productIds = items.map(i => i.product_id);
    const products = await Product.find({ _id: { $in: productIds }, user: businessOwnerId })
      .populate('category', 'max_debt_limit')
      .session(session);
    const productsMap = new Map(products.map(p => [p._id.toString(), p]));

    for (const item of items) {
      const product = productsMap.get(item.product_id.toString());
      if (!product) {
        throw new Error(`Producto con ID ${item.product_id} no encontrado o no te pertenece.`);
      }

      const qty = Big(String(item.quantity));
      console.log('🔥 SALE DOMAIN VALIDATION', {
        productId: item.product_id,
        quantity: item.quantity,
        unitType: product.unit_type,
      });

      if (qty.lte(0)) {
        throw new Error(`La cantidad para el producto ${product.name} debe ser mayor a cero.`);
      }
      if (product.unit_type === 'unidad') {
        if (!qty.eq(qty.round(0, 0))) {
          throw new Error(`El producto ${product.name} se vende por unidades y no acepta decimales.`);
        }
      }

      const lineTotal = qty.times(Big(String(item.unit_price)));
      total_amount = Big(total_amount).plus(lineTotal).toString();
    }

    for (const item of items) {
      const product = productsMap.get(item.product_id.toString())!;
      const qtyDecimal = asDecimal128(item.quantity);
      const negQtyDecimal = asDecimal128(Big(String(item.quantity)).times(-1).toString());

      const preInventory = await Inventory.findOne({ branch_id: branchId, product_id: item.product_id, owner_id: businessOwnerId }).session(session);
      const previousQuantity = preInventory?.quantity ?? mongoose.Types.Decimal128.fromString('0');

      let result = await Inventory.findOneAndUpdate(
        {
          branch_id: branchId,
          product_id: item.product_id,
          owner_id: businessOwnerId,
          quantity: { $gte: qtyDecimal }
        },
        { $inc: { quantity: negQtyDecimal } },
        { session, new: true }
      );

      if (!result) {
        throw new InsufficientStockError(product.name, item.product_id.toString());
      }

      await StockMovement.create([{
        inventory_id: result._id,
        product_id: item.product_id,
        branch_id: branchId,
        owner_id: businessOwnerId,
        type: StockMovementType.SALE,
        quantity_change: negQtyDecimal,
        previous_quantity: previousQuantity,
        new_quantity: result.quantity,
        reference_id: undefined,
        created_by: soldBy
      }], { session });
    }

    const sale = new Sale({
      shift_id: shiftId,
      customer_id: businessOwnerId,
      sold_by: soldBy,
      branch_id: branchId,
      total_amount,
      payment_method: (payment_method === 'Pago Móvil' ? 'Pago Movil' : payment_method) as any,
      exchange_rate,
      status: 'completed'
    });
    await sale.save({ session });

    for (const item of items) {
      const detail = new SaleDetail({
        sale_id: sale._id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price
      });

      await detail.save({ session });
    }

    if (shouldCreateSession) {
      await session.commitTransaction();
      session.endSession();
    }

    await bumpBranchCacheVersion('products', String(businessOwnerId), String(branchId));
    return sale;
  } catch (error) {
    if (shouldCreateSession && session.inTransaction()) {
      await session.abortTransaction();
    }
    if (shouldCreateSession) {
      session.endSession();
    }
    throw error;
  }
};

export const fetchSales = async (
  businessOwnerId: BusinessOwnerId,
  sellerId: ActorId | null = null
) => {
  const filter: Record<string, unknown> = { customer_id: businessOwnerId };
  if (sellerId) filter.sold_by = sellerId;

  return Sale.find(filter)
    .populate('customer_id', 'name email')
    .populate('sold_by', 'name email')
    .sort({ createdAt: -1 })
    .lean();
};

export const fetchSaleById = async (
  id: string,
  businessOwnerId: BusinessOwnerId,
  isEmployee = false
) => {
  const filter = isEmployee
    ? { _id: id, sold_by: businessOwnerId }
    : { _id: id, customer_id: businessOwnerId };

  const sale = await Sale.findOne(filter)
    .populate('customer_id', 'name email')
    .populate('sold_by', 'name email')
    .lean();

  if (!sale) return null;

  const items = await SaleDetail.find({ sale_id: id })
    .populate('product_id', 'name price')
    .lean();

  return { ...sale, items };
};

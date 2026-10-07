/**
 * @file services.unit.test.js
 * @description Pruebas UNITARIAS de la capa de Servicios (sale, purchase, adjustment).
 *
 * A diferencia de los tests de integración (que usan Supertest + toda la pila HTTP),
 * aquí llamamos directamente a las funciones del servicio para verificar:
 *  ✅ commitTransaction cuando todos los datos son válidos
 *  ✅ abortTransaction (rollback) cuando falta stock o el producto no existe
 *  ✅ que el roll-back no deja datos huérfanos en la BD
 *
 * REQUIERE MongoMemoryReplSet porque los servicios usan Transacciones ACID.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// ─── Modelos ──────────────────────────────────────────────────────────────────
import { User }                from '../models/User.js';
import { Category }            from '../models/Category.js';
import { Product }             from '../models/Product.js';
import { Sale }                from '../models/Sale.js';
import { SaleDetail }          from '../models/SaleDetail.js';
import { Purchase }            from '../models/Purchase.js';
import { PurchaseDetail }      from '../models/PurchaseDetail.js';
import { StockMovement } from '../models/StockMovement.js';
import { Branch }              from '../models/Branch.ts';
import { Inventory }     from '../models/Inventory.ts';
import { CashShift } from '../models/CashShift.model.ts';

// ─── Servicios bajo prueba ────────────────────────────────────────────────────
import { createSaleProcess, fetchSales, fetchSaleById } from '../services/sale.service.js';
import { createPurchaseProcess, fetchPurchases, fetchPurchaseById } from '../services/purchase.service.js';
import { createAdjustmentProcess, fetchAdjustments } from '../services/adjustment.service.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
  },
  getOrSetCache: vi.fn(async (_key, fn) => ({ data: await fn(), fromCache: false })),
  invalidateCache: vi.fn(async () => {}),
}));

vi.mock('../mailtrap/emails.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

// ─── Infraestructura de BD ────────────────────────────────────────────────────
let mongoReplSet;
let userId, categoryId, branchId, shiftId;

beforeAll(async () => {
  mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoReplSet.getUri();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(mongoUri);
  await new Promise((r) => setTimeout(r, 1500));

  const user = await User.create({
    email: `services_unit_${Date.now()}@test.com`,
    password: 'hashed_irrelevant',
    name: 'Service Tester',
    role: 'admin',
  });
  userId = user._id;

  const category = await Category.create({ name: 'Unit Test Category', user: userId });
  categoryId = category._id;

  // Crear sucursal de prueba
  const branch = await Branch.create({
    name: 'Sucursal de Pruebas',
    address: 'Zona Industrial 1',
    owner_id: userId,
    is_active: true
  });
  branchId = branch._id;

  const shift = await CashShift.create({
    branch_id: branchId,
    user_id: userId,
    status: 'OPEN',
    opening_balance: 100,
  });
  shiftId = shift._id;
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoReplSet) await mongoReplSet.stop();
});

afterEach(async () => {
  await Sale.deleteMany({});
  await SaleDetail.deleteMany({});
  await Purchase.deleteMany({});
  await PurchaseDetail.deleteMany({});
  await StockMovement.deleteMany({});
  await Inventory.deleteMany({});
  await mongoose.connection.collection('products').drop().catch(() => {});
  vi.clearAllMocks();
});

let _productCounter = 0;
const createProduct = async (stock = 20, extra = {}) => {
  const product = await Product.create({
    name: 'Producto Test',
    price: 100,
    unit_type: 'unidad',
    category: categoryId,
    user: userId,
    barcode: `TEST-${Date.now()}-${++_productCounter}`,
    ...extra,
  });

  if (stock > 0) {
    await Inventory.create({ owner_id: userId, 
      product_id: product._id,
      branch_id: branchId,
      stock,
      min_quantity: 0
    });
  }

  return product;
};

const executeSale = async (items, paymentMethod) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const sale = await createSaleProcess(
      userId,
      userId,
      branchId,
      items,
      paymentMethod,
      null,
      shiftId,
      null,
      session,
    );

    await session.commitTransaction();

    return sale;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};


// ══════════════════════════════════════════════════════════════════════════════
// 🛒  SALE SERVICE
// ══════════════════════════════════════════════════════════════════════════════
describe('sale.service — createSaleProcess()', () => {

  it('✅ commitTransaction: crea Sale + SaleDetail y descuenta stock con datos válidos', async () => {
    const product = await createProduct(20);

    const sale = await executeSale([
      { product_id: product._id.toString(), quantity: '5', unit_price: '100' }
    ], 'Efectivo');

    // El servicio debe retornar el documento de venta
    expect(sale).toBeDefined();
    expect(sale.total_amount.toString()).toBe('500'); // 5 * 100
    expect(sale.status).toBe('completed');
    expect(sale.business_owner_id.toString()).toBe(userId.toString());
    expect(sale.customer_id).toBeNull();

    // Verificar stock descontado en BD (Inventory)
    const updatedInventory = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(updatedInventory.quantity.toString()).toBe('15'); // 20 - 5

    // Verificar que el detalle se guardó
    const details = await SaleDetail.find({ sale_id: sale._id });
    expect(details).toHaveLength(1);
    expect(details[0].quantity.toString()).toBe('5');
    expect(details[0].unit_price.toString()).toBe('100');
  });

  it('✅ commitTransaction con cantidades fraccionarias (kg)', async () => {
    const product = await createProduct(10, { unit_type: 'kg' });

    const sale = await executeSale([
      { product_id: product._id.toString(), quantity: '3.75', unit_price: '50' }
    ], 'Tarjeta');

    expect(sale.total_amount.toString()).toBe('187.5'); // 3.75 * 50

    const updatedInventory = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(updatedInventory.quantity.toString()).toBe('6.25'); // 10 - 3.75
  });

  it('✅ commitTransaction con múltiples items', async () => {
    const p1 = await createProduct(20, { name: 'Producto A' });
    const p2 = await createProduct(15, { name: 'Producto B' });

    const sale = await executeSale([
      { product_id: p1._id.toString(), quantity: '4', unit_price: '100' },
      { product_id: p2._id.toString(), quantity: '2', unit_price: '200' }
    ], 'Tarjeta');

    expect(sale.total_amount.toString()).toBe('800');

    const invA = await Inventory.findOne({ product_id: p1._id, branch_id: branchId });
    const invB = await Inventory.findOne({ product_id: p2._id, branch_id: branchId });
    expect(invA.quantity.toString()).toBe('16');  // 20 - 4
    expect(invB.quantity.toString()).toBe('13');  // 15 - 2
  });

  it('🔴 abortTransaction: lanza error si stock es insuficiente — BD queda INTACTA', async () => {
    const product = await createProduct(5); // Solo 5 unidades

    await expect(
      executeSale([
        { product_id: product._id.toString(), quantity: '50', unit_price: '100' }
      ], 'Efectivo')
    ).rejects.toThrow('Stock insuficiente');

    // ROLLBACK VERIFICADO: el stock NO debe haber cambiado
    const invAfter = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(invAfter.quantity.toString()).toBe('5'); // intacto

    // ROLLBACK VERIFICADO: ninguna Venta ni Detalle debe haberse guardado
    const salesCount = await Sale.countDocuments();
    const detailsCount = await SaleDetail.countDocuments();
    expect(salesCount).toBe(0);
    expect(detailsCount).toBe(0);
  });

  it('🔴 abortTransaction: lanza error si product_id no pertenece al usuario', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(
      executeSale([
        { product_id: fakeId, quantity: '1', unit_price: '10' }
      ], 'Efectivo')
    ).rejects.toThrow('no encontrado');

    // Sin datos huérfanos
    expect(await Sale.countDocuments()).toBe(0);
    expect(await SaleDetail.countDocuments()).toBe(0);
  });
});

describe('sale.service — fetchSales() y fetchSaleById()', () => {

  it('fetchSales retorna lista vacía cuando no hay ventas', async () => {
    const sales = await fetchSales(userId);
    expect(sales).toEqual([]);
  });

  it('fetchSales retorna solo las ventas del usuario, ordenadas por fecha desc', async () => {
    const product = await createProduct(50);

    await executeSale([
      { product_id: product._id.toString(), quantity: '1', unit_price: '10' }
    ], 'Efectivo');
    await executeSale([
      { product_id: product._id.toString(), quantity: '1', unit_price: '20' }
    ], 'Tarjeta');

    const sales = await fetchSales(userId);
    expect(sales).toHaveLength(2);
    // Ordenadas desc: la última creada es la primera
    expect(sales[0].total_amount.toString()).toBe('20');
    expect(sales[1].total_amount.toString()).toBe('10');
  });

  it('fetchSaleById retorna null para ID inexistente', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const result = await fetchSaleById(fakeId.toString(), userId);
    expect(result).toBeNull();
  });

  it('fetchSaleById retorna venta con items populados', async () => {
    const product = await createProduct(20, { name: 'Coca Cola' });
    const sale = await executeSale([
      { product_id: product._id.toString(), quantity: '3', unit_price: '15' }
    ], 'Divisas');

    const result = await fetchSaleById(sale._id.toString(), userId);

    expect(result).not.toBeNull();
    expect(result.payment_method).toBe('Divisas');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].product_id.name).toBe('Coca Cola'); // populate funcionando
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 🛍️  PURCHASE SERVICE
// ══════════════════════════════════════════════════════════════════════════════
describe('purchase.service — createPurchaseProcess()', () => {

  it('✅ commitTransaction: crea Purchase + PurchaseDetail e INCREMENTA stock', async () => {
    const product = await createProduct(0); // stock inicial 0

    const purchase = await createPurchaseProcess(
      userId,
      branchId,
      'Proveedor XYZ',
      [{ product_id: product._id.toString(), quantity: 10, unit_cost: 50 }]
    );

    expect(purchase).toBeDefined();
    expect(purchase.total_cost.toString()).toBe('500'); // 10 * 50
    expect(purchase.supplier).toBe('Proveedor XYZ');

    // Stock incrementado en Inventory
    const branchInv = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(branchInv.quantity.toString()).toBe('10'); // 0 + 10

    // Detalle guardado
    const details = await PurchaseDetail.find({ purchase_id: purchase._id });
    expect(details).toHaveLength(1);
    expect(details[0].quantity.toString()).toBe('10');
  });

  it('✅ commitTransaction con cantidades fraccionarias (kg)', async () => {
    const product = await createProduct(0, { unit_type: 'kg' });

    const purchase = await createPurchaseProcess(
      userId,
      branchId,
      'Distribuidora',
      [{ product_id: product._id.toString(), quantity: 15.5, unit_cost: 100 }]
    );

    expect(purchase.total_cost.toString()).toBe('1550'); // 15.5 * 100
    const branchInv = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(branchInv.quantity.toString()).toBe('15.5');
  });

  it('🔴 abortTransaction: lanza error si product_id no existe — BD queda INTACTA', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(
      createPurchaseProcess(
        userId,
        branchId,
        'Proveedor Malo',
        [{ product_id: fakeId, quantity: 5, unit_cost: 100 }]
      )
    ).rejects.toThrow('no encontrado');

    // Ninguna compra ni detalle huérfano
    expect(await Purchase.countDocuments()).toBe(0);
    expect(await PurchaseDetail.countDocuments()).toBe(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 🔧  ADJUSTMENT SERVICE
// ══════════════════════════════════════════════════════════════════════════════
describe('adjustment.service — createAdjustmentProcess()', () => {

  it('✅ commitTransaction: actualiza stock del producto y registra el historial', async () => {
    const product = await createProduct(10);

    const adjustment = await createAdjustmentProcess(
      userId, userId, branchId, product._id.toString(), 25, 'initial_count', 'Carga inicial'
    );

    expect(adjustment).toBeDefined();
    expect(adjustment.previous_quantity.toString()).toBe('10');
    expect(adjustment.new_quantity.toString()).toBe('25');
    expect(adjustment.quantity_change.toString()).toBe('15');
    expect(adjustment.reason).toBe('initial_count');

    // Stock actualizado en Inventory
    const branchInv = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(branchInv.quantity.toString()).toBe('25');
  });

  it('✅ commitTransaction: registra ajuste negativo (mermas/daños)', async () => {
    const product = await createProduct(30);

    const adjustment = await createAdjustmentProcess(
      userId, userId, branchId, product._id.toString(), 22, 'damaged', 'Rotura de embalaje'
    );

    expect(adjustment.quantity_change.toString()).toBe('-8'); // 22 - 30
    const branchInv = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(branchInv.quantity.toString()).toBe('22');
  });

  it('🔴 abortTransaction: lanza error si new_quantity === stock actual', async () => {
    const product = await createProduct(15);

    await expect(
      createAdjustmentProcess(userId, userId, branchId, product._id.toString(), 15, 'correction', '')
    ).rejects.toThrow('igual al stock actual');

    // Stock no cambia, no se registra historial
    const branchInv = await Inventory.findOne({ product_id: product._id, branch_id: branchId });
    expect(branchInv.quantity.toString()).toBe('15');
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it('🔴 abortTransaction: lanza error si el producto no existe', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(
      createAdjustmentProcess(userId, userId, branchId, fakeId, 50, 'correction', '')
    ).rejects.toThrow('no encontrado');

    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it('fetchAdjustments retorna historial ordenado desc con product_id populado', async () => {
    const product = await createProduct(5, { name: 'Agua Pura' });

    await createAdjustmentProcess(userId, userId, branchId, product._id.toString(), 10, 'initial_count', '');
    await createAdjustmentProcess(userId, userId, branchId, product._id.toString(), 20, 'correction', '');

    const adjustments = await fetchAdjustments(userId);

    expect(adjustments).toHaveLength(2);
    // Orden desc: el más reciente primero
    expect(adjustments[0].new_quantity.toString()).toBe('20');
    expect(adjustments[1].new_quantity.toString()).toBe('10');
    // Populate funcionando
    expect(adjustments[0].product_id.name).toBe('Agua Pura');
  });
});

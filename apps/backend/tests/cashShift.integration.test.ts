import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../server.js';
import { User } from '../models/User.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { Branch } from '../models/Branch.ts';
import { Inventory } from '../models/Inventory.ts';
import { CashShift } from '../models/CashShift.model.ts';
import { Customer } from '../models/Customer.ts';
import { CustomerPayment } from '../models/CustomerPayment.js';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import { getAuthHeadersForUser } from './helpers/auth.js';

// Mock de emails
vi.mock('../mailtrap/emails.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

// Mock Redis COMPLETO
vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    exists: vi.fn(async () => 0),
    sismember: vi.fn(async () => false),
    sadd: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    pipeline: vi.fn(() => ({
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn(async () => []),
    })),
  },
  getOrSetCache: vi.fn(async (_key, fn) => ({ data: await fn(), fromCache: false })),
  invalidateCache: vi.fn(async () => { }),
  bumpCacheVersion: vi.fn(async () => { }),
  bumpBranchCacheVersion: vi.fn(async () => { }),
  getCacheVersion: vi.fn(async () => 0),
  buildPaginatedKey: vi.fn((_p, _v, _pg, _l, uid) => `mock:${uid}`),
}));

let mongoReplSet;

beforeAll(async () => {
  mongoReplSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, launchTimeout: 60000 },
  });
  const mongoUri = mongoReplSet.getUri();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(mongoUri);
  // Esperar a que el replica set esté listo para transacciones
  await new Promise((r) => setTimeout(r, 1500));

  // Sincronizar índices (especialmente el unique partial de CashShift)
  await CashShift.syncIndexes();
  await Sale.syncIndexes();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoReplSet) {
    await mongoReplSet.stop();
  }
});

afterEach(async () => {
  await CashShift.deleteMany({});
  await Sale.deleteMany({});
  await SaleDetail.deleteMany({});
  await Product.deleteMany({});
  await Inventory.deleteMany({});
  await Customer.deleteMany({});
  await CustomerPayment.deleteMany({});
  vi.clearAllMocks();
});

describe('CashShift & Sales Integration Test Suite', () => {
  let authHeaders;
  let userId;
  let categoryId;
  let productId;
  let branchId;

  beforeAll(async () => {
    // Crear usuario admin de prueba
    const testEmail = `shift_test_${Date.now()}@example.com`;
    const hashedPassword = await bcryptjs.hash('password123', 10);
    const user = await User.create({
      email: testEmail,
      password: hashedPassword,
      name: 'Shift Tester',
      role: 'admin',
    });
    userId = user._id.toString();

    authHeaders = getAuthHeadersForUser(user._id, user.role);

    // Crear categoría
    const category = new Category({ name: 'Test Category CashShift', user: userId });
    await category.save();
    categoryId = category._id.toString();

    // Crear sucursal de prueba
    const branch = await Branch.create({
      name: 'Sucursal CashShift',
      address: 'Calle de los Turnos 99',
      owner_id: userId,
      is_active: true,
    });
    branchId = branch._id.toString();
  });

  // Helper: crear un producto y su stock antes de cada test que lo necesite
  const createProductWithStock = async (name = 'Producto Test', price = 100, stock = 50) => {
    const product = new Product({
      name,
      price,
      barcode: `BC-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      unit_type: 'unidad',
      category: categoryId,
      user: userId,
    });
    await product.save();
    await Inventory.create({
      owner_id: userId,
      product_id: product._id,
      branch_id: branchId,
      quantity: String(stock),
      min_stock_alert: '0',
    });
    return product._id.toString();
  };

  // ─── Test 1: Rechazo de venta sin turno abierto ────────────────────────────
  it('Test 1: Debe responder 403 al intentar vender sin un turno abierto', async () => {
    productId = await createProductWithStock();

    const salePayload = {
      customer_id: userId,
      payment_method: 'Efectivo',
      items: [
        {
          product_id: productId,
          quantity: '2',
          unit_price: '50.00',
        },
      ],
    };

    const fakeShiftId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post('/api/sales')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': fakeShiftId })
      .send(salePayload);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('No existe un turno de caja abierto');
  });

  // ─── Test 2: Apertura de turno exitosa ──────────────────────────────────────
  it('Test 2: Debe abrir un turno de caja con opening_balance', async () => {
    const res = await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({ opening_balance: '1000.00' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('OPEN');
    expect(res.body.data.opening_balance).toBe('1000.00');
  });

  // ─── Test 3: Prevención atómica de turnos duplicados ────────────────────────
  it('Test 3: Debe responder 409 al intentar abrir dos turnos concurrentes', async () => {
    const openPayload = { opening_balance: '1000.00' };

    const firstRes = await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send(openPayload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.data.status).toBe('OPEN');

    const secondRes = await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send(openPayload);

    expect(secondRes.status).toBe(409);
    expect(secondRes.body.message).toContain('El operador ya posee un turno abierto');
  });

  // ─── Test 4: Persistencia de Venta vinculada a shift_id ────────────────────
  it('Test 4: Debe registrar la venta inyectando el shift_id correcto del turno activo', async () => {
    productId = await createProductWithStock();

    // 1. Abrir turno
    const openRes = await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({ opening_balance: '500.00' });
    const activeShiftId = openRes.body.data._id;

    // 2. Ejecutar venta intentando inyectar un shift_id arbitrario en el body
    const fakeShiftId = new mongoose.Types.ObjectId().toString();
    const salePayload = {
      customer_id: null,
      payment_method: 'Efectivo',
      shift_id: fakeShiftId, // El controlador debe ignorar esto
      items: [
        {
          product_id: productId,
          quantity: '3',
          unit_price: '15.50',
        },
      ],
    };

    const saleRes = await request(app)
      .post('/api/sales')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': activeShiftId })
      .set('x-idempotency-key', crypto.randomUUID())
      .send(salePayload);

    if (saleRes.status !== 201) {
      console.error('Test 4 Sale Error:', saleRes.body);
    }
    expect(saleRes.status).toBe(201);

    const saleDoc = await Sale.findById(saleRes.body.sale._id);
    expect(saleDoc).not.toBeNull();

    const activeShift = await CashShift.findOne({
      cashier_id: userId,
      status: 'OPEN',
    });
    expect(saleDoc.shift_id.toString()).toBe(activeShift._id.toString());
    expect(saleDoc.shift_id.toString()).not.toBe(fakeShiftId);
  });

  // ─── Test 5: Arqueo exacto al cierre y bloqueo de ventas posteriores ───────
  it('Test 5: Debe calcular expected_balance exacto al cerrar y bloquear ventas subsecuentes', async () => {
    productId = await createProductWithStock('Producto Arqueo', 200, 100);

    // 1. Abrir turno con 250.75
    const openRes = await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({ opening_balance: '250.75' });
    const shiftId = openRes.body.data._id;

    // 2. Venta 1: 2 * 100.25 = 200.50
    const product2 = await createProductWithStock('Producto A', 100.25, 100);
    const sale1Res = await request(app)
      .post('/api/sales')
      .set({
        ...authHeaders,
        'x-branch-id': branchId.toString(),
        'x-shift-id': shiftId,
      })
      .set('x-idempotency-key', crypto.randomUUID())
      .send({
        customer_id: null,
        payment_method: 'Efectivo',
        items: [
          { product_id: product2, quantity: '2', unit_price: '100.25' },
        ],
      });

    console.log('Venta 1:', sale1Res.status, sale1Res.body);
    expect(sale1Res.status).toBe(201);

    // 3. Venta 2: 1 * 49.25 = 49.25
    const product3 = await createProductWithStock('Producto B', 49.25, 100);
    const sale2Res = await request(app)
      .post('/api/sales')
      .set({
        ...authHeaders,
        'x-branch-id': branchId.toString(),
        'x-shift-id': shiftId,
      })
      .set('x-idempotency-key', crypto.randomUUID())
      .send({
        customer_id: null,
        payment_method: 'Efectivo',
        items: [
          { product_id: product3, quantity: '1', unit_price: '49.25' },
        ],
      });

    console.log('Venta 2:', sale2Res.status, sale2Res.body);
    expect(sale2Res.status).toBe(201);

    // 4. Cerrar turno.
    // Total ventas = 200.50 + 49.25 = 249.75
    // Saldo esperado = 250.75 + 249.75 = 500.50
    const closeRes = await request(app)
      .post('/api/shifts/close')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({ closing_balance: '500.50' });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
    expect(closeRes.body.data.total_sales_amount).toBe('249.75');
    expect(closeRes.body.data.expected_balance).toBe('500.50');

    // 5. Confirmar que una venta posterior es rechazada
    const postCloseSaleRes = await request(app)
      .post('/api/sales')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
      .set('x-idempotency-key', crypto.randomUUID())
      .send({
        customer_id: null,
        payment_method: 'Efectivo',
        items: [{ product_id: productId, quantity: '1', unit_price: '10.00' }],
      });

    expect(postCloseSaleRes.status).toBe(403);
    expect(postCloseSaleRes.body.message).toContain('No existe un turno de caja abierto');
  });

  // ─── Test 6: Consultar turno activo ────────────────────────────────────────
  it('Test 6: Debe retornar el turno activo con GET /api/shifts/active', async () => {
    // Sin turno → null
    const noShiftRes = await request(app)
      .get('/api/shifts/active')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() });

    expect(noShiftRes.status).toBe(200);
    expect(noShiftRes.body.data).toBeNull();

    // Abrir turno → devuelve el turno
    await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({ opening_balance: '300.00' });

    const activeRes = await request(app)
      .get('/api/shifts/active')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() });

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data).not.toBeNull();
    expect(activeRes.body.data.status).toBe('OPEN');
    expect(activeRes.body.data.opening_balance).toBe('300.00');
  });

  // ─── Test 7: Conciliación multimoneda (USD y VES) ──────────────────────────
  it('Test 7: Debe conciliar saldos físicos por separado en USD y VES al cerrar el turno', async () => {
    // Crear producto y stock propios para este test.
    productId = await createProductWithStock('Producto Test 7', 50, 10);

    // 1. Abrir turno con saldos independientes en USD y VES
    const openRes = await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({
        opening_balance_usd: '100.00',
        opening_balance_ves: '500.00',
      });

    expect(openRes.status).toBe(201);
    const shift = openRes.body.data;
    expect(shift.opening_balance_usd).toBe('100.00');
    expect(shift.opening_balance_ves).toBe('500.00');

    // 2. Venta al contado de $50.00
    const saleRes = await request(app)
      .post('/api/sales')
      .set({
        ...authHeaders,
        'x-branch-id': branchId.toString(),
        'x-shift-id': shift._id,
      })
      .set('x-idempotency-key', crypto.randomUUID())
      .send({
        customer_id: null,
        payment_method: 'Efectivo',
        items: [{ product_id: productId, quantity: '1', unit_price: '50.00' }],
      });

    expect(saleRes.status).toBe(201);
    expect(saleRes.body.sale.total_amount).toBe('50');

    // 3. Crear abono recibido en VES (1000.00 VES) vinculado al turno
    await CustomerPayment.create({
      sale_id: new mongoose.Types.ObjectId(),
      customer_id: new mongoose.Types.ObjectId(),
      business_owner_id: userId,
      shift_id: shift._id,
      received_by: userId,
      amount_received: '1000.00',
      currency: 'VES',
      amount_applied_usd: '20.00',
      exchange_rate: '50.00',
      exchange_rate_type: 'COMERCIAL',
      payment_method: 'Pago Movil',
      idempotency_key: crypto.randomUUID(),
      date: new Date(),
    });

    // 4. Cerrar turno enviando arqueo físico para ambas monedas
    const closeRes = await request(app)
      .post('/api/shifts/close')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({
        closing_balance_usd: '150.00',
        closing_balance_ves: '500.00',
      });

    expect(closeRes.status).toBe(200);
    const closed = closeRes.body.data;
    expect(closed.status).toBe('CLOSED');
    // Saldo esperado USD: 100.00 (apertura) + 50.00 (venta contado) = 150.00
    expect(closed.expected_balance_usd).toBe('150.00');
    expect(closed.closing_balance_usd).toBe('150.00');
    // Saldo esperado VES: 500.00 (apertura) + 0.00 (abono electrónico no aumenta gaveta física) = 500.00
    expect(closed.expected_balance_ves).toBe('500.00');
    expect(closed.closing_balance_ves).toBe('500.00');
    expect(closed.total_payments_ves).toBe('1000.00');
  });

  // ─── Test 8: Conciliación multimoneda con abono físico en VES ─────────────
  it('Test 8: Debe incrementar el saldo físico en VES cuando se registra un abono en efectivo', async () => {
    // 1. Abrir turno con saldos independientes en USD y VES
    const openRes = await request(app)
      .post('/api/shifts/open')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({
        opening_balance_usd: '100.00',
        opening_balance_ves: '500.00',
      });

    expect(openRes.status).toBe(201);
    const shift = openRes.body.data;
    expect(shift.opening_balance_usd).toBe('100.00');
    expect(shift.opening_balance_ves).toBe('500.00');

    // 2. Crear abono recibido en VES físico (300.00 VES en Efectivo) vinculado al turno
    await CustomerPayment.create({
      sale_id: new mongoose.Types.ObjectId(),
      customer_id: new mongoose.Types.ObjectId(),
      business_owner_id: userId,
      shift_id: shift._id,
      received_by: userId,
      amount_received: '300.00',
      currency: 'VES',
      amount_applied_usd: '6.00',
      exchange_rate: '50.00',
      exchange_rate_type: 'COMERCIAL',
      payment_method: 'Efectivo',
      idempotency_key: crypto.randomUUID(),
      date: new Date(),
    });

    // 3. Cerrar turno enviando arqueo físico: 500.00 apertura + 300.00 efectivo = 800.00 VES
    const closeRes = await request(app)
      .post('/api/shifts/close')
      .set({ ...authHeaders, 'x-branch-id': branchId.toString() })
      .send({
        closing_balance_usd: '100.00',
        closing_balance_ves: '800.00',
      });

    expect(closeRes.status).toBe(200);
    const closed = closeRes.body.data;
    expect(closed.status).toBe('CLOSED');
    expect(closed.expected_balance_usd).toBe('100.00');
    expect(closed.closing_balance_usd).toBe('100.00');
    expect(closed.expected_balance_ves).toBe('800.00');
    expect(closed.closing_balance_ves).toBe('800.00');
    expect(closed.total_payments_ves).toBe('300.00');
  });
});

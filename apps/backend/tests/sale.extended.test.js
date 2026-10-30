import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../server.js';
import { User } from '../models/User.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Sale } from '../models/Sale.js';
import { SaleDetail } from '../models/SaleDetail.js';
import { Branch } from '../models/Branch.js';
import { CashShift } from '../models/CashShift.model.ts';
import { Inventory } from '../models/Inventory.js';
import { CustomerPayment } from '../models/CustomerPayment.js';
import bcryptjs from 'bcryptjs';
import { getAuthHeadersForUser } from './helpers/auth.js';

vi.mock('../mailtrap/emails.js', () => ({
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

// Mock Redis COMPLETO: cubre tanto lib/redis.js como cache.middleware.js
vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(async () => null),   // MISS de caché → pasa al controlador
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
  },
  getOrSetCache: vi.fn(async (_key, fn) => ({ data: await fn(), fromCache: false })),
  invalidateCache: vi.fn(async () => { }),
  bumpCacheVersion: vi.fn(async () => { }),
  getCacheVersion: vi.fn(async () => 0),
  buildPaginatedKey: vi.fn((_p, _v, _pg, _l, uid) => `mock:${uid}`),
}));

let mongoReplSet;

beforeAll(async () => {
  mongoReplSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = mongoReplSet.getUri();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(mongoUri);
  await new Promise((r) => setTimeout(r, 1500));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoReplSet) await mongoReplSet.stop();
});

afterEach(async () => {
  await Sale.deleteMany({});
  await SaleDetail.deleteMany({});
  await mongoose.connection.collection('products').drop().catch(() => { });
  await Inventory.deleteMany({});
  vi.clearAllMocks();
});

describe('Sale Controllers — Extended Tests (Cache + Edge Cases)', () => {
  let authHeaders;
  let userId;
  let categoryId;
  let productId;
  let branchId;
  let shiftId;

  beforeAll(async () => {
    const hashedPassword = await bcryptjs.hash('password123', 10);
    const user = await User.create({
      email: `salesext_${Date.now()}@example.com`,
      password: hashedPassword,
      name: 'Sales Extended Admin',
      role: 'admin',
    });
    userId = user._id.toString();

    authHeaders = getAuthHeadersForUser(user._id, user.role);

    const category = new Category({ name: 'Sales Test Category', user: userId });
    await category.save();
    categoryId = category._id.toString();

    const branch = await Branch.create({
      name: 'Sucursal Extended Test',
      address: 'Av. Test 123',
      owner_id: userId,
      is_active: true,
    });
    branchId = branch._id.toString();

    const shift = await CashShift.create({
      branch_id: branchId,
      user_id: userId,
      status: 'OPEN',
      opening_balance: 100
    });
    shiftId = shift._id.toString();
  });

  beforeEach(async () => {
    // Producto limpio antes de cada test
    const product = new Product({
      name: 'Agua Mineral 1L',
      price: 15,
      unit_type: 'unidad',
      category: categoryId,
      user: userId,
    });
    await product.save();
    productId = product._id.toString();

    // Inventory con stock = 20 (equivalente al stock inicial del test)
    await Inventory.create({
      owner_id: userId,
      product_id: productId,
      branch_id: branchId,
      quantity: 20,
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Respuesta incluye fromCache
  // ─────────────────────────────────────────────────────────────────────
  describe('GET /api/sales — campo fromCache', () => {
    it('GET /api/sales debe incluir el campo fromCache en la respuesta', async () => {
      const response = await request(app)
        .get('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('fromCache');
    });

    it('GET /api/sales/:id debe incluir el campo fromCache en la respuesta', async () => {
      // Crear venta primero
      const createRes = await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Efectivo',
          branch_id: branchId,
          items: [{ product_id: productId, quantity: 1, unit_price: 15 }],
        });
      const saleId = createRes.body.sale._id;

      const response = await request(app)
        .get(`/api/sales/${saleId}`)
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('fromCache');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Una venta debe disminuir el stock del producto
  // ─────────────────────────────────────────────────────────────────────
  describe('POST /api/sales — el stock del producto se descuenta correctamente', () => {
    it('el stock debe reducirse exactamente en la cantidad vendida', async () => {
      await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Efectivo',
          branch_id: branchId,
          items: [{ product_id: productId, quantity: 7, unit_price: 15 }],
        });

      const branchInv = await Inventory.findOne({ product_id: productId, branch_id: branchId });
      expect(branchInv.quantity).toBe(13); // 20 - 7 = 13
    });

    it('dos ventas consecutivas deben descontar stock acumulativamente', async () => {
      // Primera venta: -5
      await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Efectivo',
          branch_id: branchId,
          items: [{ product_id: productId, quantity: 5, unit_price: 15 }],
        });

      // Segunda venta: -3 más
      await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Efectivo',
          branch_id: branchId,
          items: [{ product_id: productId, quantity: 3, unit_price: 15 }],
        });

      const branchInv = await Inventory.findOne({ product_id: productId, branch_id: branchId });
      expect(branchInv.quantity).toBe(12); // 20 - 5 - 3 = 12
    });

    it('stock se queda intacto si la venta falla por stock insuficiente', async () => {
      await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Efectivo',
          branch_id: branchId,
          items: [{ product_id: productId, quantity: 999, unit_price: 15 }], // excede stock
        });

      const branchInv = await Inventory.findOne({ product_id: productId, branch_id: branchId });
      expect(branchInv.quantity).toBe(20); // sin cambio
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Aislamiento por usuario
  // ─────────────────────────────────────────────────────────────────────
  describe('GET /api/sales — aislamiento por usuario', () => {
    it('un usuario NO debe ver las ventas de otro usuario', async () => {
      // Crear segunda cuenta
      const hashedPwd = await bcryptjs.hash('pass123', 10);
      const otherUser = await User.create({
        email: `other_sales_${Date.now()}@example.com`,
        password: hashedPwd,
        name: 'Other Seller',
        role: 'admin',
      });
      const otherHeaders = getAuthHeadersForUser(otherUser._id, otherUser.role);

      // El usuario original crea una venta
      await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Efectivo',
          branch_id: branchId,
          items: [{ product_id: productId, quantity: 1, unit_price: 15 }],
        });

      // El otro usuario consulta → debe ver 0 ventas
      const response = await request(app)
        .get('/api/sales')
        .set(otherHeaders);

      expect(response.status).toBe(200);
      expect(response.body.sales).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/sales/:id — integridad de la respuesta
  // ─────────────────────────────────────────────────────────────────────
  describe('GET /api/sales/:id — estructura de la respuesta', () => {
    it('debe retornar sale con items, product_id populated y precio correcto', async () => {
      const createRes = await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Tarjeta',
          branch_id: branchId,
          items: [{ product_id: productId, quantity: 4, unit_price: 15 }],
        });
      const saleId = createRes.body.sale._id;

      const response = await request(app)
        .get(`/api/sales/${saleId}`)
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId });

      expect(response.status).toBe(200);
      expect(response.body.sale.total_amount).toBe('60'); // 4 * 15 = 60
      expect(response.body.sale.status).toBe('completed');
      expect(response.body.sale.payment_method).toBe('Tarjeta');

      // items con product_id populated (nombre y precio)
      const items = response.body.sale.items;
      expect(items).toHaveLength(1);
      expect(items[0].product_id.name).toBe('Agua Mineral 1L');
      expect(items[0].product_id.price.toString()).toBe('15');
      expect(items[0].quantity.toString()).toBe('4');
    });

    it('debe retornar 401 si no está autenticado', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const response = await request(app).get(`/api/sales/${fakeId}`);
      expect(response.status).toBe(401);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Venta con múltiples items
  // ─────────────────────────────────────────────────────────────────────
  describe('POST /api/sales — venta con múltiples productos', () => {
    it('debe crear venta con varios productos y descontar stock de cada uno', async () => {
      // Crear segundo producto con Inventory stock=10
      const product2 = new Product({
        name: 'Galletas María',
        price: 8,
        unit_type: 'unidad',
        category: categoryId,
        user: userId,
      });
      await product2.save();
      const product2Id = product2._id.toString();

      await Inventory.create({ owner_id: userId, product_id: product2Id, branch_id: branchId, quantity: 10 });

      const response = await request(app)
        .post('/api/sales')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId })
        .send({
          customer_id: userId,
          payment_method: 'Efectivo',
          branch_id: branchId,
          items: [
            { product_id: productId, quantity: 3, unit_price: 15 }, // Agua: 45
            { product_id: product2Id, quantity: 2, unit_price: 8 }, // Galletas: 16
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.sale.total_amount).toBe('61'); // 45 + 16

      const agua = await Inventory.findOne({ product_id: productId, branch_id: branchId });
      const galleta = await Inventory.findOne({ product_id: product2Id, branch_id: branchId });
      expect(agua.quantity).toBe(17);   // 20 - 3
      expect(galleta.quantity).toBe(8); // 10 - 2
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Saldo real de cuentas por cobrar (pendingAmount)
  // ─────────────────────────────────────────────────────────────────────
  describe('GET /api/sales — saldo de cuentas por cobrar (pendingAmount)', () => {
    it('debe restar los abonos de CustomerPayment al calcular pendingAmount', async () => {
      // 1. Crear venta a crédito pendiente por $100.00
      const sale = await Sale.create({
        customer_id: userId,
        business_owner_id: userId,
        branch_id: branchId,
        shift_id: shiftId,
        sold_by: userId,
        total_amount: '100.00',
        payment_method: 'Efectivo',
        status: 'pending',
        is_credit_sale: true,
      });

      // 2. Registrar abono de $40.00
      await CustomerPayment.create({
        sale_id: sale._id,
        customer_id: userId,
        business_owner_id: userId,
        shift_id: shiftId,
        received_by: userId,
        amount_received: '40.00',
        currency: 'USD',
        amount_applied_usd: '40.00',
        exchange_rate_type: 'NO_APLICA',
        payment_method: 'Efectivo',
        idempotency_key: `pay-test-${Date.now()}`,
        date: new Date(),
      });

      // 3. Consultar listado de ventas pendientes
      const response = await request(app)
        .get('/api/sales?status=pending')
        .set({ ...authHeaders, 'x-branch-id': branchId.toString(), 'x-shift-id': shiftId });

      expect(response.status).toBe(200);
      expect(response.body.pendingAmount).toBe('60.00');
      expect(response.body.sales).toHaveLength(1);
      expect(response.body.sales[0].total_amount).toBe('100.00');
      expect(response.body.sales[0].paid_amount).toBe('40.00');
      expect(response.body.sales[0].remaining_balance).toBe('60.00');
    });
  });
});

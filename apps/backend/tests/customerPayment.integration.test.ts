import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import app from '../server.js';
import { User } from '../models/User.js';
import { Branch } from '../models/Branch.js';
import { Customer } from '../models/Customer.js';
import { CashShift } from '../models/CashShift.model.js';
import { Sale } from '../models/Sale.js';
import { CustomerPayment } from '../models/CustomerPayment.js';

import { getAuthHeadersForUser } from './helpers/auth.js';

// Evita conexiones reales a Redis durante estas pruebas.
// El estado es compartido entre solicitudes para simular idempotencia.
const redisStore = new Map<string, string>();

vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(async (key: string, value: string, options?: any) => {
      if (options?.nx && redisStore.has(key)) {
        return null;
      }

      redisStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      return redisStore.delete(key) ? 1 : 0;
    }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
  bumpCacheVersion: vi.fn(async () => undefined),
  getCacheVersion: vi.fn(async () => 1),
}));

let mongoReplSet: MongoMemoryReplSet;

let businessOwner: any;
let cashier: any;
let branch: any;
let customer: any;
let authHeaders: Record<string, string>;

const clearCollections = async () => {
  await Promise.all([
    CustomerPayment.deleteMany({}),
    Sale.deleteMany({}),
    CashShift.deleteMany({}),
    Customer.deleteMany({}),
    Branch.deleteMany({}),
    User.deleteMany({}),
  ]);
};

beforeAll(async () => {
  mongoReplSet = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14' },
    replSet: { count: 1 },
    instanceOpts: [{ launchTimeout: 60000 }],
  });

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await mongoose.connect(mongoReplSet.getUri());
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await Promise.all([
    CustomerPayment.syncIndexes(),
    Sale.syncIndexes(),
    CashShift.syncIndexes(),
  ]);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();

  if (mongoReplSet) {
    await mongoReplSet.stop();
  }
});

afterEach(async () => {
  await clearCollections();
  redisStore.clear();
  vi.clearAllMocks();
});

const createContext = async () => {
  businessOwner = await User.create({
    name: 'Owner Integration',
    email: `owner-${crypto.randomUUID()}@example.com`,
    password: 'password123',
    role: 'admin',
  });

  cashier = await User.create({
    name: 'Cashier Integration',
    email: `cashier-${crypto.randomUUID()}@example.com`,
    password: 'password123',
    role: 'employee',
  });

  branch = await Branch.create({
    name: 'Sucursal Integración',
    address: 'Av. Central 100',
    owner_id: businessOwner._id,
    is_active: true,
  });

  customer = await Customer.create({
    name: 'Cliente Integración',
    email: `customer-${crypto.randomUUID()}@example.com`,
    document_id: `DOC-${crypto.randomUUID()}`,
    businessOwnerId: businessOwner._id,
    isActive: true,
  });

  // El token incluye el propietario y la sucursal autorizada.
  authHeaders = getAuthHeadersForUser(cashier._id, 'employee', {
    ownerId: businessOwner._id,
    assignedBranches: [branch._id.toString()],
  });

  return {
    businessOwnerId: businessOwner._id.toString(),
    actorId: cashier._id.toString(),
    branchId: branch._id.toString(),
    customerId: customer._id.toString(),
  };
};

const openShift = async (ctx: { branchId: string }) => {
  const response = await request(app)
    .post('/api/shifts/open')
    .set({
      ...authHeaders,
      'x-branch-id': ctx.branchId,
    })
    .send({ opening_balance: '100.00' });

  expect(response.status).toBe(201);

  return response.body.data._id as string;
};

const createPendingSale = async (
  ctx: {
    businessOwnerId: string;
    branchId: string;
    customerId: string;
    shiftId: string;
  },
  totalAmount = '100.00',
) => {
  const sale = await Sale.create({
    business_owner_id: ctx.businessOwnerId,
    branch_id: ctx.branchId,
    customer_id: ctx.customerId,
    shift_id: ctx.shiftId,
    total_amount: totalAmount,
    payment_method: 'Efectivo',
    status: 'pending',
    is_credit_sale: true,
  });

  return sale;
};

const paymentRequest = (
  branchId: string,
  saleId: string,
  idempotencyKey: string,
  amountReceived: string,
) => {
  return request(app)
    .post(`/api/sales/${saleId}/payments`)
    .set({
      ...authHeaders,
      'x-branch-id': branchId,
      'x-idempotency-key': idempotencyKey,
    })
    .send({
      amountReceived,
      currency: 'USD',
      paymentMethod: 'Divisas',
      exchangeRateType: 'NO_APLICA',
    });
};

describe('CustomerPayment — integración HTTP', () => {
  it('registra un abono parcial vinculado al turno activo', async () => {
    const ctx = await createContext();
    const shiftId = await openShift(ctx);

    const sale = await createPendingSale({
      ...ctx,
      shiftId,
    });

    const response = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      crypto.randomUUID(),
      '30.00',
    );

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.isDuplicate).toBe(false);
    expect(Number(response.body.remainingBalance)).toBe(70);

    const payment: any = await CustomerPayment.findOne({
      sale_id: sale._id,
    });

    expect(payment).not.toBeNull();
    expect(payment!.shift_id.toString()).toBe(shiftId);
    expect(payment!.received_by.toString()).toBe(ctx.actorId);
    expect(Number(payment!.amount_received.toString())).toBe(30);

    const updatedSale: any = await Sale.findById(sale._id);

    expect(updatedSale!.status).toBe('pending');
    expect(Number(updatedSale!.total_amount.toString())).toBe(100);
  });

  it('completa la venta cuando el abono cubre el saldo restante', async () => {
    const ctx = await createContext();
    const shiftId = await openShift(ctx);

    const sale = await createPendingSale(
      { ...ctx, shiftId },
      '75.00',
    );

    const response = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      crypto.randomUUID(),
      '75.00',
    );

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(Number(response.body.remainingBalance)).toBe(0);

    const updatedSale: any = await Sale.findById(sale._id);

    expect(updatedSale!.status).toBe('completed');
    expect(Number(updatedSale!.total_amount.toString())).toBe(75);

    expect(
      await CustomerPayment.countDocuments({ sale_id: sale._id }),
    ).toBe(1);
  });

  it('rechaza un pago nuevo si no hay turno abierto', async () => {
    const ctx = await createContext();

    // Se crea un turno original para poder guardar la venta.
    const originalShift = await CashShift.create({
      branch_id: ctx.branchId,
      cashier_id: ctx.actorId,
      user_id: ctx.actorId,
      status: 'OPEN',
      opening_balance: 100,
    });

    const sale = await createPendingSale({
      ...ctx,
      shiftId: originalShift._id.toString(),
    });

    // Se cierra el turno antes de intentar registrar el abono.
    originalShift.status = 'CLOSED';
    originalShift.closed_at = new Date();
    await originalShift.save();

    const response = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      crypto.randomUUID(),
      '20.00',
    );

    expect(response.status).toBe(403);

    expect(
      await CustomerPayment.countDocuments({ sale_id: sale._id }),
    ).toBe(0);

    const unchangedSale = await Sale.findById(sale._id);
    expect(unchangedSale!.status).toBe('pending');
  });

  it('no duplica el pago al repetir la misma solicitud idempotente', async () => {
    const ctx = await createContext();
    const shiftId = await openShift(ctx);

    const sale = await createPendingSale({
      ...ctx,
      shiftId,
    });

    const key = crypto.randomUUID();

    const firstResponse = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      key,
      '25.00',
    );

    expect(firstResponse.status).toBe(201);

    const secondResponse = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      key,
      '25.00',
    );

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers['x-idempotent-replay']).toBe('true');

    expect(
      await CustomerPayment.countDocuments({ sale_id: sale._id }),
    ).toBe(1);

    const unchangedSale: any = await Sale.findById(sale._id);
    expect(Number(unchangedSale!.total_amount.toString())).toBe(100);
  });

  it('suma los abonos y excluye el importe original de la venta a crédito al cerrar caja', async () => {
    const ctx = await createContext();
    const shiftId = await openShift(ctx);

    const sale = await createPendingSale({
      ...ctx,
      shiftId,
    });

    // Registrar un abono de 40 USD en el turno activo.
    const paymentResponse = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      crypto.randomUUID(),
      '40.00',
    );

    expect(paymentResponse.status).toBe(201);

    // Cerrar el turno con el saldo esperado.
    const closeResponse = await request(app)
      .post('/api/shifts/close')
      .set({
        ...authHeaders,
        'x-branch-id': ctx.branchId,
      })
      .send({ closing_balance: '140.00' });

    expect(closeResponse.status).toBe(200);
    expect(closeResponse.body.data.status).toBe('CLOSED');
    expect(closeResponse.body.data.total_sales_amount).toBe('40.00');
    expect(closeResponse.body.data.expected_balance).toBe('140.00');

    // El importe original de 100 USD no debe contabilizarse como ingreso.
    const updatedSale: any = await Sale.findById(sale._id);

    expect(updatedSale!.is_credit_sale).toBe(true);
    expect(Number(updatedSale!.total_amount.toString())).toBe(100);
  });

  it('contabiliza cada abono exclusivamente en el turno donde se recibe', async () => {
    const ctx = await createContext();

    // Turno 1: primer abono de 40 USD.
    const firstShiftId = await openShift(ctx);

    const sale = await createPendingSale(
      { ...ctx, shiftId: firstShiftId },
      '100.00',
    );

    const firstPaymentResponse = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      crypto.randomUUID(),
      '40.00',
    );

    expect(firstPaymentResponse.status).toBe(201);

    const firstPayment: any = await CustomerPayment.findOne({
      sale_id: sale._id,
    });

    expect(firstPayment).not.toBeNull();
    expect(firstPayment!.shift_id.toString()).toBe(firstShiftId);

    // Cerrar turno 1: saldo inicial 100 + abono 40.
    const firstCloseResponse = await request(app)
      .post('/api/shifts/close')
      .set({
        ...authHeaders,
        'x-branch-id': ctx.branchId,
      })
      .send({ closing_balance: '140.00' });

    expect(firstCloseResponse.status).toBe(200);
    expect(firstCloseResponse.body.data.total_sales_amount).toBe('40.00');
    expect(firstCloseResponse.body.data.expected_balance).toBe('140.00');

    // Turno 2: cobrar los 60 USD restantes.
    const secondShiftId = await openShift(ctx);

    const secondPaymentResponse = await paymentRequest(
      ctx.branchId,
      sale._id.toString(),
      crypto.randomUUID(),
      '60.00',
    );

    expect(secondPaymentResponse.status).toBe(201);
    expect(Number(secondPaymentResponse.body.remainingBalance)).toBe(0);

    const payments: any = await CustomerPayment.find({
      sale_id: sale._id,
    }).sort({ createdAt: 1 });

    expect(payments).toHaveLength(2);
    expect(payments[0].shift_id.toString()).toBe(firstShiftId);
    expect(payments[1].shift_id.toString()).toBe(secondShiftId);

    // Cerrar turno 2: solo debe contabilizar el abono de 60 USD.
    const secondCloseResponse = await request(app)
      .post('/api/shifts/close')
      .set({
        ...authHeaders,
        'x-branch-id': ctx.branchId,
      })
      .send({ closing_balance: '160.00' });

    expect(secondCloseResponse.status).toBe(200);
    expect(secondCloseResponse.body.data.total_sales_amount).toBe('60.00');
    expect(secondCloseResponse.body.data.expected_balance).toBe('160.00');

    // La venta se completa, pero su total original permanece intacto.
    const updatedSale: any = await Sale.findById(sale._id);

    expect(updatedSale!.status).toBe('completed');
    expect(updatedSale!.is_credit_sale).toBe(true);
    expect(Number(updatedSale!.total_amount.toString())).toBe(100);
  });

  it('coordina un abono concurrente con el cierre del turno sin perder ingresos', async () => {
    const ctx = await createContext();
    const shiftId = await openShift(ctx);

    const sale = await createPendingSale(
      { ...ctx, shiftId },
      '100.00',
    );

    const idempotencyKey = crypto.randomUUID();

    // Ambas solicitudes compiten por el mismo turno.
    const [paymentResponse, closeResponse] = await Promise.all([
      paymentRequest(
        ctx.branchId,
        sale._id.toString(),
        idempotencyKey,
        '40.00',
      ),
      request(app)
        .post('/api/shifts/close')
        .set({
          ...authHeaders,
          'x-branch-id': ctx.branchId,
        })
        .send({ closing_balance: '140.00' }),
    ]);

    // El cierre siempre debe terminar en un estado válido.
    expect([200, 404]).toContain(closeResponse.status);

    const paymentCount = await CustomerPayment.countDocuments({
      sale_id: sale._id,
    });

    const payment: any = await CustomerPayment.findOne({
      sale_id: sale._id,
    });

    const shift: any = await CashShift.findById(shiftId);

    expect(shift).not.toBeNull();

    if (paymentResponse.status === 201) {
      // Si el abono se aceptó, debe existir exactamente una vez.
      expect(paymentCount).toBe(1);
      expect(payment).not.toBeNull();
      expect(payment!.shift_id.toString()).toBe(shiftId);

      // El cierre debe contabilizarlo o, si el turno siguió abierto,
      // no debemos asumir que el arqueo ya se ejecutó.
      if (shift!.status === 'CLOSED') {
        expect(shift!.total_sales_amount.toString()).toBe('40.00');
        expect(shift!.expected_balance.toString()).toBe('140.00');
      }
    } else {
      // Si el cierre ganó la carrera, el abono nuevo debe rechazarse.
      expect(paymentResponse.status).toBe(403);
      expect(paymentCount).toBe(0);
    }
  });
});

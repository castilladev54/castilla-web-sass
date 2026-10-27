import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Big from 'big.js';

import { User } from '../models/User.js';
import { Branch } from '../models/Branch.js';
import { Customer } from '../models/Customer.js';
import { CashShift } from '../models/CashShift.model.js';
import { Sale } from '../models/Sale.js';
import { CustomerPayment } from '../models/CustomerPayment.js';
import { Product } from '../models/Product.js';
import { Inventory } from '../models/Inventory.js';
import { StockMovement, StockMovementType } from '../models/StockMovement.js';
import { Category } from '../models/Category.js';
import { ExchangeRate } from '../models/ExchangeRate.js';

import {
  registerCustomerPayment,
  SaleNotFoundError,
  InvalidSaleStatusError,
  SaleMissingCustomerError,
  OverpaymentError,
  InvalidPaymentError,
  CashShiftNotFoundError,
  roundToTwoDecimals,
} from '../services/customerPayment.service.js';

let mongoReplSet: MongoMemoryReplSet;

beforeAll(async () => {
  mongoReplSet = await MongoMemoryReplSet.create({
    binary: {
      version: '7.0.14',
    },
    replSet: { count: 1 },
    instanceOpts: [
      {
        launchTimeout: 60000,
      },
    ],
  });
  const mongoUri = mongoReplSet.getUri();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(mongoUri);
  await new Promise((r) => setTimeout(r, 1500));

  // Sincronizar índices requeridos
  await CustomerPayment.syncIndexes();
  await Sale.syncIndexes();
  await CashShift.syncIndexes();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoReplSet) {
    await mongoReplSet.stop();
  }
});

afterEach(async () => {
  await CustomerPayment.deleteMany({});
  await Sale.deleteMany({});
  await CashShift.deleteMany({});
  await Customer.deleteMany({});
  await Branch.deleteMany({});
  await User.deleteMany({});
  await Product.deleteMany({});
  await Inventory.deleteMany({});
  await StockMovement.deleteMany({});
  await Category.deleteMany({});
  vi.clearAllMocks();
await ExchangeRate.deleteMany({});
});

// ─── HELPERS PARA GENERACIÓN DE CONTEXTO DE PRUEBA ──────────────────────────

const createTestContext = async () => {
  const businessOwner = await User.create({
    name: 'Owner Test',
    email: `owner_${Date.now()}_${Math.random()}@example.com`,
    password: 'password123',
    role: 'admin',
  });

  const actor = await User.create({
    name: 'Cashier Test',
    email: `cashier_${Date.now()}_${Math.random()}@example.com`,
    password: 'password123',
    role: 'employee',
  });

  const branch = await Branch.create({
    name: 'Sucursal Central',
    address: 'Av. Libertador 100',
    owner_id: businessOwner._id,
    is_active: true,
  });

  const shift = await CashShift.create({
    branch_id: branch._id,
    cashier_id: actor._id,
    user_id: actor._id,
    status: 'OPEN',
    opening_balance: 100,
  });

  const customer = await Customer.create({
    name: 'Cliente Frecuente',
    email: 'cliente@example.com',
    document_id: `V-${Date.now()}`,
    businessOwnerId: businessOwner._id,
    isActive: true,
  });

  return {
    businessOwnerId: businessOwner._id.toString(),
    actorId: actor._id.toString(),
    branchId: branch._id.toString(),
    shiftId: shift._id.toString(),
    customerId: customer._id.toString(),
  };
};
const createCommercialRate = async (
  businessOwnerId: string,
  rate: string,
) => {
  const VE_OFFSET_MS = 4 * 60 * 60 * 1000;
  const nowVE = new Date(Date.now() - VE_OFFSET_MS);

  const date = new Date(
    Date.UTC(
      nowVE.getUTCFullYear(),
      nowVE.getUTCMonth(),
      nowVE.getUTCDate(),
      0,
      0,
      0,
      0,
    ) + VE_OFFSET_MS,
  );

  return ExchangeRate.create({
    customer_id: new mongoose.Types.ObjectId(businessOwnerId),
    rate,
    date,
    is_manual_override: true,
  });
};
const createSale = async (
  ctx: {
    businessOwnerId: string;
    branchId: string;
    shiftId: string;
    customerId?: string | null;
  },
  overrides: Record<string, any> = {}
) => {
  return Sale.create({
    business_owner_id: ctx.businessOwnerId,
    branch_id: ctx.branchId,
    shift_id: ctx.shiftId,
    customer_id: ctx.customerId ?? null,
    total_amount: '100.00',
    payment_method: 'Efectivo',
    status: 'pending',
    ...overrides,
  });
};

describe('CustomerPayment Service — Pruebas del Servicio', () => {
  // ─── 1. Abono parcial ─────────────────────────────────────────────────────
  it('Abono parcial: Se crea un CustomerPayment y la venta sigue pendiente', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    const result = await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '40.00',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `idem-${Date.now()}`,
    });

    expect(result.payment).toBeDefined();
    expect(result.payment.amount_received.toString()).toBe('40');
    expect(result.payment.amount_applied_usd.toString()).toBe('40');
    expect(result.payment.currency).toBe('USD');
    expect(result.payment.received_by.toString()).toBe(ctx.actorId);
    expect(result.payment.shift_id.toString()).toBe(ctx.shiftId);
    expect(result.remainingBalance).toBe('60.00');

    // Comprobar estado de la venta en base de datos
    const saleInDb = await Sale.findById(sale._id);
    expect(saleInDb).not.toBeNull();
    expect(saleInDb!.status).toBe('pending');
    // total_amount NUNCA debe modificarse
    expect(saleInDb!.total_amount.toString()).toBe('100');

    // Comprobar que en BD hay 1 solo abono
    const paymentsCount = await CustomerPayment.countDocuments({ sale_id: sale._id });
    expect(paymentsCount).toBe(1);
  });

  // ─── 2. Pago total ────────────────────────────────────────────────────────
  it('Pago total en una exhibición: La venta pasa a completed', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    const result = await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '100.00',
      currency: 'USD',
      paymentMethod: 'Transferencia',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `idem-full-${Date.now()}`,
    });

    expect(result.remainingBalance).toBe('0.00');

    // La venta debe pasar a completed
    const saleInDb = await Sale.findById(sale._id);
    expect(saleInDb!.status).toBe('completed');
    expect(saleInDb!.total_amount.toString()).toBe('100');
  });

  it('Pago total en abonos acumulados: La venta pasa a completed al liquidar el saldo', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    // Primer abono: $40.00
    const res1 = await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '40.00',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `idem-p1-${Date.now()}`,
    });
    expect(res1.remainingBalance).toBe('60.00');

    const saleMid = await Sale.findById(sale._id);
    expect(saleMid!.status).toBe('pending');

    // Segundo abono: $60.00 (liquida el total)
    const res2 = await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '60.00',
      currency: 'USD',
      paymentMethod: 'Tarjeta',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `idem-p2-${Date.now()}`,
    });
    expect(res2.remainingBalance).toBe('0.00');

    const saleFinal = await Sale.findById(sale._id);
    expect(saleFinal!.status).toBe('completed');
    expect(saleFinal!.total_amount.toString()).toBe('100');

    const totalPayments = await CustomerPayment.countDocuments({ sale_id: sale._id });
    expect(totalPayments).toBe(2);
  });

  // ─── 3. Sobrepago ─────────────────────────────────────────────────────────
  it('Sobrepago inicial: Se rechaza y no se registra ningún pago', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    await expect(
      registerCustomerPayment({
        saleId: sale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '100.01',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `idem-over-${Date.now()}`,
      })
    ).rejects.toThrow(OverpaymentError);

    // No se registra ningún pago
    const count = await CustomerPayment.countDocuments({ sale_id: sale._id });
    expect(count).toBe(0);

    // Venta sigue intacta
    const saleInDb = await Sale.findById(sale._id);
    expect(saleInDb!.status).toBe('pending');
    expect(saleInDb!.total_amount.toString()).toBe('100');
  });

  it('Sobrepago parcial: Se rechaza si el abono supera el saldo remanente', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    // Abono de $70.00 (saldo restante: $30.00)
    await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '70.00',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `idem-70-${Date.now()}`,
    });

    // Intento de abono de $30.01
    await expect(
      registerCustomerPayment({
        saleId: sale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '30.01',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `idem-over2-${Date.now()}`,
      })
    ).rejects.toThrow(OverpaymentError);

    // En BD solo permanece el primer pago
    const count = await CustomerPayment.countDocuments({ sale_id: sale._id });
    expect(count).toBe(1);

    const saleInDb = await Sale.findById(sale._id);
    expect(saleInDb!.status).toBe('pending');
  });

  // ─── 4. Venta ajena ───────────────────────────────────────────────────────
  it('Venta ajena: No se revela ni modifica una venta de otro negocio', async () => {
    const ctxA = await createTestContext();
    const ctxB = await createTestContext();

    const saleA = await createSale(ctxA, { total_amount: '100.00' });

    // Operador de Negocio B intenta registrar un abono sobre la venta de Negocio A
    await expect(
      registerCustomerPayment({
        saleId: saleA._id.toString(),
        businessOwnerId: ctxB.businessOwnerId, // Tenant diferente
        actorId: ctxB.actorId,
        shiftId: ctxB.shiftId,
        amountReceived: '50.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `idem-foreign-${Date.now()}`,
      })
    ).rejects.toThrow(SaleNotFoundError);

    // No se crea abono y la venta ajena no se altera
    const paymentsCount = await CustomerPayment.countDocuments();
    expect(paymentsCount).toBe(0);

    const saleAAfter = await Sale.findById(saleA._id);
    expect(saleAAfter!.status).toBe('pending');
  });

  // ─── 5. Sin cliente ───────────────────────────────────────────────────────
  it('Sin cliente: Se rechaza la operación', async () => {
    const ctx = await createTestContext();
    const saleWithoutCustomer = await createSale(ctx, {
      total_amount: '100.00',
      customer_id: null,
    });

    await expect(
      registerCustomerPayment({
        saleId: saleWithoutCustomer._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '50.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `idem-nocust-${Date.now()}`,
      })
    ).rejects.toThrow(SaleMissingCustomerError);

    const paymentsCount = await CustomerPayment.countDocuments();
    expect(paymentsCount).toBe(0);
  });

  // ─── 6. Venta anulada o completada ────────────────────────────────────────
  it('Venta completada: Se rechaza el abono', async () => {
    const ctx = await createTestContext();
    const completedSale = await createSale(ctx, {
      total_amount: '100.00',
      status: 'completed',
    });

    await expect(
      registerCustomerPayment({
        saleId: completedSale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '10.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `idem-comp-${Date.now()}`,
      })
    ).rejects.toThrow(InvalidSaleStatusError);

    const paymentsCount = await CustomerPayment.countDocuments();
    expect(paymentsCount).toBe(0);
  });

  it('Venta anulada: Se rechaza el abono', async () => {
    const ctx = await createTestContext();
    const cancelledSale = await createSale(ctx, {
      total_amount: '100.00',
      status: 'cancelled',
    });

    await expect(
      registerCustomerPayment({
        saleId: cancelledSale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '10.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `idem-canc-${Date.now()}`,
      })
    ).rejects.toThrow(InvalidSaleStatusError);

    const paymentsCount = await CustomerPayment.countDocuments();
    expect(paymentsCount).toBe(0);
  });

  // ─── 7. Pago en VES ───────────────────────────────────────────────────────
  it('Pago en VES: Se calcula correctamente el importe aplicado en USD con tasa COMERCIAL', async () => {
    const ctx = await createTestContext();
    await createCommercialRate(ctx.businessOwnerId, '50.00');
  const sale = await createSale(ctx, { total_amount: '100.00' });

    // 1000.00 VES / 50.00 (tasa) = 20.00 USD aplicados
    const result = await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '1000.00',
      currency: 'VES',
      exchangeRate: '50.00',
      exchangeRateType: 'COMERCIAL',
      paymentMethod: 'Pago Movil',
      idempotencyKey: `idem-ves-${Date.now()}`,
    });

    expect(result.payment.currency).toBe('VES');
    expect(result.payment.amount_received.toString()).toBe('1000');
    expect(result.payment.exchange_rate.toString()).toBe('50');
    expect(result.payment.exchange_rate_type).toBe('COMERCIAL');
    expect(result.payment.amount_applied_usd.toString()).toBe('20');
    expect(result.remainingBalance).toBe('80.00');

    const paymentInDb = await CustomerPayment.findById(result.payment._id);
    expect(paymentInDb!.amount_applied_usd.toString()).toBe('20');
  });

  it('Pago en VES con redondeo financiero: aplica regla ROUND_HALF_UP a dos decimales', async () => {
    const ctx = await createTestContext();
    await createCommercialRate(ctx.businessOwnerId, '51.25');
const sale = await createSale(ctx, { total_amount: '100.00' });

    // 100.00 VES / 51.25 = 1.95121951219512195122 -> redondeo half-up = 1.95 USD
    const result = await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '100.00',
      currency: 'VES',
      exchangeRate: '51.25',
      exchangeRateType: 'COMERCIAL',
      paymentMethod: 'Transferencia',
      idempotencyKey: `idem-ves-round-${Date.now()}`,
    });

    expect(result.payment.amount_applied_usd.toString()).toBe('1.95');
    // Saldo restante: 100 - 1.95 = 98.05
    expect(result.remainingBalance).toBe('98.05');
  });

  it('Pago en VES sin tasa o con NO_APLICA se rechaza', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    await expect(
      registerCustomerPayment({
        saleId: sale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '100.00',
        currency: 'VES',
        exchangeRate: undefined,
        exchangeRateType: 'NO_APLICA',
        paymentMethod: 'Pago Movil',
        idempotencyKey: `idem-invalid-ves-${Date.now()}`,
      })
    ).rejects.toThrow(InvalidPaymentError);
  });

  // ─── 8. Clave repetida ────────────────────────────────────────────────────
  it('Clave repetida: No se duplica el pago', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });
    const sharedKey = `shared-idempotency-key-${Date.now()}`;

    const paymentInput = {
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '30.00',
      currency: 'USD' as const,
      paymentMethod: 'Efectivo' as const,
      exchangeRateType: 'NO_APLICA' as const,
      idempotencyKey: sharedKey,
    };

    // Primera solicitud: registra el abono
    const res1 = await registerCustomerPayment(paymentInput);
    expect(res1.payment).toBeDefined();
    expect(res1.remainingBalance).toBe('70.00');

    // Segunda solicitud con la misma clave de idempotencia
    const res2 = await registerCustomerPayment(paymentInput);
    expect(res2.payment._id.toString()).toBe(res1.payment._id.toString());
    expect(res2.isDuplicate).toBe(true);
    expect(res2.remainingBalance).toBe('70.00');

    // La base de datos debe contener EXACTAMENTE 1 pago
    const count = await CustomerPayment.countDocuments({ idempotency_key: sharedKey });
    expect(count).toBe(1);

    const allPayments = await CustomerPayment.find({ sale_id: sale._id });
    expect(allPayments.length).toBe(1);
  });

  it('Clave repetida con datos incompatibles: Se rechaza con InvalidPaymentError', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });
    const sharedKey = `shared-incompatible-key-${Date.now()}`;

    // Primer abono con $30.00 en Efectivo
    await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '30.00',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: sharedKey,
    });

    // Reutilizar la misma clave con importe diferente ($40.00)
    await expect(
      registerCustomerPayment({
        saleId: sale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '40.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: sharedKey,
      })
    ).rejects.toThrow(InvalidPaymentError);

    // Reutilizar la misma clave con método de pago diferente
    await expect(
      registerCustomerPayment({
        saleId: sale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '30.00',
        currency: 'USD',
        paymentMethod: 'Tarjeta',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: sharedKey,
      })
    ).rejects.toThrow(InvalidPaymentError);
  });

  // ─── 9. Fallo transaccional ───────────────────────────────────────────────
  it('Fallo transaccional: No queda el pago guardado con el estado de la venta desactualizado', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    // Se fuerza un fallo inmediatamente tras la creación del pago antes del commit
    await expect(
      registerCustomerPayment({
        saleId: sale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: ctx.shiftId,
        amountReceived: '50.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `idem-fail-${Date.now()}`,
        _testSimulateFailureAfterPayment: true,
      })
    ).rejects.toThrow('Simulated transaction failure after payment creation');

    // VERIFICACIÓN DE ROLLBACK:
    // No debe existir ningún registro de pago en la base de datos
    const paymentsCount = await CustomerPayment.countDocuments({ sale_id: sale._id });
    expect(paymentsCount).toBe(0);

    // La venta debe continuar en pending y total_amount intacto
    const saleInDb = await Sale.findById(sale._id);
    expect(saleInDb!.status).toBe('pending');
    expect(saleInDb!.total_amount.toString()).toBe('100');
  });

  // ─── 10. Dos pagos concurrentes ───────────────────────────────────────────
  it('Dos pagos concurrentes: El saldo nunca queda negativo ni se acepta un sobrepago', async () => {
    const ctx = await createTestContext();
    // Venta con deuda total de $50.00
    const sale = await createSale(ctx, { total_amount: '50.00' });

    // Dos operadores intentan cobrar simultáneamente $30.00 cada uno ($60.00 total > $50.00 de deuda)
    const p1 = registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '30.00',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `concurrent-A-${Date.now()}`,
    });

    const p2 = registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '30.00',
      currency: 'USD',
      paymentMethod: 'Transferencia',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `concurrent-B-${Date.now()}`,
    });

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactamente 1 debe ganar y 1 debe ser rechazado por sobrepago
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason).toBeInstanceOf(OverpaymentError);

    // El saldo en BD nunca queda negativo: exactamente 1 pago de $30.00
    const payments = await CustomerPayment.find({ sale_id: sale._id });
    expect(payments.length).toBe(1);
    expect(payments[0].amount_applied_usd.toString()).toBe('30');

    // La venta permanece en 'pending' con saldo remanente de $20.00
    const saleInDb = await Sale.findById(sale._id);
    expect(saleInDb!.status).toBe('pending');
  });

  it('Dos pagos concurrentes complementarios: se serializan y la venta pasa a completed', async () => {
    const ctx = await createTestContext();
    // Venta de $50.00
    const sale = await createSale(ctx, { total_amount: '50.00' });

    // Dos pagos que juntos liquidan exactamente la deuda ($30.00 + $20.00 = $50.00)
    const p1 = registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '30.00',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `comp-A-${Date.now()}`,
    });

    const p2 = registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '20.00',
      currency: 'USD',
      paymentMethod: 'Zelle',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `comp-B-${Date.now()}`,
    });

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(2);

    // Ambos pagos guardados
    const payments = await CustomerPayment.find({ sale_id: sale._id });
    expect(payments.length).toBe(2);

    // Venta pasa a completed
    const saleInDb = await Sale.findById(sale._id);
    expect(saleInDb!.status).toBe('completed');
  });

  // ─── 11. Inventario ───────────────────────────────────────────────────────
  it('Inventario: El stock y los movimientos de inventario permanecen intactos', async () => {
    const ctx = await createTestContext();

    const category = await Category.create({
      name: 'Cat Test',
      user: ctx.businessOwnerId,
    });

    const product = await Product.create({
      name: 'Producto Intacto',
      price: '50.00',
      barcode: `BC-${Date.now()}`,
      unit_type: 'unidad',
      category: category._id,
      user: ctx.businessOwnerId,
    });

    const inventory = await Inventory.create({
      product_id: product._id,
      branch_id: ctx.branchId,
      owner_id: ctx.businessOwnerId,
      quantity: '45',
      min_stock_alert: '5',
    });

    const initialMovement = await StockMovement.create({
      inventory_id: inventory._id,
      product_id: product._id,
      branch_id: ctx.branchId,
      owner_id: ctx.businessOwnerId,
      type: StockMovementType.INITIAL_INVENTORY,
      quantity_change: '45',
      previous_quantity: '0',
      new_quantity: '45',
      created_by: ctx.actorId,
      reason: 'Conteo inicial',
    });

    const sale = await createSale(ctx, { total_amount: '100.00' });

    // Capturar métricas previas al abono
    const stockBefore = await Inventory.findById(inventory._id);
    const movementsCountBefore = await StockMovement.countDocuments();

    // Registrar abono
    await registerCustomerPayment({
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '50.00',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: `idem-inv-${Date.now()}`,
    });

    // Capturar métricas posteriores
    const stockAfter = await Inventory.findById(inventory._id);
    const movementsCountAfter = await StockMovement.countDocuments();

    // Comprobar que el inventario no se modificó
    expect(stockAfter!.quantity.toString()).toBe(stockBefore!.quantity.toString());
    expect(movementsCountAfter).toBe(movementsCountBefore);
  });

  it('Reintento sin turno: devuelve el abono original y conserva su turno', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });
    const idempotencyKey = `retry-closed-shift-${Date.now()}`;

    const paymentInput = {
      saleId: sale._id.toString(),
      businessOwnerId: ctx.businessOwnerId,
      actorId: ctx.actorId,
      shiftId: ctx.shiftId,
      amountReceived: '30.00',
      currency: 'USD' as const,
      paymentMethod: 'Efectivo' as const,
      exchangeRateType: 'NO_APLICA' as const,
      idempotencyKey,
    };

    const original = await registerCustomerPayment(paymentInput);

    await CashShift.updateOne(
      { _id: ctx.shiftId },
      { $set: { status: 'CLOSED' } },
    );

    const retry = await registerCustomerPayment({
      ...paymentInput,
      shiftId: undefined,
    });

    expect(retry.isDuplicate).toBe(true);
    expect(retry.payment._id.toString()).toBe(original.payment._id.toString());
    expect(retry.payment.shift_id.toString()).toBe(ctx.shiftId);

    expect(
      await CustomerPayment.countDocuments({
        business_owner_id: ctx.businessOwnerId,
        idempotency_key: idempotencyKey,
      }),
    ).toBe(1);
  });

  it('Abono nuevo sin turno: se rechaza y no crea ningún pago', async () => {
    const ctx = await createTestContext();
    const sale = await createSale(ctx, { total_amount: '100.00' });

    await expect(
      registerCustomerPayment({
        saleId: sale._id.toString(),
        businessOwnerId: ctx.businessOwnerId,
        actorId: ctx.actorId,
        shiftId: undefined,
        amountReceived: '30.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
        idempotencyKey: `new-payment-no-shift-${Date.now()}`,
      }),
    ).rejects.toThrow();

    expect(
      await CustomerPayment.countDocuments({ sale_id: sale._id }),
    ).toBe(0);
  });
});


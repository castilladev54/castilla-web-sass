import mongoose from 'mongoose';
import { afterAll, describe, expect, it } from 'vitest';
import { CustomerPayment } from '../models/CustomerPayment.js';

const objectId = () => new mongoose.Types.ObjectId();

const validPayment = (overrides: Record<string, unknown> = {}) => ({
  sale_id: objectId(),
  customer_id: objectId(),
  business_owner_id: objectId(),
  shift_id: objectId(),
  received_by: objectId(),

  amount_received: '10.00',
  currency: 'VES',
  amount_applied_usd: '0.20',
  exchange_rate: '50',
  exchange_rate_type: 'COMERCIAL',

  payment_method: 'Efectivo',
  idempotency_key: `test-${objectId().toString()}`,
  date: new Date(),

  ...overrides,
});

async function expectFieldError(
  data: Record<string, unknown>,
  field: string
) {
  const error = await new CustomerPayment(data)
    .validate()
    .then(() => null)
    .catch((validationError: unknown) => validationError);

  expect(error).toBeInstanceOf(mongoose.Error.ValidationError);

  const validationError = error as mongoose.Error.ValidationError;
  expect(validationError.errors[field]).toBeDefined();
}

describe('CustomerPayment — validación del modelo', () => {
  afterAll(async () => {
    // Estas pruebas validan documentos en memoria.
    // No abren ni necesitan una conexión a MongoDB.
  });

  it('acepta un abono en VES con tasa comercial', async () => {
    const payment = new CustomerPayment(validPayment());

    await expect(payment.validate()).resolves.toBeUndefined();
  });

  it('acepta un abono en VES con tasa BCV', async () => {
    const payment = new CustomerPayment(
      validPayment({ exchange_rate_type: 'BCV' })
    );

    await expect(payment.validate()).resolves.toBeUndefined();
  });

  it('acepta un abono en USD sin tasa de cambio', async () => {
    const payment = new CustomerPayment(
      validPayment({
        amount_received: '5.00',
        currency: 'USD',
        amount_applied_usd: '5.00',
        exchange_rate: undefined,
        exchange_rate_type: 'NO_APLICA',
        payment_method: 'Divisas',
      })
    );

    await expect(payment.validate()).resolves.toBeUndefined();
  });

  it('rechaza un abono sin venta asociada', async () => {
    await expectFieldError(
      validPayment({ sale_id: undefined }),
      'sale_id'
    );
  });

  it('rechaza un abono sin cliente asociado', async () => {
    await expectFieldError(
      validPayment({ customer_id: undefined }),
      'customer_id'
    );
  });

  it('rechaza un abono sin turno de caja', async () => {
    await expectFieldError(
      validPayment({ shift_id: undefined }),
      'shift_id'
    );
  });

  it('rechaza un abono sin usuario receptor', async () => {
    await expectFieldError(
      validPayment({ received_by: undefined }),
      'received_by'
    );
  });

  it('rechaza un importe recibido igual a cero', async () => {
    await expectFieldError(
      validPayment({ amount_received: '0' }),
      'amount_received'
    );
  });

  it('rechaza un importe recibido negativo', async () => {
    await expectFieldError(
      validPayment({ amount_received: '-1' }),
      'amount_received'
    );
  });

  it('rechaza un importe aplicado a la deuda igual a cero', async () => {
    await expectFieldError(
      validPayment({ amount_applied_usd: '0' }),
      'amount_applied_usd'
    );
  });

  it('rechaza un abono en VES sin tasa de cambio', async () => {
    await expectFieldError(
      validPayment({ exchange_rate: undefined }),
      'exchange_rate'
    );
  });

  it('rechaza una tasa de cambio igual a cero', async () => {
    await expectFieldError(
      validPayment({ exchange_rate: '0' }),
      'exchange_rate'
    );
  });

  it('rechaza NO_APLICA como tipo de tasa para VES', async () => {
    await expectFieldError(
      validPayment({ exchange_rate_type: 'NO_APLICA' }),
      'exchange_rate_type'
    );
  });

  it('rechaza una tasa comercial para un pago en USD', async () => {
    await expectFieldError(
      validPayment({
        currency: 'USD',
        amount_received: '5',
        amount_applied_usd: '5',
        exchange_rate: undefined,
        exchange_rate_type: 'COMERCIAL',
        payment_method: 'Divisas',
      }),
      'exchange_rate_type'
    );
  });

  it('rechaza una moneda no permitida', async () => {
    await expectFieldError(
      validPayment({ currency: 'EUR' }),
      'currency'
    );
  });

  it('rechaza un método de pago no permitido', async () => {
    await expectFieldError(
      validPayment({ payment_method: 'Bitcoin' }),
      'payment_method'
    );
  });

  it('rechaza un abono sin clave de idempotencia', async () => {
    await expectFieldError(
      validPayment({ idempotency_key: undefined }),
      'idempotency_key'
    );
  });

  it('declara un índice único para la clave de idempotencia por negocio', () => {
    const indexes = CustomerPayment.schema.indexes();

    expect(
      indexes.some(([keys, options]) =>
        keys.business_owner_id === 1 &&
        keys.idempotency_key === 1 &&
        options.unique === true
      )
    ).toBe(true);
  });
});

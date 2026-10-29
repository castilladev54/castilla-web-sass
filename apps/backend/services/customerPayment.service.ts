import mongoose from 'mongoose';
import Big from 'big.js';
import { Sale } from '../models/Sale.js';
import { CustomerPayment } from '../models/CustomerPayment.js';
import { CashShift } from '../models/CashShift.model.js';
import { withTransactionRetry } from '../utils/transaction-retry.js';
import {
  AppError,
  SaleNotFoundError,
  InvalidSaleStatusError,
  SaleMissingCustomerError,
  OverpaymentError,
  InvalidPaymentError,
  CashShiftNotFoundError,
} from '../lib/error.js';
import { ExchangeRate } from '../models/ExchangeRate.js';

const VE_OFFSET_MS = 4 * 60 * 60 * 1000;

function getStartOfDayVE(dateInput: Date = new Date()): Date {
  const nowVE = new Date(dateInput.getTime() - VE_OFFSET_MS);

  return new Date(
    Date.UTC(
      nowVE.getUTCFullYear(),
      nowVE.getUTCMonth(),
      nowVE.getUTCDate(),
      0, 0, 0, 0,
    ) + VE_OFFSET_MS,
  );
}

export {
  SaleNotFoundError,
  InvalidSaleStatusError,
  SaleMissingCustomerError,
  OverpaymentError,
  InvalidPaymentError,
  CashShiftNotFoundError,
  toBigDecimal,
};


// ─── CONTRATOS Y TIPOS ───────────────────────────────────────────────────────

export const VALID_PAYMENT_METHODS = [
  'Efectivo',
  'Divisas',
  'Tarjeta',
  'Pago Movil',
  'Transferencia',
  'Zelle',
  'BIOPAGO',
] as const;

export type CustomerPaymentMethod =
  | 'Efectivo'
  | 'Divisas'
  | 'Tarjeta'
  | 'Pago Movil'
  | 'Transferencia'
  | 'Zelle'
  | 'BIOPAGO';

export interface RegisterCustomerPaymentInput {
  saleId: string;
  businessOwnerId: string;
  actorId: string;
  shiftId?: string;
  amountReceived: string;
  currency: 'USD' | 'VES';
  paymentMethod: CustomerPaymentMethod;
  exchangeRate?: string;
  exchangeRateType: 'BCV' | 'COMERCIAL' | 'NO_APLICA';
  idempotencyKey: string;
  _testSimulateFailureAfterPayment?: boolean;
}

export interface RegisterCustomerPaymentResult {
  payment: InstanceType<typeof CustomerPayment>;
  sale: any;
  remainingBalance: string;
  isDuplicate?: boolean;
}

// ─── REGLAS FINANCIERAS ─────────────────────────────────────────────────────

function toBigDecimal(value: unknown, fieldName: string): Big {
  if (value == null) {
    throw new Error(`El campo decimal "${fieldName}" no tiene valor.`);
  }

  const decimalString =
    typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint'
      ? String(value)
      : value instanceof mongoose.Types.Decimal128
        ? value.toString()
        : null;

  if (decimalString === null) {
    throw new Error(`El campo "${fieldName}" no contiene un decimal válido.`);
  }

  try {
    return new Big(decimalString);
  } catch {
    throw new Error(`El campo "${fieldName}" contiene un decimal inválido.`);
  }
}

/**
 * Regla explícita y consistente de redondeo para importes en USD.
 * Utiliza Big.js con modo ROUND_HALF_UP (1) a dos decimales.
 */
export const roundToTwoDecimals = (value: Big.Big): string => {
  return value.round(2, Big.roundHalfUp).toFixed(2);
};

// ─── VALIDACIONES PURAS (PREVIAS A TRANSACCIÓN) ──────────────────────────────

const validatePaymentInput = (input: RegisterCustomerPaymentInput) => {
  const {
    saleId,
    businessOwnerId,
    actorId,
    shiftId,
    amountReceived,
    currency,
    paymentMethod,
    exchangeRate,
    exchangeRateType,
    idempotencyKey,
  } = input;

  if (!saleId || !mongoose.Types.ObjectId.isValid(saleId)) {
    throw new InvalidPaymentError('El ID de la venta es inválido.');
  }

  if (!businessOwnerId || !mongoose.Types.ObjectId.isValid(businessOwnerId)) {
    throw new InvalidPaymentError('El ID del negocio es inválido.');
  }

  if (!actorId || !mongoose.Types.ObjectId.isValid(actorId)) {
    throw new InvalidPaymentError('El ID del operador es inválido.');
  }

  if (shiftId && !mongoose.Types.ObjectId.isValid(shiftId)) {
    throw new InvalidPaymentError('El ID del turno de caja es inválido.');
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new InvalidPaymentError('La clave de idempotencia es requerida.');
  }

  if (!['USD', 'VES'].includes(currency)) {
    throw new InvalidPaymentError('La moneda debe ser USD o VES.');
  }

  if (!VALID_PAYMENT_METHODS.includes(paymentMethod as any)) {
    throw new InvalidPaymentError(`Método de pago no permitido: ${paymentMethod}`);
  }

  let amountReceivedBig: Big.Big;
  try {
    amountReceivedBig = Big(amountReceived);
  } catch {
    throw new InvalidPaymentError('El importe recibido debe ser un número válido.');
  }

  if (amountReceivedBig.lte(0)) {
    throw new InvalidPaymentError('El importe recibido debe ser mayor que cero.');
  }

  let amountAppliedUSDStr: string;

  if (currency === 'VES') {
    if (exchangeRateType !== 'COMERCIAL') {
      throw new InvalidPaymentError(
        'Los pagos en VES requieren la tasa comercial manual vigente del día.'
      );
    }

    if (!exchangeRate) {
      throw new InvalidPaymentError('Los pagos en VES requieren una tasa de cambio.');
    }

    let rateBig: Big.Big;
    try {
      rateBig = Big(exchangeRate);
    } catch {
      throw new InvalidPaymentError('La tasa de cambio debe ser un número válido.');
    }

    if (rateBig.lte(0)) {
      throw new InvalidPaymentError('La tasa de cambio debe ser mayor que cero.');
    }

    amountAppliedUSDStr = roundToTwoDecimals(amountReceivedBig.div(rateBig));
  } else {
    // USD
    if (exchangeRateType !== 'NO_APLICA') {
      throw new InvalidPaymentError(
        'Los pagos en USD deben indicar exchangeRateType como NO_APLICA.'
      );
    }

    if (exchangeRate != null && exchangeRate !== '') {
      throw new InvalidPaymentError('Los pagos en USD no deben llevar tasa de cambio.');
    }

    amountAppliedUSDStr = roundToTwoDecimals(amountReceivedBig);
  }

  if (Big(amountAppliedUSDStr).lte(0)) {
    throw new InvalidPaymentError(
      'El importe aplicado a la deuda en USD tras redondeo debe ser mayor a cero.'
    );
  }

  return {
    amountReceivedStr: amountReceivedBig.toFixed(2),
    amountAppliedUSDStr,
    exchangeRateStr: exchangeRate ? Big(exchangeRate).toString() : undefined,
  };
};

// ─── SERVICIO TRANSACCIONAL ─────────────────────────────────────────────────

/**
 * Registra un abono a una venta pendiente garantizando consistencia transaccional y financiera.
 *
 * Estrategia de Concurrencia y Serialización:
 * 1. Ejecuta dentro de withTransactionRetry.
 * 2. Verifica que el turno de caja (shiftId) existe y se encuentra 'OPEN'.
 * 3. Comprueba idempotencia: si la clave ya existe para este negocio, retorna el abono sin duplicar.
 * 4. Lee la venta filtrando estrictamente por tenant (_id y business_owner_id).
 * 5. Valida que la venta esté 'pending' y tenga un customer_id asociado.
 * 6. Provoca una escritura transaccional sobre la venta ($inc: { __v: 1 }) para adquirir el
 *    bloqueo exclusivo de MongoDB sobre ese documento, serializando solicitudes concurrentes.
 * 7. Lee todos los abonos existentes dentro de la transacción y suma amount_applied_usd con Big.js.
 * 8. Calcula el saldo pendiente real: Sale.total_amount - sum(CustomerPayment.amount_applied_usd).
 * 9. Valida que el abono actual no exceda el saldo pendiente (rechazo de sobrepago).
 * 10. Registra el CustomerPayment con amount_applied_usd redondeado a 2 decimales (ROUND_HALF_UP).
 * 11. Si el nuevo saldo llega exactamente a cero, actualiza Sale.status a 'completed'.
 *     Sale.total_amount NUNCA se modifica.
 */
export const registerCustomerPayment = async (
  input: RegisterCustomerPaymentInput
): Promise<RegisterCustomerPaymentResult> => {
  let {
    amountReceivedStr,
    amountAppliedUSDStr,
    exchangeRateStr,
  } = validatePaymentInput(input);

  let appliedAmountUSDStr = amountAppliedUSDStr;
  let rateForPersistence = exchangeRateStr;

  const {
    saleId,
    businessOwnerId,
    actorId,
    shiftId,
    currency,
    paymentMethod,
    exchangeRateType,
    idempotencyKey,
    _testSimulateFailureAfterPayment,
  } = input;

  return withTransactionRetry(async (session) => {
    // 1. Validar que el turno de caja esté abierto
    // shift validation moved below idempotency check

    // 2. Control de Idempotencia a nivel de base de datos
    const existingPayment = await CustomerPayment.findOne({
      business_owner_id: businessOwnerId,
      idempotency_key: idempotencyKey,
    }).session(session);

    if (existingPayment) {
      if (existingPayment.sale_id.toString() !== saleId.toString()) {
        throw new InvalidPaymentError(
          'La clave de idempotencia ya fue utilizada para otra venta.'
        );
      }

      const existingAmount = toBigDecimal(
        existingPayment.amount_received,
        'existingPayment.amount_received'
      );
      const isSameAmount = existingAmount.eq(Big(amountReceivedStr));
      const isSameCurrency = existingPayment.currency === currency;
      const isSameMethod = existingPayment.payment_method === paymentMethod;
      const isSameExchangeRateType =
        existingPayment.exchange_rate_type === exchangeRateType;
      const isSameExchangeRate =
        currency === 'VES'
          ? existingPayment.exchange_rate != null &&
          toBigDecimal(
            existingPayment.exchange_rate,
            'existingPayment.exchange_rate'
          ).eq(Big(exchangeRateStr!))
          : true;

      if (
        !isSameAmount ||
        !isSameCurrency ||
        !isSameMethod ||
        !isSameExchangeRateType ||
        !isSameExchangeRate
      ) {
        throw new InvalidPaymentError(
          'La clave de idempotencia ya fue utilizada con datos de pago incompatibles.'
        );
      }

      const currentSale = await Sale.findOne({
        _id: saleId,
        business_owner_id: businessOwnerId,
      }).session(session);

      if (!currentSale) {
        throw new SaleNotFoundError();
      }

      const allPayments = await CustomerPayment.find({
        sale_id: saleId,
        business_owner_id: businessOwnerId,
      }).session(session);

      const totalPaid = allPayments.reduce(
        (acc, p) =>
          acc.plus(toBigDecimal(p.amount_applied_usd, 'amount_applied_usd')),
        Big('0')
      );
      const saleTotal = toBigDecimal(
        currentSale.total_amount,
        'sale.total_amount'
      );
      const remaining = saleTotal.minus(totalPaid);

      return {
        payment: existingPayment,
        sale: currentSale,
        remainingBalance: remaining.lte(0) ? '0.00' : remaining.toFixed(2),
        isDuplicate: true,
      };
    }
    // 2. Solo para abonos nuevos, exigir turno abierto
    if (!shiftId) {
      throw new CashShiftNotFoundError();
    }

    const shift = await CashShift.findOneAndUpdate(
      {
        _id: shiftId,
        status: 'OPEN',
      },
      {
        $inc: { __v: 1 },
      },
      {
        session,
        returnDocument: 'after',
      },
    );

    if (!shift) {
      throw new CashShiftNotFoundError();
    }

    if (currency === 'VES') {
      const todayStart = getStartOfDayVE();

      const currentRateDoc = await ExchangeRate.findOne({
        customer_id: businessOwnerId,
        date: todayStart,
        is_manual_override: true,
      }).session(session);

      if (!currentRateDoc) {
        throw new AppError(
          409,
          'No existe una tasa comercial manual registrada para hoy. No se puede registrar el abono en bolívares.',
        );
      }

      const currentRate = toBigDecimal(
        currentRateDoc.rate,
        'currentRateDoc.rate',
      );

      const incomingRate = toBigDecimal(
        exchangeRateStr,
        'exchangeRate',
      );

      if (incomingRate.minus(currentRate).abs().gt(Big('0.001'))) {
        throw new AppError(
          409,
          'La tasa comercial cambió. Actualiza la tasa en caja antes de registrar el abono.',
        );
      }

      // La tasa de MongoDB es la fuente de verdad.
      rateForPersistence = currentRate.toString();

      appliedAmountUSDStr = roundToTwoDecimals(
        Big(amountReceivedStr).div(currentRate),
      );

      if (Big(appliedAmountUSDStr).lte(0)) {
        throw new InvalidPaymentError(
          'El importe aplicado a la deuda en USD tras redondeo debe ser mayor a cero.',
        );
      }
    }
    // 3. Buscar la venta dentro del negocio correspondiente
    const sale = await Sale.findOne({
      _id: saleId,
      business_owner_id: businessOwnerId,
    }).session(session);

    if (!sale) {
      throw new SaleNotFoundError();
    }

    // 4. Confirmar que la venta tenga un cliente
    if (!sale.customer_id) {
      throw new SaleMissingCustomerError();
    }

    // 5. Confirmar que la venta esté pendiente
    if (sale.status !== 'pending') {
      throw new InvalidSaleStatusError(sale.status);
    }

    // 6. SERIALIZACIÓN CONCURRENTE:
    // Provocar una escritura transaccional sobre la venta para adquirir el bloqueo exclusivo (WiredTiger lock).
    // Si otra transacción concurrente intenta abonar a esta venta al mismo tiempo,
    // recibirá WriteConflict y withTransactionRetry la reintentará sobre el nuevo saldo.
    await Sale.updateOne(
      { _id: sale._id },
      { $inc: { __v: 1 } },
      { session }
    );

    // 7. Calcular el saldo real restando los abonos previamente registrados
    const existingPayments = await CustomerPayment.find({
      sale_id: sale._id,
      business_owner_id: businessOwnerId,
    }).session(session);

    const totalPaid = existingPayments.reduce(
      (acc, p) =>
        acc.plus(toBigDecimal(p.amount_applied_usd, 'amount_applied_usd')),
      Big('0')
    );

    const saleTotal = toBigDecimal(
      sale.total_amount,
      'sale.total_amount'
    );
    const pendingBalance = saleTotal.minus(totalPaid);

    if (pendingBalance.lte(0)) {
      // Venta ya saldada
      await Sale.updateOne(
        { _id: sale._id },
        { $set: { status: 'completed' } },
        { session }
      );
      throw new InvalidSaleStatusError('completed');
    }

    // 8. Validar sobrepago antes de registrar
    const appliedUSD = Big(appliedAmountUSDStr);

    if (appliedUSD.gt(pendingBalance)) {
      throw new OverpaymentError(
        appliedUSD.toFixed(2),
        pendingBalance.toFixed(2)
      );
    }

    // 9. Registrar el abono con la identidad del operador y el turno de caja
    const [payment] = await CustomerPayment.create(
      [
        {
          sale_id: sale._id,
          customer_id: sale.customer_id,
          business_owner_id: businessOwnerId,
          shift_id: shiftId,
          received_by: actorId,
          amount_received: amountReceivedStr,
          currency,
          amount_applied_usd: appliedAmountUSDStr,
          exchange_rate: currency === 'VES' ? rateForPersistence : undefined,
          exchange_rate_type: exchangeRateType,
          payment_method: paymentMethod,
          idempotency_key: idempotencyKey,
          date: new Date(),
        },
      ],
      { session }
    );

    if (!payment) {
      throw new Error('No se pudo crear el registro del abono.');
    }

    // Gancho de prueba para verificar atomicidad ante fallo
    if (_testSimulateFailureAfterPayment) {
      throw new Error('Simulated transaction failure after payment creation');
    }

    // 10. Actualizar la venta a 'completed' solo cuando el saldo llegue exactamente a cero
    const remaining = pendingBalance.minus(appliedUSD);
    const isCompleted = remaining.eq(0);

    if (isCompleted) {
      await Sale.updateOne(
        { _id: sale._id },
        { $set: { status: 'completed' } },
        { session }
      );
      sale.status = 'completed';
    }

    return {
      payment,
      sale,
      remainingBalance: remaining.toFixed(2),
    };
  });
};

export class CustomerPaymentService {
  public async registerPayment(input: RegisterCustomerPaymentInput) {
    return registerCustomerPayment(input);
  }
}

export const customerPaymentService = new CustomerPaymentService();


import { Request, Response } from 'express';
import { customerPaymentService } from '../services/customerPayment.service.js';
import { bumpCacheVersion } from '../lib/redis.js';

export const registerCustomerPayment = async (
  req: Request,
  _res: Response,
): Promise<any> => {
  const saleId = req.params.id;
  if (typeof saleId !== 'string' || !saleId.trim()) {
    const error: any = new Error('El ID de la venta no es válido.');
    error.status = 400;
    throw error;
  }

  const {
    amountReceived,
    currency,
    paymentMethod,
    exchangeRate,
    exchangeRateType,
  } = req.body;

  const businessOwnerId = String(req.businessOwnerId);
  const actorId = String(req.actorId);
  const shiftId = req.cashShift?._id?.toString();
  const idempotencyKey = req.headers['x-idempotency-key'];

  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    const error: any = new Error(
      'Falta la cabecera x-idempotency-key.',
    );
    error.status = 400;
    throw error;
  }

  const result = await customerPaymentService.registerPayment({
    saleId,
    businessOwnerId,
    actorId,
    shiftId,
    amountReceived,
    currency,
    paymentMethod,
    exchangeRate,
    exchangeRateType:
      currency === 'USD' ? 'NO_APLICA' : exchangeRateType,
    idempotencyKey,
  });

  if (!result.isDuplicate) {
    await bumpCacheVersion('sales', businessOwnerId);
  }

  return {
    success: true,
    message: result.isDuplicate
      ? 'Este abono ya había sido registrado.'
      : 'Abono registrado exitosamente.',
    payment: result.payment,
    sale: result.sale,
    remainingBalance: result.remainingBalance,
    isDuplicate: Boolean(result.isDuplicate),
  };
};

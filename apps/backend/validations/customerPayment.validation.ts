import { z } from 'zod';
import Big from 'big.js';
import { idParamSchema } from '@inventory/shared/validations';

/**
 * Validador estricto para importes monetarios recibidos.
 * - Formato decimal positivo con hasta 2 decimales.
 * - Valida mayor a 0 utilizando Big.js para evitar distorsiones de Number binario.
 */
const monetaryAmountSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine(
    (value) => /^\d+(\.\d{1,2})?$/.test(value),
    'El importe debe ser un número decimal válido con hasta 2 decimales.',
  )
  .refine((value) => {
    try {
      return Big(value).gt(0);
    } catch {
      return false;
    }
  }, 'El importe debe ser mayor que cero.');

/**
 * Validador para tasa de cambio.
 * - Formato decimal positivo sin limitación fija de 2 decimales (permite tasas extendidas).
 * - Valida mayor a 0 con Big.js.
 */
const exchangeRateSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine(
    (value) => /^\d+(\.\d+)?$/.test(value),
    'La tasa de cambio debe ser un número decimal válido.',
  )
  .refine((value) => {
    try {
      return Big(value).gt(0);
    } catch {
      return false;
    }
  }, 'La tasa de cambio debe ser mayor que cero.');

const customerPaymentBodySchema = z
  .object({
    amountReceived: monetaryAmountSchema,
    currency: z.enum(['USD', 'VES']),
    paymentMethod: z.enum([
      'Efectivo',
      'Divisas',
      'Tarjeta',
      'Pago Movil',
      'Transferencia',
      'Zelle',
      'BIOPAGO',
    ]),
    exchangeRate: exchangeRateSchema.optional(),
    exchangeRateType: z.enum(['COMERCIAL', 'NO_APLICA']).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.currency === 'VES') {
      if (data.exchangeRate === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['exchangeRate'],
          message: 'La tasa comercial es obligatoria para pagos en VES.',
        });
      }

      if (data.exchangeRateType !== 'COMERCIAL') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['exchangeRateType'],
          message: 'Los pagos en VES requieren tasa COMERCIAL.',
        });
      }
    }

    if (data.currency === 'USD') {
      if (data.exchangeRate !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['exchangeRate'],
          message: 'Los pagos en USD no deben enviar una tasa.',
        });
      }

      if (
        data.exchangeRateType !== undefined &&
        data.exchangeRateType !== 'NO_APLICA'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['exchangeRateType'],
          message: 'Los pagos en USD no utilizan tasa de cambio.',
        });
      }
    }
  });

export const registerCustomerPaymentSchema = z.object({
  params: idParamSchema,
  body: customerPaymentBodySchema,
});

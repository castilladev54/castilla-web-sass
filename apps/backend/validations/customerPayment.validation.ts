import { z } from 'zod';
import { idParamSchema } from '@inventory/shared/validations';

const decimalStringSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine(
    (value) => /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)),
    'Debe ser un importe decimal válido.',
  )
  .refine((value) => Number(value) > 0, 'Debe ser mayor que cero.');

const customerPaymentBodySchema = z
  .object({
    amountReceived: decimalStringSchema,
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
    exchangeRate: decimalStringSchema.optional(),
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

import mongoose from 'mongoose';
import {
  DecimalConfig,
  DecimalOptionalConfig,
} from '../utils/decimalConfig.js';

const isPositiveDecimal = (value: unknown): boolean => {
  if (value == null) return false;

  const amount = Number(value.toString());
  return Number.isFinite(amount) && amount > 0;
};

const customerPaymentSchema = new mongoose.Schema(
  {
    sale_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: true,
      index: false,
    },

    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },

    business_owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    shift_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CashShift',
      required: true,
    },

    received_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Cantidad que realmente entrega el cliente.
    amount_received: {
      ...DecimalConfig,
      required: true,
      validate: {
        validator: isPositiveDecimal,
        message: 'El importe recibido debe ser mayor que cero.',
      },
    },

    currency: {
      type: String,
      required: true,
      enum: ['USD', 'VES'],
    },

    // Importe que se descuenta de la deuda, expresado en USD.
    amount_applied_usd: {
      ...DecimalConfig,
      required: true,
      validate: {
        validator: isPositiveDecimal,
        message: 'El importe aplicado a la deuda debe ser mayor que cero.',
      },
    },

    // Se congela la tasa usada en este abono.
    exchange_rate: {
      ...DecimalOptionalConfig,
      required: function (this: mongoose.Document) {
        return this.get('currency') === 'VES';
      },
      validate: {
        validator: function (
          this: mongoose.Document,
          value: unknown
        ) {
          if (this.get('currency') === 'VES') {
            return isPositiveDecimal(value);
          }

          return value == null;
        },
        message:
          'Los pagos en VES requieren una tasa positiva; los pagos en USD no deben llevar tasa.',
      },
    },

    exchange_rate_type: {
      type: String,
      required: true,
      enum: ['BCV', 'COMERCIAL', 'NO_APLICA'],
      validate: {
        validator: function (
          this: mongoose.Document,
          value: string
        ) {
          if (this.get('currency') === 'VES') {
            return value === 'BCV' || value === 'COMERCIAL';
          }

          return value === 'NO_APLICA';
        },
        message:
          'El tipo de tasa debe corresponder con la moneda recibida.',
      },
    },

    payment_method: {
      type: String,
      required: true,
      enum: [
        'Efectivo',
        'Divisas',
        'Tarjeta',
        'Pago Movil',
        'Transferencia',
        'Zelle',
        'BIOPAGO'
      ],
    },

    idempotency_key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },

    date: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    id: false,
  }
);

// Consultas del historial de abonos.
customerPaymentSchema.index({ sale_id: 1, date: -1 });
customerPaymentSchema.index({ business_owner_id: 1, date: -1 });
customerPaymentSchema.index({ shift_id: 1, date: -1 });

// Evita duplicar una solicitud dentro del mismo negocio.
customerPaymentSchema.index(
  { business_owner_id: 1, idempotency_key: 1 },
  { unique: true }
);

export const CustomerPayment = mongoose.model(
  'CustomerPayment',
  customerPaymentSchema
);

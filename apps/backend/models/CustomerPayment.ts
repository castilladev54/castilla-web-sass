import mongoose from 'mongoose';
import {
  DecimalConfig,
  DecimalOptionalConfig,
} from '../utils/decimalConfig.js';

const customerPaymentSchema = new mongoose.Schema(
  {
    // Venta a crédito que recibe el abono.
    sale_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: true,
    },

    // Cliente comprador asociado a la venta.
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },

    // Propietario del negocio.
    business_owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Turno de caja donde se recibió el dinero.
    shift_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CashShift',
      required: true,
    },

    // Usuario que registró el abono.
    received_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Importe recibido, expresado en la moneda indicada.
    amount: DecimalConfig,

    // Moneda en la que se recibió el pago.
    currency: {
      type: String,
      required: true,
      enum: ['USD', 'VES'],
      default: 'USD',
    },

    // Método utilizado para recibir el pago.
    payment_method: {
      type: String,
      required: true,
      enum: [
        'Efectivo',
        'Divisas',
        'Tarjeta',
        'Pago Movil',
        'Transferencia',
        'BIOPAGO',
        'Zelle',
      ],
    },

    // Tasa comercial aplicada al pago.
    // Debe conservarse el valor usado en el momento del cobro.
    exchange_rate: DecimalOptionalConfig,

    // Identifica la tasa aplicada y permite auditar su origen.
    exchange_rate_type: {
      type: String,
      enum: ['BCV', 'COMERCIAL', 'NO_APLICA'],
      required: true,
      default: 'NO_APLICA',
    },

    // Clave enviada por el cliente para evitar registrar
    // dos veces el mismo abono por reintentos.
    idempotency_key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },

    // Fecha efectiva del pago.
    date: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      getters: true,
    },
    toObject: {
      getters: true,
    },
    id: false,
  }
);

// Consultar los abonos de una venta en orden cronológico inverso.
customerPaymentSchema.index({
  sale_id: 1,
  date: -1,
});

// Consultar el historial financiero de un negocio.
customerPaymentSchema.index({
  business_owner_id: 1,
  date: -1,
});

// Consultar los cobros recibidos durante un turno.
customerPaymentSchema.index({
  shift_id: 1,
  date: -1,
});

// Impedir que una misma solicitud registre dos abonos
// dentro del mismo negocio.
customerPaymentSchema.index(
  {
    business_owner_id: 1,
    idempotency_key: 1,
  },
  {
    unique: true,
  }
);

export const CustomerPayment = mongoose.model(
  'CustomerPayment',
  customerPaymentSchema
);

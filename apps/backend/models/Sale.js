import mongoose from 'mongoose';
import { DecimalConfig, DecimalOptionalConfig } from '../utils/decimalConfig.ts';

const saleSchema = new mongoose.Schema({
  shift_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CashShift',
    required: true
  },
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null
  },
  business_owner_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sold_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  branch_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  total_amount: DecimalConfig,
  payment_method: {
    type: String,
    required: true,
    enum: ['Efectivo', 'Divisas', 'Tarjeta', 'Pago Movil', 'Transferencia', 'Zelle']
  },
  exchange_rate: DecimalOptionalConfig,
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'completed'
  }
}, { 
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  id: false
});

saleSchema.index({ shift_id: 1 }); // Indexado para acelerar las agregaciones de arqueo
saleSchema.index({ customer_id: 1, createdAt: -1 });
saleSchema.index({ customer_id: 1, sold_by: 1, createdAt: -1 });
saleSchema.index({ customer_id: 1, branch_id: 1, createdAt: -1 });

saleSchema.index({ business_owner_id: 1, createdAt: -1 });
saleSchema.index({ business_owner_id: 1, sold_by: 1, createdAt: -1 });
saleSchema.index({ business_owner_id: 1, branch_id: 1, createdAt: -1 });

export const Sale = mongoose.model('Sale', saleSchema);

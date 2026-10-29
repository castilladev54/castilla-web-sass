import mongoose from 'mongoose';
import { DecimalConfig, DecimalOptionalConfig } from '../utils/decimalConfig.ts';

const purchaseSchema = new mongoose.Schema({
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  branch_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: false,
    default: null
  },
  supplier: {
    type: String,
    required: true
  },
  invoice_number: {
    type: String,
    trim: true,
    default: null
  },
  total_cost: DecimalConfig,
  exchange_rate: DecimalOptionalConfig,
  status: {
    type: String,
    enum: ['PENDING', 'PARTIAL', 'PAID'],
    default: 'PENDING'
  },
  due_date: {
    type: Date,
    required: true
  },
  paid_amount: {
    ...DecimalConfig,
    default: mongoose.Types.Decimal128.fromString('0')
  },
  payment_date: {
    type: Date
  },
  date: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  id: false
});

purchaseSchema.index({ admin_id: 1, createdAt: -1 });

export const Purchase = mongoose.model('Purchase', purchaseSchema);

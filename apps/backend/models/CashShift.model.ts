import { Schema, model, Document, Types } from 'mongoose';

export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface ICashShift {
  branch_id: Types.ObjectId;
  cashier_id?: Types.ObjectId | null;
  user_id?: Types.ObjectId | null;
  status: ShiftStatus;
  opening_balance: Types.Decimal128;
  expected_balance?: Types.Decimal128;
  closing_balance?: Types.Decimal128;
  total_sales_amount?: Types.Decimal128;
  opened_at: Date;
  closed_at?: Date;
}

export interface ICashShiftDocument extends ICashShift, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CashShiftSchema = new Schema<ICashShiftDocument>(
  {
    branch_id: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    cashier_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'CLOSED'],
      default: 'OPEN',
      required: true,
    },
    opening_balance: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    expected_balance: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    closing_balance: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    total_sales_amount: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    opened_at: {
      type: Date,
      default: Date.now,
      required: true,
    },
    closed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        if (ret.opening_balance) ret.opening_balance = ret.opening_balance.toString() as any;
        if (ret.expected_balance) ret.expected_balance = ret.expected_balance.toString() as any;
        if (ret.closing_balance) ret.closing_balance = ret.closing_balance.toString() as any;
        if (ret.total_sales_amount) ret.total_sales_amount = ret.total_sales_amount.toString() as any;
        return ret;
      },
    },
  }
);

CashShiftSchema.pre('validate', function () {
  if (!this.cashier_id && this.user_id) {
    this.cashier_id = this.user_id;
  }
  if (!this.user_id && this.cashier_id) {
    this.user_id = this.cashier_id;
  }
});

CashShiftSchema.index(
  { branch_id: 1, cashier_id: 1, status: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { status: 'OPEN', cashier_id: { $exists: true } },
  }
);

export const CashShift = model<ICashShiftDocument>('CashShift', CashShiftSchema);

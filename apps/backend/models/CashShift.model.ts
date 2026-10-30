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
  // Desglose físico por moneda (USD y VES)
  opening_balance_usd?: Types.Decimal128;
  opening_balance_ves?: Types.Decimal128;
  expected_balance_usd?: Types.Decimal128;
  expected_balance_ves?: Types.Decimal128;
  closing_balance_usd?: Types.Decimal128;
  closing_balance_ves?: Types.Decimal128;
  total_sales_usd?: Types.Decimal128;
  total_sales_ves?: Types.Decimal128;
  total_payments_usd?: Types.Decimal128;
  total_payments_ves?: Types.Decimal128;
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
    // Desglose por moneda (USD y VES)
    opening_balance_usd: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    opening_balance_ves: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    expected_balance_usd: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    expected_balance_ves: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    closing_balance_usd: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    closing_balance_ves: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    total_sales_usd: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    total_sales_ves: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    total_payments_usd: {
      type: Schema.Types.Decimal128,
      default: null,
    },
    total_payments_ves: {
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
        const decimalKeys = [
          'opening_balance',
          'expected_balance',
          'closing_balance',
          'total_sales_amount',
          'opening_balance_usd',
          'opening_balance_ves',
          'expected_balance_usd',
          'expected_balance_ves',
          'closing_balance_usd',
          'closing_balance_ves',
          'total_sales_usd',
          'total_sales_ves',
          'total_payments_usd',
          'total_payments_ves',
        ] as const satisfies readonly (keyof ICashShiftDocument)[];

        for (const key of decimalKeys) {
          const value = ret[key];

          if (value != null) {
            Object.assign(ret, { [key]: value.toString() });
          }
        }
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
    partialFilterExpression: { status: 'OPEN', cashier_id: { $exists: true } },
  }
);


export const CashShift = model<ICashShiftDocument>('CashShift', CashShiftSchema);

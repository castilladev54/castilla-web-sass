import mongoose, { Schema, model, Document, Types } from "mongoose";
import { DecimalConfig, DecimalOptionalConfig } from "../utils/decimalConfig.js";

export interface IInventory extends Document {
  _id: Types.ObjectId;
  product_id: Types.ObjectId;
  branch_id: Types.ObjectId;
  owner_id: Types.ObjectId;
  quantity: mongoose.Types.Decimal128;
  min_stock_alert: mongoose.Types.Decimal128;
  updatedAt: Date;
  createdAt: Date;
  stock?: mongoose.Types.Decimal128 | number | string;
}

const normalizeDecimal128 = (value: unknown) => {
  if (value instanceof mongoose.Types.Decimal128) return value;
  if (value === undefined || value === null || value === '') return mongoose.Types.Decimal128.fromString('0');
  return mongoose.Types.Decimal128.fromString(String(value));
};

const inventorySchema = new Schema<IInventory>(
  {
    product_id: { type: Schema.Types.ObjectId, required: true, ref: "Product" },
    branch_id: { type: Schema.Types.ObjectId, required: true, ref: "Branch" },
    owner_id: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    quantity: {
      ...DecimalConfig,
      default: mongoose.Types.Decimal128.fromString('0')
    },
    min_stock_alert: {
      ...DecimalConfig,
      default: mongoose.Types.Decimal128.fromString('0')
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    id: false
  }
);

inventorySchema.virtual('stock')
  .get(function (this: IInventory) {
    return this.quantity ?? mongoose.Types.Decimal128.fromString('0');
  })
  .set(function (this: IInventory, value: unknown) {
    this.quantity = normalizeDecimal128(value);
  });

inventorySchema.pre('validate', function (next) {
  if (this.quantity === undefined || this.quantity === null) {
    const value = (this as any).stock;
    if (value !== undefined && value !== null) {
      this.quantity = normalizeDecimal128(value);
    }
  }
  next();
});

inventorySchema.index({ product_id: 1, branch_id: 1 }, { unique: true });
inventorySchema.index({ owner_id: 1, branch_id: 1 });

export const Inventory = model<IInventory>("Inventory", inventorySchema);

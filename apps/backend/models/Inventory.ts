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

inventorySchema.index({ product_id: 1, branch_id: 1 }, { unique: true });
inventorySchema.index({ owner_id: 1, branch_id: 1 });

export const Inventory = model<IInventory>("Inventory", inventorySchema);

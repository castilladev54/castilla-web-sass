
import mongoose, { Schema, model, Document, Types } from "mongoose";
import { DecimalConfig } from "../utils/decimalConfig.js";

export interface ISaleDetail extends Document {
  _id: Types.ObjectId;
  sale_id: Types.ObjectId;
  product_id: Types.ObjectId;
  quantity: mongoose.Types.Decimal128;
  unit_price: mongoose.Types.Decimal128;
  createdAt: Date;
  updatedAt: Date;
}

const saleDetailSchema = new Schema<ISaleDetail>(
  {
    sale_id: {
      type: Schema.Types.ObjectId,
      ref: "Sale",
      required: true,
    },
    product_id: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      ...DecimalConfig,
      required: true,
    },
    unit_price: {
      ...DecimalConfig,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    id: false,
  },
);

saleDetailSchema.index({ sale_id: 1 });

export const SaleDetail = model<ISaleDetail>(
  "SaleDetail",
  saleDetailSchema,
);

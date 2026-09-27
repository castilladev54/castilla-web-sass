import mongoose, { Document, Schema } from 'mongoose';

import { TransferStatus } from './transferStatus.enum.js';

export interface StockTransferItem {
  product_id: string;
  quantity: string;
}

export interface StockTransfer extends Document {
  sourceBranchId: string;
  destinationBranchId: string;
  items: StockTransferItem[];
  status: TransferStatus;
  createdBy: string;
  businessOwnerId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StockTransferItemSchema = new Schema<StockTransferItem>(
  {
    product_id: {
      type: String,
      required: true,
    },
    quantity: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const StockTransferSchema = new Schema<StockTransfer>(
  {
    sourceBranchId: {
      type: String,
      required: true,
      index: true,
    },

    destinationBranchId: {
      type: String,
      required: true,
      index: true,
    },

    items: {
      type: [StockTransferItemSchema],
      required: true,
      validate: {
        validator: (items: StockTransferItem[]) => items.length > 0,
        message: 'La transferencia debe contener al menos un producto.',
      },
    },

    status: {
      type: String,
      enum: Object.values(TransferStatus),
      default: TransferStatus.COMPLETED,
      required: true,
      index: true,
    },

    createdBy: {
      type: String,
      required: true,
    },

    businessOwnerId: {
      type: String,
      required: true,
      index: true,
    },

    notes: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

StockTransferSchema.index({
  businessOwnerId: 1,
  createdAt: -1,
});

export const StockTransferModel = mongoose.model<StockTransfer>(
  'StockTransfer',
  StockTransferSchema,
);

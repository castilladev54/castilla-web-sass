import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  email?: string;
  phone?: string;
  document_id?: string;
  address?: string;
  businessOwnerId: Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    document_id: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    businessOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  { timestamps: true }
);

// Índice para listar clientes por tenant y estado.
customerSchema.index({
  businessOwnerId: 1,
  isActive: 1,
  name: 1,
});

// Documento único por tenant cuando se proporciona un valor no vacío.
customerSchema.index(
  { businessOwnerId: 1, document_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      document_id: { $type: 'string', $gt: '' },
    },
  }
);


export const Customer: Model<ICustomer> =
(mongoose.models.Customer as Model<ICustomer> | undefined) ??
mongoose.model<ICustomer>('Customer', customerSchema);
/**
 * @inventory/shared — Esquemas de Validación Zod (Body-Only)
 *
 * Estos esquemas validan SOLO el cuerpo de la petición (sin el wrapper
 * `{ body: z.object(...) }`). El backend compone el wrapper en su middleware
 * `validate.js`. El frontend los usa directamente para validación de formularios.
 *
 * Cada esquema exporta también su tipo inferido como DTO.
 */

import { z } from 'zod';
import {
  OBJECT_ID_REGEX,
  UNIT_TYPES,
  PAYMENT_METHODS,
  ADJUSTMENT_REASONS_BACKEND,
  STOCK_CORRECTION_REASONS,
  BranchId,
  ProductId,
} from '../types/index.js';
import { zNominalId } from './common.js';

// ─── HELPERS ────────────────────────────────────────────────────────────────

// Validador estricto para strings matemáticos (acepta negativos y decimales)
const numericString = z.string().regex(/^-?\d+(\.\d+)?$/, "Debe ser un número válido expresado como texto");

// Validador de Llave de Idempotencia para aislamiento de red (UUID v4)
export const idempotencyHeaderSchema = z.string().uuid("La llave de idempotencia debe ser un UUID v4 válido");

/** Validador reutilizable de MongoDB ObjectId (regex, sin depender de mongoose) */
export const objectIdSchema = z.string().regex(OBJECT_ID_REGEX, 'ID no válido');

// ─── AUTH ────────────────────────────────────────────────────────────────────

export const createUserBodySchema = z.object({
  email: z.string().email('Invalid email format').min(1, 'Email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['admin', 'TENANT_OWNER']).optional(),
});
export type CreateUserDTO = z.infer<typeof createUserBodySchema>;

export const loginBodySchema = z.object({
  email: z.string().email('Invalid email format').min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginDTO = z.infer<typeof loginBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: z.string().email('Invalid email format').min(1, 'Email is required'),
});
export type ForgotPasswordDTO = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordParamsSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const resetPasswordBodySchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});
export type ResetPasswordDTO = z.infer<typeof resetPasswordBodySchema>;

// ─── CATEGORÍAS ─────────────────────────────────────────────────────────────

export const createCategoryBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  max_debt_limit: numericString.optional(),
});
export type CreateCategoryDTO = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  max_debt_limit: numericString.optional(),
});
export type UpdateCategoryDTO = z.infer<typeof updateCategoryBodySchema>;

// ─── PRODUCTOS ──────────────────────────────────────────────────────────────

export const createProductBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  barcode: z.string().min(1, 'Barcode cannot be empty').optional(),
  price: z.coerce.number().positive('El precio debe ser mayor a 0'),
  unit_type: z.enum(['unidad', 'kg', 'litro', 'metro'] as const).optional(),
  category: z.string().regex(OBJECT_ID_REGEX, 'Invalid Category ID format'),
  max_debt_limit: numericString.optional(),
  initial_stock: numericString.optional(),
  branch_id: z.string().regex(OBJECT_ID_REGEX, 'Invalid Branch ID format').optional(),
});
export type CreateProductDTO = z.infer<typeof createProductBodySchema>;

export const updateProductBodySchema = z
  .object({
    name: z.string().min(1, 'Name is required').optional(),
    description: z.string().optional(),
    barcode: z.string().min(1, 'Barcode cannot be empty').nullable().optional(),
    price: z.coerce.number().positive('El precio debe ser mayor a 0').optional(),

    unit_type: z.enum(['unidad', 'kg', 'litro', 'metro'] as const).optional(),
    category: z.string().regex(OBJECT_ID_REGEX, 'Invalid Category ID format').optional(),

    max_debt_limit: numericString.optional(),
    stock_reason: z
      .enum(['initial_count', 'damaged', 'stolen', 'expired', 'correction', 'other'] as const)
      .optional(),

  })

export type UpdateProductDTO = z.infer<typeof updateProductBodySchema>;

// ─── CLIENTES ────────────────────────────────────────────────────────────────

export const createCustomerBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(150, 'El nombre no puede superar los 150 caracteres'),

  email: z
    .string()
    .trim()
    .email('El email no tiene un formato válido')
    .max(254, 'El email no puede superar los 254 caracteres')
    .optional(),

  phone: z
    .string()
    .trim()
    .max(30, 'El teléfono no puede superar los 30 caracteres')
    .optional(),

  document_id: z
    .string()
    .trim()
    .min(1, 'El documento no puede estar vacío')
    .max(50, 'El documento no puede superar los 50 caracteres')
    .optional(),

  address: z
    .string()
    .trim()
    .max(300, 'La dirección no puede superar los 300 caracteres')
    .optional(),
});

export type CreateCustomerDTO = z.infer<typeof createCustomerBodySchema>;

export const updateCustomerBodySchema = createCustomerBodySchema.partial();

export type UpdateCustomerDTO = z.infer<typeof updateCustomerBodySchema>;

// ─── VENTAS ─────────────────────────────────────────────────────────────────

export const saleItemSchema = z.object({
  product_id: z.string().regex(OBJECT_ID_REGEX, 'Invalid Product ID format'),
  quantity: numericString,
  unit_price: numericString,
});
export type SaleItemDTO = z.infer<typeof saleItemSchema>;

export const createSaleBodySchema = z.object({
  items: z.array(saleItemSchema).min(1, 'At least one product item is required'),
  payment_method: z.enum(['Efectivo', 'Divisas', 'Tarjeta', 'Pago Movil', 'Transferencia', 'Zelle'] as const),
  exchange_rate: numericString.optional(),
});
export type CreateSaleDTO = z.infer<typeof createSaleBodySchema>;

export const updateSaleBodySchema = z.object({
  total_amount: numericString.optional(),
  payment_method: z
    .enum(['Efectivo', 'Divisas', 'Tarjeta', 'Pago Movil', 'Transferencia', 'Zelle'] as const)
    .optional(),
  items: z.array(saleItemSchema).min(1, 'At least one product item is required').optional(),
});
export type UpdateSaleDTO = z.infer<typeof updateSaleBodySchema>;

// ─── COMPRAS ────────────────────────────────────────────────────────────────

export const purchaseItemSchema = z.object({
  product_id: zNominalId<'ProductId'>(),
  quantity: numericString,
  unit_cost: numericString,
});
export type PurchaseItemDTO = z.infer<typeof purchaseItemSchema>;

export const createPurchaseBodySchema = z.object({
  supplier: z.string().min(1, 'Supplier is required'),
  items: z.array(purchaseItemSchema).min(1, 'At least one product item is required'),
  dueDate: z.string().datetime({ offset: true }).optional(),
  exchange_rate: numericString.optional(),
});
export type CreatePurchaseDTO = z.infer<typeof createPurchaseBodySchema>;

export const purchaseHeaderSchema = z.object({
  'x-branch-id': zNominalId<'BranchId'>()
});

// ─── AJUSTES DE INVENTARIO ──────────────────────────────────────────────────

export const createAdjustmentBodySchema = z.object({
  product_id: objectIdSchema,
  new_stock: numericString,
  reason: z.enum(['initial_count', 'damaged', 'stolen', 'expired', 'correction', 'other'] as const),
  notes: z.string().optional(),
});
export type CreateAdjustmentDTO = z.infer<typeof createAdjustmentBodySchema>;

// ─── TRANSFERENCIAS DE STOCK ────────────────────────────────────────────────

const positiveNumericString = numericString.refine(
  (value) => Number(value) > 0,
  'La cantidad debe ser mayor que 0'
);

export const createStockTransferItemSchema = z.object({
  product_id: z
    .string()
    .regex(OBJECT_ID_REGEX, 'Invalid Product ID format'),
  quantity: positiveNumericString,
});

export const createStockTransferBodySchema = z
  .object({
    sourceBranchId: z
      .string()
      .regex(OBJECT_ID_REGEX, 'Invalid Source Branch ID format'),
    destinationBranchId: z
      .string()
      .regex(OBJECT_ID_REGEX, 'Invalid Destination Branch ID format'),
    items: z
      .array(createStockTransferItemSchema)
      .min(1, 'Debe incluir al menos un producto'),
    notes: z.string().trim().optional(),
  })
  .refine((data) => data.sourceBranchId !== data.destinationBranchId, {
    message: 'La sucursal de origen y destino deben ser diferentes',
    path: ['destinationBranchId'],
  });

export interface CreateStockTransferItemDTO {
  product_id: ProductId;
  quantity: string;
}

export interface CreateStockTransferDTO {
  sourceBranchId: BranchId;
  destinationBranchId: BranchId;
  items: CreateStockTransferItemDTO[];
  notes?: string;
}

// ─── TASAS DE CAMBIO ────────────────────────────────────────────────────────

export const rateBodySchema = z.object({
  rate: numericString,
  date: z.string().optional(),
});
export type RateDTO = z.infer<typeof rateBodySchema>;

// ─── ESQUEMAS DE PARAMS (reutilizados en el backend) ────────────────────────

export const idParamSchema = z.object({
  id: z.string().regex(OBJECT_ID_REGEX, 'Invalid ID format'),
});

export const barcodeParamSchema = z.object({
  code: z.string().min(1, 'Barcode is required'),
});

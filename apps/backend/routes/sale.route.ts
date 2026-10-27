import express from 'express';
import {
    createSale,
    getSales,
    getSaleById,
    cancelSale,
    updateSale
} from '../controllers/sale.controller.js';
import { checkIdempotency, withIdempotency } from '../middlewares/idempotency.middleware.js';
import { validate } from '../middleware/validate.js';
import { createSaleSchema, saleIdSchema, updateSaleSchema } from '../validations/sale.validation.js';
import { requireBranchHeader } from '../middleware/requireBranchHeader.js';
import {
    ensureCashShiftOpen,
    attachOpenCashShiftIfExists
} from '../middleware/ensureCashShiftOpen.js';
import { registerCustomerPayment } from '../controllers/customerPayment.controller.js';
import { registerCustomerPaymentSchema } from '../validations/customerPayment.validation.js';

const router = express.Router();

// Rutas para Ventas (Sales)
// ensureCashShiftOpen verifica turno activo e inyecta req.cashShift antes de crear la venta física
router.post('/', requireBranchHeader, ensureCashShiftOpen, checkIdempotency, validate(createSaleSchema), withIdempotency(createSale));
router.get('/', getSales);
router.get('/:id', validate(saleIdSchema), getSaleById);
router.patch('/:id', validate(updateSaleSchema), updateSale);
router.put('/:id/cancel', validate(saleIdSchema), cancelSale);
// Abonos
router.post(
    '/:id/payments',
    requireBranchHeader,
    checkIdempotency,
    attachOpenCashShiftIfExists,
    validate(registerCustomerPaymentSchema),
    withIdempotency(registerCustomerPayment),
);

export default router;


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
import { ensureCashShiftOpen } from '../middleware/ensureCashShiftOpen.js';

const router = express.Router();

// Rutas para Ventas (Sales)
// ensureCashShiftOpen verifica turno activo e inyecta req.cashShift antes de crear la venta física
router.post('/', requireBranchHeader, ensureCashShiftOpen, checkIdempotency, validate(createSaleSchema), withIdempotency(createSale));
router.get('/', getSales);
router.get('/:id', validate(saleIdSchema), getSaleById);
router.patch('/:id', validate(updateSaleSchema), updateSale);
router.put('/:id/cancel', validate(saleIdSchema), cancelSale);

export default router;


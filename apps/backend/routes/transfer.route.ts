import { Router } from 'express';
import { z } from 'zod';

import {
  executeStockTransfer,
  setTransferStatus,
} from '../controllers/transfer.controller.js';

import {
  TransferStatus,
} from '../models/transferStatus.enum.js';

import { validateBody } from '../middleware/validation.js';

import {
  createStockTransferBodySchema,
} from '@inventory/shared/validations';

const router = Router();

const statusSchema = z.object({
  status: z.nativeEnum(TransferStatus),
});

router.post(
  '/',
  validateBody(createStockTransferBodySchema),
  executeStockTransfer,
);

router.put(
  '/:id/status',
  validateBody(statusSchema),
  setTransferStatus,
);

export default router;

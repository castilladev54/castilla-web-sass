import express from 'express';

import { customerController } from '../controllers/customer.controllers.js';
import { requireRole } from '../middleware/requirePermission.js';

const router = express.Router();

// Empleados necesitan crear clientes durante una venta.
router.post(
  '/',
  customerController.createCustomer
);

// Empleados necesitan buscar/consultar clientes durante una venta.
router.get(
  '/',
  customerController.getCustomers
);

router.get(
  '/:id',
  customerController.getCustomerById
);

// Modificación administrativa.
router.patch(
  '/:id',
  requireRole(['TENANT_OWNER', 'admin']),
  customerController.updateCustomer
);

// Eliminación lógica administrativa.
router.delete(
  '/:id',
  requireRole(['TENANT_OWNER', 'admin']),
  customerController.deleteCustomer
);

export default router;
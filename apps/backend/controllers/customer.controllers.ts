import { Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';

import {
  createCustomerBodySchema,
  updateCustomerBodySchema,
} from '@inventory/shared/validations';

import {
  CustomerService,
  customerService,
} from '../services/customer.service.js';

const isValidObjectId = (id: string): boolean =>
  mongoose.isValidObjectId(id);

const getPagination = (req: Request) => {
  const rawPage = Number(req.query.page ?? 1);
  const rawLimit = Number(req.query.limit ?? 20);

  const page =
    Number.isInteger(rawPage) && rawPage > 0
      ? rawPage
      : 1;

  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 100)
      : 20;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

export class CustomerController {
  constructor(
    private readonly service: CustomerService
  ) {}

  /**
   * POST /api/customers
   */
  public createCustomer = async (
    req: Request,
    res: Response
  ): Promise<Response> => {
    try {
      const businessOwnerId = req.businessOwnerId;

      if (!businessOwnerId) {
        return res.status(401).json({
          success: false,
          message: 'Contexto de negocio no disponible.',
        });
      }

      const payload = createCustomerBodySchema.parse(req.body);

      const customer = await this.service.createCustomer(
        businessOwnerId,
        payload
      );

      return res.status(201).json({
        success: true,
        customer,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Datos de cliente inválidos.',
          errors: error.issues,
        });
      }

      if (
        error instanceof Error &&
        error.message === 'DOCUMENT_ALREADY_EXISTS'
      ) {
        return res.status(409).json({
          success: false,
          message: 'Ya existe un cliente con ese documento.',
        });
      }

      console.error('Error creating customer:', error);

      return res.status(500).json({
        success: false,
        message: 'Error interno al crear el cliente.',
      });
    }
  };

  /**
   * GET /api/customers
   */
  public getCustomers = async (
    req: Request,
    res: Response
  ): Promise<Response> => {
    try {
      const businessOwnerId = req.businessOwnerId;

      if (!businessOwnerId) {
        return res.status(401).json({
          success: false,
          message: 'Contexto de negocio no disponible.',
        });
      }

      const { page, limit, skip } = getPagination(req);

      const search =
        typeof req.query.search === 'string'
          ? req.query.search.trim()
          : undefined;

      const filters = {
        search: search || undefined,
        isActive: true,
      };

      const [customers, total] = await Promise.all([
        this.service.fetchCustomers(
          businessOwnerId,
          filters,
          skip,
          limit
        ),
        this.service.fetchCustomersCount(
          businessOwnerId,
          filters
        ),
      ]);

      return res.status(200).json({
        success: true,
        customers,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      });
    } catch (error) {
      console.error('Error fetching customers:', error);

      return res.status(500).json({
        success: false,
        message: 'Error interno al obtener los clientes.',
      });
    }
  };

  /**
   * GET /api/customers/:id
   */
  public getCustomerById = async (
    req: Request,
    res: Response
  ): Promise<Response> => {
    try {
      const businessOwnerId = req.businessOwnerId;
      const rawId = req.params.id;

      if (!businessOwnerId) {
        return res.status(401).json({
          success: false,
          message: 'Contexto de negocio no disponible.',
        });
      }

      if (typeof rawId !== 'string' || !isValidObjectId(rawId)) {
        return res.status(400).json({
          success: false,
          message: 'ID de cliente inválido.',
        });
      }

      const id = rawId;

      const customer = await this.service.fetchCustomerById(
        id,
        businessOwnerId
      );

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Cliente no encontrado.',
        });
      }

      return res.status(200).json({
        success: true,
        customer,
      });
    } catch (error) {
      console.error('Error fetching customer:', error);

      return res.status(500).json({
        success: false,
        message: 'Error interno al obtener el cliente.',
      });
    }
  };

  /**
   * PATCH /api/customers/:id
   */
  public updateCustomer = async (
    req: Request,
    res: Response
  ): Promise<Response> => {
    try {
      const businessOwnerId = req.businessOwnerId;
      const rawId = req.params.id;

      if (!businessOwnerId) {
        return res.status(401).json({
          success: false,
          message: 'Contexto de negocio no disponible.',
        });
      }

      if (typeof rawId !== 'string' || !isValidObjectId(rawId)) {
        return res.status(400).json({
          success: false,
          message: 'ID de cliente inválido.',
        });
      }

      const id = rawId;

      const payload = updateCustomerBodySchema.parse(req.body);

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Debe proporcionar al menos un campo para actualizar.',
        });
      }

      const customer = await this.service.updateCustomer(
        id,
        businessOwnerId,
        payload
      );

      return res.status(200).json({
        success: true,
        customer,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Datos de cliente inválidos.',
          errors: error.issues,
        });
      }

      if (
        error instanceof Error &&
        error.message === 'DOCUMENT_ALREADY_EXISTS'
      ) {
        return res.status(409).json({
          success: false,
          message: 'Ya existe un cliente con ese documento.',
        });
      }

      if (
        error instanceof Error &&
        error.message === 'NOT_FOUND'
      ) {
        return res.status(404).json({
          success: false,
          message: 'Cliente no encontrado.',
        });
      }

      console.error('Error updating customer:', error);

      return res.status(500).json({
        success: false,
        message: 'Error interno al actualizar el cliente.',
      });
    }
  };

  /**
   * DELETE /api/customers/:id
   * Soft delete: isActive = false
   */
  public deleteCustomer = async (
    req: Request,
    res: Response
  ): Promise<Response> => {
    try {
      const businessOwnerId = req.businessOwnerId;
      const rawId = req.params.id;

      if (!businessOwnerId) {
        return res.status(401).json({
          success: false,
          message: 'Contexto de negocio no disponible.',
        });
      }

      if (typeof rawId !== 'string' || !isValidObjectId(rawId)) {
        return res.status(400).json({
          success: false,
          message: 'ID de cliente inválido.',
        });
      }

      const id = rawId;

      await this.service.archiveCustomer(
        id,
        businessOwnerId
      );

      return res.status(200).json({
        success: true,
        message: 'Cliente archivado correctamente.',
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'NOT_FOUND'
      ) {
        return res.status(404).json({
          success: false,
          message: 'Cliente no encontrado.',
        });
      }

      console.error('Error archiving customer:', error);

      return res.status(500).json({
        success: false,
        message: 'Error interno al archivar el cliente.',
      });
    }
  };
}

export const customerController = new CustomerController(
  customerService
);
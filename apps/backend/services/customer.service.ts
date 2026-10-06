import { Customer, ICustomer } from '../models/Customer.js';
import { BusinessOwnerId } from '../types/brands.js';
import {
  CreateCustomerDTO,
  UpdateCustomerDTO,
} from '@inventory/shared/validations';

export interface CustomerFilters {
  search?: string;
  isActive?: boolean;
}

export interface CustomerListResult {
  customers: ICustomer[];
  total: number;
}

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

export class CustomerService {
  /**
   * Crea un cliente dentro del tenant autenticado.
   *
   * businessOwnerId nunca viene del body.
   */
  public async createCustomer(
    businessOwnerId: BusinessOwnerId,
    payload: CreateCustomerDTO
  ) {
    try {
      const customer = new Customer({
        ...payload,
        businessOwnerId,
        isActive: true,
      });

      return await customer.save();
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new Error('DOCUMENT_ALREADY_EXISTS');
      }

      throw error;
    }
  }

  /**
   * Lista clientes pertenecientes exclusivamente al tenant.
   *
   * Por defecto devuelve únicamente clientes activos.
   */
  public async fetchCustomers(
    businessOwnerId: BusinessOwnerId,
    filters: CustomerFilters = {},
    skip = 0,
    limit = 20
  ) {
    const query: Record<string, unknown> = {
      businessOwnerId,
      isActive: filters.isActive ?? true,
    };

    if (filters.search?.trim()) {
      const search = escapeRegex(filters.search.trim());

      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { document_id: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } }
      ];
    }

    return Customer.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  /**
   * Cuenta clientes del tenant aplicando los mismos filtros
   * utilizados en fetchCustomers().
   */
  public async fetchCustomersCount(
    businessOwnerId: BusinessOwnerId,
    filters: CustomerFilters = {}
  ) {
    const query: Record<string, unknown> = {
      businessOwnerId,
      isActive: filters.isActive ?? true,
    };

    if (filters.search?.trim()) {
      const search = escapeRegex(filters.search.trim());

      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { document_id: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } }
      ];
    }

    return Customer.countDocuments(query);
  }

  /**
   * Obtiene un cliente únicamente si pertenece al tenant.
   */
  public async fetchCustomerById(
    customerId: string,
    businessOwnerId: BusinessOwnerId
  ) {
    return Customer.findOne({
      _id: customerId,
      businessOwnerId,
    }).lean();
  }

  /**
   * Actualiza únicamente los campos permitidos por UpdateCustomerDTO.
   */
  public async updateCustomer(
    customerId: string,
    businessOwnerId: BusinessOwnerId,
    payload: UpdateCustomerDTO
  ) {
    try {
      const customer = await Customer.findOneAndUpdate(
        {
          _id: customerId,
          businessOwnerId,
        },
        {
          $set: payload,
        },
        {
          new: true,
          runValidators: true,
        }
      );

      if (!customer) {
        throw new Error('NOT_FOUND');
      }

      return customer;
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new Error('DOCUMENT_ALREADY_EXISTS');
      }

      throw error;
    }
  }

  /**
   * Desactiva lógicamente al cliente.
   *
   * No elimina físicamente el documento porque puede estar
   * relacionado posteriormente con ventas/facturas históricas.
   */
  public async archiveCustomer(
    customerId: string,
    businessOwnerId: BusinessOwnerId
  ) {
    const customer = await Customer.findOneAndUpdate(
      {
        _id: customerId,
        businessOwnerId,
      },
      {
        $set: {
          isActive: false,
        },
      },
      {
        new: true,
      }
    );

    if (!customer) {
      throw new Error('NOT_FOUND');
    }

    return customer;
  }
}

export const customerService = new CustomerService();
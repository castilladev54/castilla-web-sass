import { AppError } from '../lib/error.js';

/**
 * Excepción de dominio para operaciones de ventas cuando
 * el cliente especificado no es válido (no existe, no pertenece al tenant o está archivado).
 *
 * Status 400 (Bad Request) o 422 (Unprocessable Entity). Usaremos 400 por simplicidad y consistencia.
 */
export class InvalidCustomerError extends AppError {
  public readonly customerId: string;

  constructor(customerId: string, message: string = 'Cliente inválido o inactivo.') {
    super(400, message);
    this.name = 'InvalidCustomerError';
    this.customerId = customerId;
  }
}

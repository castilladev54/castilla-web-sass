export class AppError extends Error {
  constructor(public status: number, public message: string) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Excepción de dominio para operaciones de inventario donde
 * el stock disponible es insuficiente para completar la transacción.
 *
 * Status 409 (Conflict): el estado actual del recurso (stock) entra en
 * conflicto con la operación solicitada (venta/ajuste).
 */
export class InsufficientStockError extends AppError {
  public readonly productName: string;
  public readonly productId: string;

  constructor(productName: string, productId: string) {
    super(409, `Stock insuficiente para "${productName}". La operación fue rechazada.`);
    this.name = 'InsufficientStockError';
    this.productName = productName;
    this.productId = productId;
  }
}

/**
 * Excepción de dominio para operaciones de ventas cuando
 * el cliente especificado no es válido (no existe, no pertenece al tenant o está archivado).
 *
 * Status 400 (Bad Request).
 */
export class InvalidCustomerError extends AppError {
  public readonly customerId: string;

  constructor(customerId: string, message: string = 'Cliente inválido o inactivo.') {
    super(400, message);
    this.name = 'InvalidCustomerError';
    this.customerId = customerId;
  }
}

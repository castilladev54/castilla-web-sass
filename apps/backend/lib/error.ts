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

export class SaleNotFoundError extends AppError {
  constructor(message = 'Venta no encontrada o no pertenece a este negocio.') {
    super(404, message);
    this.name = 'SaleNotFoundError';
  }
}

export class InvalidSaleStatusError extends AppError {
  constructor(status: string) {
    super(400, `La venta no está pendiente (estado actual: ${status}).`);
    this.name = 'InvalidSaleStatusError';
  }
}

export class SaleMissingCustomerError extends AppError {
  constructor(message = 'La venta no tiene un cliente asociado.') {
    super(400, message);
    this.name = 'SaleMissingCustomerError';
  }
}

export class OverpaymentError extends AppError {
  constructor(applied: string, pending: string) {
    super(
      400,
      `El importe a aplicar ($${applied} USD) excede el saldo pendiente ($${pending} USD).`
    );
    this.name = 'OverpaymentError';
  }
}

export class InvalidPaymentError extends AppError {
  constructor(message: string) {
    super(400, message);
    this.name = 'InvalidPaymentError';
  }
}

export class CashShiftNotFoundError extends AppError {
  constructor(
    message = 'El turno de caja especificado no existe o no se encuentra abierto.'
  ) {
    super(403, message);
    this.name = 'CashShiftNotFoundError';
  }
}


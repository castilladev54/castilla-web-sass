import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import Big from 'big.js';
import { CashShift } from '../models/CashShift.model.js';
import { Sale } from '../models/Sale.js';
import { CustomerPayment } from '../models/CustomerPayment.js';
import { BranchId } from '../types/brands.js';

// ─── Abrir Turno de Caja ─────────────────────────────────────────────────────

export const openShift = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.actorId ?? req.userId;
    const branchId = req.branchId;
    const { opening_balance } = req.body;

    if (!branchId) {
      res.status(400).json({
        success: false,
        message: 'Header x-branch-id inválido o ausente.',
      });
      return;
    }

    if (
      opening_balance === undefined ||
      opening_balance === null ||
      isNaN(Number(opening_balance)) ||
      Number(opening_balance) < 0
    ) {
      res.status(400).json({
        success: false,
        message:
          'opening_balance es requerido y debe ser un valor numérico no negativo.',
      });
      return;
    }

    // Formateo exacto usando Big.js antes de convertir a Decimal128
    const openingBig = new Big(opening_balance);

    const newShift = await CashShift.create({
      branch_id: new Types.ObjectId(String(branchId)),
      cashier_id: new Types.ObjectId(String(userId)),
      opening_balance: Types.Decimal128.fromString(openingBig.toFixed(2)),
      status: 'OPEN',
      opened_at: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Turno de caja abierto exitosamente.',
      data: newShift,
    });
  } catch (error: any) {
    // Captura de violación de unicidad de clave parcial (E11000)
    if (
      error?.code === 11000 ||
      (error?.name === 'MongoServerError' && error?.code === 11000)
    ) {
      res.status(409).json({
        success: false,
        message: 'El operador ya posee un turno abierto en esta sucursal.',
      });
      return;
    }
    next(error);
  }
};

// ─── Cerrar Turno de Caja ────────────────────────────────────────────────────

export const closeShift = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.actorId ?? req.userId;
    const branchId = req.branchId;
    const { closing_balance } = req.body; // Saldo real en caja reportado al cierre

    if (!branchId) {
      res.status(400).json({
        success: false,
        message: 'Header x-branch-id inválido o ausente.',
      });
      return;
    }

    const activeShift = await CashShift.findOne({
      branch_id: new Types.ObjectId(String(branchId)),
      cashier_id: new Types.ObjectId(String(userId)),
      status: 'OPEN',
    });

    if (!activeShift) {
      res.status(404).json({
        success: false,
        message:
          'No se encontró un turno abierto para cerrar en esta sucursal.',
      });
      return;
    }

    // 1. Agregación de ventas de contado completadas asociadas a este turno.
    // Excluye ventas originadas a crédito (is_credit_sale === true) porque no representan dinero cobrado en este turno.
    const salesAggregation = await Sale.aggregate([
      {
        $match: {
          shift_id: activeShift._id,
          status: 'completed',
          is_credit_sale: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$total_amount' },
        },
      },
    ]);

    // 2. Agregación de abonos a cuentas por cobrar recibidos durante este turno de caja.
    // Se utiliza amount_applied_usd (equivalente contable en USD recibido y registrado).
    const paymentsAggregation = await CustomerPayment.aggregate([
      {
        $match: {
          shift_id: activeShift._id,
        },
      },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: '$amount_applied_usd' },
        },
      },
    ]);

    const openingBalanceBig = new Big(activeShift.opening_balance.toString());
    const totalContadoSalesBig =
      salesAggregation.length > 0 && salesAggregation[0].totalSales
        ? new Big(salesAggregation[0].totalSales.toString())
        : new Big(0);

    const totalPaymentsBig =
      paymentsAggregation.length > 0 && paymentsAggregation[0].totalPayments
        ? new Big(paymentsAggregation[0].totalPayments.toString())
        : new Big(0);

    // Total de ingresos del turno = Ventas al contado + Abonos cobrados
    const totalSalesBig = totalContadoSalesBig.plus(totalPaymentsBig);

    // Arqueo: expected_balance = opening_balance + total_ingresos
    const expectedBalanceBig = openingBalanceBig.plus(totalSalesBig);

    activeShift.expected_balance = Types.Decimal128.fromString(
      expectedBalanceBig.toFixed(2)
    );
    activeShift.total_sales_amount = Types.Decimal128.fromString(
      totalSalesBig.toFixed(2)
    );

    if (closing_balance !== undefined && closing_balance !== null) {
      const closingBig = new Big(closing_balance);
      activeShift.closing_balance = Types.Decimal128.fromString(
        closingBig.toFixed(2)
      );
    }

    activeShift.status = 'CLOSED';
    activeShift.closed_at = new Date();
    await activeShift.save();

    res.status(200).json({
      success: true,
      message: 'Turno de caja cerrado exitosamente.',
      data: activeShift,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Obtener Turno Activo ────────────────────────────────────────────────────

export const getActiveShift = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.actorId ?? req.userId;
    const branchId = req.branchId;

    if (!branchId) {
      res.status(400).json({
        success: false,
        message: 'Header x-branch-id inválido o ausente.',
      });
      return;
    }

    const activeShift = await CashShift.findOne({
      branch_id: new Types.ObjectId(String(branchId)),
      cashier_id: new Types.ObjectId(String(userId)),
      status: 'OPEN',
    });

    res.status(200).json({
      success: true,
      data: activeShift || null,
    });
  } catch (error) {
    next(error);
  }
};

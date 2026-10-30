import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import Big from 'big.js';
import { CashShift } from '../models/CashShift.model.js';
import { Sale } from '../models/Sale.js';
import { CustomerPayment } from '../models/CustomerPayment.js';
import { BranchId } from '../types/brands.js';
import { withTransactionRetry } from '../utils/transaction-retry.js';

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
    const { closing_balance } = req.body;

    if (!branchId) {
      res.status(400).json({
        success: false,
        message: 'Header x-branch-id inválido o ausente.',
      });
      return;
    }

    const closedShift = await withTransactionRetry(async (session) => {
      // Conditional write to coordinate closure with payments.
      const shift = await CashShift.findOneAndUpdate(
        {
          branch_id: new Types.ObjectId(String(branchId)),
          cashier_id: new Types.ObjectId(String(userId)),
          status: 'OPEN',
        },
        {
          $set: { status: 'CLOSED', closed_at: new Date() },
          $inc: { __v: 1 },
        },
        { session, returnDocument: 'after' }
      );

      if (!shift) {
        return null;
      }

      const salesAggregation = await Sale.aggregate([
        { $match: { shift_id: shift._id, status: 'completed', is_credit_sale: { $ne: true } } },
        { $group: { _id: null, totalSales: { $sum: '$total_amount' } } },
      ]).session(session);

      const paymentsAggregation = await CustomerPayment.aggregate([
        { $match: { shift_id: shift._id } },
        { $group: { _id: null, totalPayments: { $sum: '$amount_applied_usd' } } },
      ]).session(session);

      const openingBalance = new Big(shift.opening_balance.toString());

      const totalContadoSales =
        salesAggregation.length > 0 && salesAggregation[0].totalSales != null
          ? new Big(salesAggregation[0].totalSales.toString())
          : new Big(0);

      const totalPayments =
        paymentsAggregation.length > 0 && paymentsAggregation[0].totalPayments != null
          ? new Big(paymentsAggregation[0].totalPayments.toString())
          : new Big(0);

      const totalSales = totalContadoSales.plus(totalPayments);
      const expectedBalance = openingBalance.plus(totalSales);

      shift.total_sales_amount = Types.Decimal128.fromString(totalSales.toFixed(2));
      shift.expected_balance = Types.Decimal128.fromString(expectedBalance.toFixed(2));

      if (closing_balance !== undefined && closing_balance !== null) {
        const closingBig = new Big(closing_balance);
        shift.closing_balance = Types.Decimal128.fromString(closingBig.toFixed(2));
      }

      await shift.save({ session });
      return shift;
    });

    if (!closedShift) {
      res.status(404).json({
        success: false,
        message: 'No se encontró un turno abierto para cerrar en esta sucursal.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Turno de caja cerrado exitosamente.',
      data: closedShift,
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

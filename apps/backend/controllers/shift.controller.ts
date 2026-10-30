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
    const {
      opening_balance,
      opening_balance_usd,
      opening_balance_ves,
    } = req.body;

    if (!branchId) {
      res.status(400).json({
        success: false,
        message: 'Header x-branch-id inválido o ausente.',
      });
      return;
    }

    const rawOpeningUSD =
      opening_balance_usd !== undefined ? opening_balance_usd : opening_balance;

    if (
      rawOpeningUSD === undefined ||
      rawOpeningUSD === null ||
      isNaN(Number(rawOpeningUSD)) ||
      Number(rawOpeningUSD) < 0
    ) {
      res.status(400).json({
        success: false,
        message:
          'opening_balance es requerido y debe ser un valor numérico no negativo.',
      });
      return;
    }

    if (
      opening_balance_ves !== undefined &&
      opening_balance_ves !== null &&
      (isNaN(Number(opening_balance_ves)) || Number(opening_balance_ves) < 0)
    ) {
      res.status(400).json({
        success: false,
        message:
          'opening_balance_ves debe ser un valor numérico no negativo.',
      });
      return;
    }

    // Formateo exacto usando Big.js antes de convertir a Decimal128
    const openingBigUSD = new Big(rawOpeningUSD);
    const openingBigVES = new Big(opening_balance_ves ?? '0.00');

    const newShift = await CashShift.create({
      branch_id: new Types.ObjectId(String(branchId)),
      cashier_id: new Types.ObjectId(String(userId)),
      opening_balance: Types.Decimal128.fromString(openingBigUSD.toFixed(2)),
      opening_balance_usd: Types.Decimal128.fromString(openingBigUSD.toFixed(2)),
      opening_balance_ves: Types.Decimal128.fromString(openingBigVES.toFixed(2)),
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
    const { closing_balance, closing_balance_usd, closing_balance_ves } = req.body;

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
        {
          $group: {
            _id: {
              currency: '$currency',
              payment_method: '$payment_method',
            },
            totalReceived: { $sum: '$amount_received' },
          },
        },
      ]).session(session);

      let paymentsUSD = new Big(0);
      let paymentsVES = new Big(0);

      let cashPaymentsUSD = new Big(0);
      let cashPaymentsVES = new Big(0);

      for (const payment of paymentsAggregation) {
        const received = new Big(
          payment.totalReceived?.toString() ?? '0'
        );

        const isPhysicalCash = ['Efectivo', 'Divisas'].includes(
          payment._id.payment_method
        );

        if (payment._id.currency === 'USD') {
          paymentsUSD = paymentsUSD.plus(received);

          if (isPhysicalCash) {
            cashPaymentsUSD = cashPaymentsUSD.plus(received);
          }
        } else if (payment._id.currency === 'VES') {
          paymentsVES = paymentsVES.plus(received);

          if (isPhysicalCash) {
            cashPaymentsVES = cashPaymentsVES.plus(received);
          }
        }
      }

      const openingBalanceUSD = shift.opening_balance_usd
        ? new Big(shift.opening_balance_usd.toString())
        : new Big(shift.opening_balance.toString());

      const openingBalanceVES = shift.opening_balance_ves
        ? new Big(shift.opening_balance_ves.toString())
        : new Big(0);

      const totalContadoSalesUSD =
        salesAggregation.length > 0 && salesAggregation[0].totalSales != null
          ? new Big(salesAggregation[0].totalSales.toString())
          : new Big(0);

      const totalSalesUSD = totalContadoSalesUSD.plus(paymentsUSD);

      // Los abonos electrónicos no aumentan el efectivo físico.
      const expectedBalanceUSD = openingBalanceUSD
        .plus(totalContadoSalesUSD)
        .plus(cashPaymentsUSD);

      const expectedBalanceVES = openingBalanceVES
        .plus(cashPaymentsVES);

      shift.total_sales_amount = Types.Decimal128.fromString(totalSalesUSD.toFixed(2));
      shift.expected_balance = Types.Decimal128.fromString(expectedBalanceUSD.toFixed(2));

      shift.total_sales_usd = Types.Decimal128.fromString(totalContadoSalesUSD.toFixed(2));
      shift.total_payments_usd = Types.Decimal128.fromString(paymentsUSD.toFixed(2));
      shift.expected_balance_usd = Types.Decimal128.fromString(expectedBalanceUSD.toFixed(2));

      shift.total_payments_ves = Types.Decimal128.fromString(paymentsVES.toFixed(2));
      shift.expected_balance_ves = Types.Decimal128.fromString(expectedBalanceVES.toFixed(2));

      const rawClosingUSD =
        closing_balance_usd !== undefined ? closing_balance_usd : closing_balance;

      if (rawClosingUSD !== undefined && rawClosingUSD !== null) {
        const closingBigUSD = new Big(rawClosingUSD);
        shift.closing_balance = Types.Decimal128.fromString(closingBigUSD.toFixed(2));
        shift.closing_balance_usd = Types.Decimal128.fromString(closingBigUSD.toFixed(2));
      }

      if (closing_balance_ves !== undefined && closing_balance_ves !== null) {
        const closingBigVES = new Big(closing_balance_ves);
        shift.closing_balance_ves = Types.Decimal128.fromString(closingBigVES.toFixed(2));
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

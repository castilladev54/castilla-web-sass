import mongoose from 'mongoose';
import { User } from './User.js';
import { Purchase } from './Purchase.js';
import { DecimalConfig } from '../utils/decimalConfig.ts';
import Big from 'big.js';

const purchaseDetailSchema = new mongoose.Schema({
  purchase_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase',
    required: true
  },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: DecimalConfig,
  unit_cost: DecimalConfig,
  invoice_number: {
    type: String,
    trim: true,
    default: null
  }
}, { 
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  id: false
});

// Middleware pre-save: Recálculo del costo promedio de inventario (av_inventory_cost).
//
// ⚠️  El $inc sobre Product.stock fue eliminado intencionalmente.
//     El campo stock global no existe en la arquitectura multi-sucursal.
//     El incremento de BranchInventory.stock ocurre en purchase.service.ts,
//     dentro de la misma transacción ACID, antes de que se llame a detail.save().
//
// Este hook conserva SOLO el recálculo del costo promedio ponderado por tenant.
purchaseDetailSchema.pre('save', async function () {
  try {
    const session = this.$session();

    // 1. Obtener la compra para localizar al Admin (tenant)
    const purchase = await Purchase.findById(this.purchase_id).session(session);
    if (!purchase) {
      throw new Error('Compra asociada no encontrada.');
    }

    // 2. Recálculo del av_inventory_cost SOLO para el admin actual.
    //    BUG FIX: el pipeline anterior no filtraba por admin_id → sumaba costos
    //    de TODOS los tenants del sistema, corrompiendo el costo promedio.
    const adminId = purchase.admin_id;
    const resultAggr = await mongoose.model('PurchaseDetail').aggregate([
      {
        $lookup: {
          from: 'purchases',
          localField: 'purchase_id',
          foreignField: '_id',
          as: 'purchase'
        }
      },
      { $unwind: '$purchase' },
      { $match: { 'purchase.admin_id': adminId } },
      {
        $group: {
          _id: null,
          totalCost:  { $sum: { $multiply: ['$quantity', '$unit_cost'] } },
          totalItems: { $sum: '$quantity' }
        }
      },
      {
        $project: {
          totalCost: { $toString: "$totalCost" },
          totalItems: { $toString: "$totalItems" }
        }
      }
    ]).session(session);

    let newAvgCost = '0';
    
    // Control estricto de vacíos usando strings
    const prevTotalCost = resultAggr.length > 0 ? resultAggr[0].totalCost : '0';
    const prevTotalItems = resultAggr.length > 0 ? resultAggr[0].totalItems : '0';

    if (resultAggr.length > 0 && Big(prevTotalItems).gt(0)) {
      // Incluir el item actual (aún no guardado) en el cálculo
      const currentItemCost = Big(this.quantity.toString()).times(Big(this.unit_cost.toString()));
      const currentCost = Big(prevTotalCost).plus(currentItemCost);
      const currentQty = Big(prevTotalItems).plus(Big(this.quantity.toString()));
      
      // newAvgCost = currentCost / currentQty (redondeado a 4 decimales)
      newAvgCost = currentCost.div(currentQty).toFixed(4, 1);
    } else {
      // Primer detalle del admin → su costo unitario es el promedio inicial
      newAvgCost = Big(this.unit_cost.toString()).toString();
    }

    // 3. Actualizar el costo promedio de inventario del admin
    await User.findByIdAndUpdate(
      adminId,
      { av_inventory_cost: newAvgCost }, // Asume que User.av_inventory_cost será DecimalConfig también
      { session }
    );
  } catch (error) {
    throw error;
  }
});

purchaseDetailSchema.index({ purchase_id: 1 });

export const PurchaseDetail = mongoose.model('PurchaseDetail', purchaseDetailSchema);

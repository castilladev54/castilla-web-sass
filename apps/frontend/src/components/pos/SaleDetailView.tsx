import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Printer } from "lucide-react";
import { fmtUSD, fmtBs } from "../../utils/salesFormatters";
import Button from "../atoms/Button";
import type { SaleDetailDTO, UserRole } from '@inventory/shared';
import Big from 'big.js';
import SaleReceiptModal from "./SaleReceiptModal";

interface SaleDetailViewProps {
  sale: SaleDetailDTO;
  onBack: () => void;
  userRole?: UserRole;
  onCancel: () => void;
  onEdit: () => void;
}

/**
 * SaleDetailView — Vista de detalle de una venta individual.
 * Muestra los metadatos de la venta y la tabla de artículos vendidos.
 */
const SaleDetailView = ({
  sale,
  onBack,
  userRole,
  onCancel,
  onEdit,
}: SaleDetailViewProps) => {
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  return (
    <>
      <motion.article
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mb-8 p-6 bg-[#1a1a24] border border-white/10 rounded-2xl shadow-xl"
      >
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-orange-500 hover:text-orange-400 shrink-0"
          >
            <ArrowLeft size={20} /> <span>Volver a Ventas</span>
          </Button>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <p className="text-sm text-gray-400 font-mono">ID: {sale._id}</p>

            {/* Botón de Impresión de Comprobante / Ticket */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPrintModalOpen(true)}
              className="flex items-center gap-1.5 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 font-semibold"
            >
              <Printer size={16} />
              <span>Imprimir</span>
            </Button>

            {userRole === "TENANT_OWNER" && sale.status !== "cancelled" && sale.status !== "Anulada" && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                >
                  Editar Venta
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={onCancel}
                  className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30"
                >
                  Anular Venta
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Tarjetas KPI de la venta */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {[
            { label: "Método de Pago", value: sale.payment_method, cls: "" },
            { label: "Fecha", value: new Date(sale.createdAt).toLocaleString('es-VE'), cls: "" },
            { label: "Atendido por", value: sale.sold_by?.name || "Propietario", cls: "" },
            {
              label: "Total USD",
              value: fmtUSD(sale.total_amount),
              cls: "text-amber-500 text-2xl font-bold bg-amber-500/10 border-amber-500/20",
            },
            {
              label: "Total Bs",
              value: fmtBs(sale.total_amount, sale.exchange_rate ?? '0'),
              cls: "text-blue-400 text-2xl font-bold bg-blue-500/10 border-blue-500/20",
            },
          ].map(({ label, value, cls }) => (
            <div key={label} className={`p-4 rounded-xl border border-white/5 bg-black/20 ${cls}`}>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
              <p className={`text-lg font-medium text-white ${cls}`}>{value}</p>
            </div>
          ))}
        </div>

      <h3 className="text-lg font-medium text-white mb-4">Artículos Vendidos</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-black/30 text-gray-400 text-sm uppercase tracking-wider">
              {["Producto", "Cantidad", "Precio USD", "Precio Bs", "Subtotal"].map((h) => (
                <th key={h} scope="col" className="px-6 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sale.items?.map((item, idx) => {
              const unit = item.product_id?.unit_type;
              
              // Cálculo estricto del subtotal usando Big.js
              const qtyBig = new Big(item.quantity?.toString() || '0');
              const priceBig = new Big(item.unit_price?.toString() || '0');
              const subtotalBig = qtyBig.times(priceBig);
              
              const qtyStr = qtyBig.toString();
              const priceStr = priceBig.toString();
              const subStr = subtotalBig.toString();

              const unitLabel =
                unit && unit !== "unidad"
                  ? unit
                  : qtyBig.eq(1)
                  ? "unidad"
                  : "unidades";
                  
              return (
                <tr key={idx} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-3 text-orange-400 font-medium">
                    {item.product_id?.name || "Desconocido"}
                  </td>
                  <td className="px-6 py-3 text-gray-300">
                    {qtyStr} {unitLabel}
                  </td>
                  <td className="px-6 py-3 text-gray-300">{fmtUSD(priceStr)}</td>
                  <td className="px-6 py-3 text-blue-400">{fmtBs(priceStr, sale.exchange_rate ?? '0')}</td>
                  <td className="px-6 py-3">
                    <div className="text-amber-500 font-medium">{fmtUSD(subStr)}</div>
                    <div className="text-xs text-blue-400">{fmtBs(subStr, sale.exchange_rate ?? '0')}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.article>

    {/* Modal de Impresión del Comprobante */}
    <SaleReceiptModal
      isOpen={isPrintModalOpen}
      onClose={() => setIsPrintModalOpen(false)}
      sale={sale}
    />
  </>
  );
};

export default SaleDetailView;

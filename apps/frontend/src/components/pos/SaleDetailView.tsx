import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Printer, User, MapPin, Phone, Mail, FileText, Building2 } from "lucide-react";
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
 * Muestra los metadatos de la venta, datos del cliente, sucursal y la tabla de artículos vendidos.
 */
const SaleDetailView = ({
  sale,
  onBack,
  userRole,
  onCancel,
  onEdit,
}: SaleDetailViewProps) => {
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const branch = typeof sale.branch_id === 'object' && sale.branch_id !== null ? sale.branch_id : null;
  const customer = sale.customer_id ?? null;

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

        {/* Sección de Datos del Cliente y Sucursal */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Card Cliente */}
          <div className="p-5 rounded-xl border border-white/10 bg-black/20">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5">
              <User size={16} className="text-orange-400" />
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Datos del Cliente
              </h4>
            </div>
            {customer ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-xs">Nombre:</span>
                  <span className="text-white font-semibold text-base">{customer.name}</span>
                </div>
                {customer.document_id && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Cédula / Documento:</span>
                    <span className="text-gray-200 font-mono">{customer.document_id}</span>
                  </div>
                )}
                {customer.phone && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Teléfono:</span>
                    <span className="text-gray-200">{customer.phone}</span>
                  </div>
                )}
                {customer.email && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Email:</span>
                    <span className="text-gray-200 truncate max-w-[220px]">{customer.email}</span>
                  </div>
                )}
                {customer.address && (
                  <div className="pt-1 border-t border-white/5">
                    <span className="text-gray-400 text-xs block mb-0.5">Dirección:</span>
                    <p className="text-orange-300 font-medium text-xs bg-orange-500/10 p-2 rounded-lg border border-orange-500/20">
                      {customer.address}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm italic py-2">
                Consumidor Final (Venta sin cliente registrado)
              </p>
            )}
          </div>

          {/* Card Sucursal y Negocio */}
          <div className="p-5 rounded-xl border border-white/10 bg-black/20">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5">
              <Building2 size={16} className="text-blue-400" />
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Sucursal & Negocio
              </h4>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs">Sucursal:</span>
                <span className="text-white font-semibold text-base">
                  {branch?.name || "Sucursal Actual"}
                </span>
              </div>
              {branch?.address && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-gray-400 text-xs shrink-0">Dirección Sucursal:</span>
                  <span className="text-gray-300 text-right text-xs">{branch.address}</span>
                </div>
              )}
              {branch?.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-xs">Teléfono Sucursal:</span>
                  <span className="text-gray-300">{branch.phone}</span>
                </div>
              )}
              {sale.business_owner_id?.name && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-xs">Negocio:</span>
                  <span className="text-gray-300">{sale.business_owner_id.name}</span>
                </div>
              )}
              {sale.exchange_rate && (
                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <span className="text-gray-400 text-xs">Tasa aplicada:</span>
                  <span className="text-blue-400 font-bold font-mono">1 USD = Bs. {sale.exchange_rate}</span>
                </div>
              )}
            </div>
          </div>
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

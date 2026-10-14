import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Printer, X, Building2, MapPin, Phone, Mail, User, FileText, Calendar, CreditCard } from 'lucide-react';
import Button from '../atoms/Button';
import type { SaleDetailDTO } from '@inventory/shared';
import { fmtUSD, fmtBs } from '../../utils/salesFormatters';
import Big from 'big.js';

interface SaleReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: SaleDetailDTO | null;
  businessName?: string;
}

export default function SaleReceiptModal({
  isOpen,
  onClose,
  sale,
  businessName,
}: SaleReceiptModalProps) {
  const receiptRef = useRef<HTMLDivElement | null>(null);

  const handlePrint = () => {
    const ticketElement = receiptRef.current;
    if (!ticketElement) return;

    // Crear un iframe invisible para aislar la impresión y evitar pantallas en blanco
    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'style',
      'position: fixed; right: 0; bottom: 0; width: 0; height: 0; border: 0; visibility: hidden;'
    );
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    // Copiar estilos de la aplicación (Tailwind, fuentes, etc.)
    const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((tag) => tag.outerHTML)
      .join('\n');

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>Comprobante_${sale?._id ? sale._id.slice(-8).toUpperCase() : 'Venta'}</title>
          ${styleTags}
          <style>
            @page {
              margin: 3mm;
              size: 80mm auto;
            }
            *, *::before, *::after {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background-color: #ffffff !important;
              color: #000000 !important;
              width: 100% !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, monospace;
            }
            .ticket-print-wrapper {
              width: 100%;
              max-width: 80mm;
              margin: 0 auto;
              padding: 4mm;
              background: #ffffff;
              color: #000000;
              font-size: 11px;
              line-height: 1.35;
            }
            /* Fallbacks de layout para garantizar renderizado perfecto */
            .flex { display: flex !important; }
            .flex-col { flex-direction: column !important; }
            .justify-between { justify-content: space-between !important; }
            .items-center { align-items: center !important; }
            .items-baseline { align-items: baseline !important; }
            .text-center { text-align: center !important; }
            .text-right { text-align: right !important; }
            .font-bold { font-weight: 700 !important; }
            .font-black { font-weight: 900 !important; }
            table { width: 100% !important; border-collapse: collapse !important; }
            th, td { padding: 3px 2px !important; }
            .border-b-dashed { border-bottom: 1px dashed #555 !important; }
            .border-t-dashed { border-top: 1px dashed #555 !important; }
            .border-dashed { border-style: dashed !important; }
          </style>
        </head>
        <body>
          <div class="ticket-print-wrapper">
            ${ticketElement.innerHTML}
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Permitir parseo y renderizado de estilos antes de abrir el diálogo de impresión
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('Error al imprimir comprobante:', err);
      } finally {
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 1500);
      }
    }, 250);
  };

  // Atajo de teclado: Ctrl+P o Cmd+P imprime directamente el ticket cuando el modal está abierto
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, sale]);

  if (!isOpen || !sale) return null;

  const exchangeRate = sale.exchange_rate ?? '0';
  const branch = typeof sale.branch_id === 'object' && sale.branch_id !== null ? sale.branch_id : null;
  const customer = sale.customer_id ?? null;
  const ownerName = sale.business_owner_id?.name || businessName || "CastillaWeb";
  const branchName = branch?.name || "Sucursal Actual";
  const branchAddress = branch?.address || "";
  const branchPhone = branch?.phone || "";
  const sellerName = sale.sold_by?.name || "Propietario / Vendedor";
  const formattedDate = new Date(sale.createdAt).toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const isPending = sale.status === 'pending';
  const isCancelled = sale.status === 'cancelled' || sale.status === 'Anulada';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-black/80 backdrop-blur-sm print:p-0 print:bg-white print:static print:inset-auto">
        {/* Backdrop for closing */}
        <div className="fixed inset-0 print:hidden" onClick={onClose} aria-hidden="true" />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative z-10 w-full max-w-lg bg-[#1a1a24] border border-white/10 rounded-2xl shadow-2xl overflow-hidden print:border-none print:shadow-none print:w-full print:max-w-none print:bg-white print:p-0"
        >
          {/* Header toolbar (Hidden during print) */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-black/40 print:hidden">
            <div className="flex items-center gap-2">
              <Printer className="text-orange-400" size={20} />
              <h2 className="text-base font-bold text-white">Comprobante de Venta</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar modal"
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Ticket preview container */}
          <div className="p-4 sm:p-6 max-h-[80vh] overflow-y-auto print:max-h-none print:overflow-visible print:p-0">
            {/* Printable Receipt Paper */}
            <div
              id="printable-sale-ticket"
              ref={receiptRef}
              className="bg-white text-gray-900 p-6 rounded-xl font-mono text-xs shadow-md border border-gray-200 print:shadow-none print:border-none print:p-2 print:text-black print:rounded-none"
            >
              {/* Encabezado del Negocio */}
              <div className="text-center pb-3 border-b-2 border-dashed border-gray-300">
                <h1 className="text-base sm:text-lg font-black uppercase tracking-tight text-gray-950 font-sans">
                  {ownerName}
                </h1>
                {sale.business_owner_id?.email && (
                  <p className="text-[11px] text-gray-600 mt-0.5">{sale.business_owner_id.email}</p>
                )}
                <div className="mt-1.5 text-[11px] text-gray-700 space-y-0.5">
                  <p className="font-bold text-gray-800">Sucursal: {branchName}</p>
                  {branchAddress && <p>{branchAddress}</p>}
                  {branchPhone && <p>Tel: {branchPhone}</p>}
                </div>
              </div>

              {/* Metadatos de la Venta */}
              <div className="py-2.5 border-b border-dashed border-gray-300 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-gray-600 font-sans">Comprobante N°:</span>
                  <span className="font-bold">{sale._id.slice(-8).toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 font-sans">Fecha y Hora:</span>
                  <span>{formattedDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 font-sans">Vendedor:</span>
                  <span className="font-semibold">{sellerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 font-sans">Método Pago:</span>
                  <span>{sale.payment_method}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-sans">Estado:</span>
                  <span
                    className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                      isCancelled
                        ? 'bg-red-100 text-red-800'
                        : isPending
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {isCancelled ? 'ANULADA' : isPending ? 'PENDIENTE (CRÉDITO)' : 'COMPLETADA'}
                  </span>
                </div>
              </div>

              {/* Datos del Cliente */}
              <div className="py-2.5 border-b border-dashed border-gray-300 space-y-1 text-[11px]">
                <p className="font-bold uppercase tracking-wider text-gray-500 text-[10px] font-sans mb-1">
                  Datos del Cliente
                </p>
                <div className="flex justify-between">
                  <span className="text-gray-600 font-sans">Nombre:</span>
                  <span className="font-bold">{customer?.name || "Consumidor Final"}</span>
                </div>
                {customer?.document_id && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 font-sans">Cédula / RIF:</span>
                    <span>{customer.document_id}</span>
                  </div>
                )}
                {customer?.phone && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 font-sans">Teléfono:</span>
                    <span>{customer.phone}</span>
                  </div>
                )}
                {customer?.email && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 font-sans">Email:</span>
                    <span className="max-w-[200px] truncate">{customer.email}</span>
                  </div>
                )}
                {customer?.address && (
                  <div className="flex flex-col pt-0.5">
                    <span className="text-gray-600 font-sans">Dirección:</span>
                    <span className="text-[11px] font-medium text-gray-800">{customer.address}</span>
                  </div>
                )}
              </div>

              {/* Tabla de Artículos */}
              <div className="py-2.5 border-b-2 border-dashed border-gray-300">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-300 text-gray-600 uppercase font-sans text-[10px]">
                      <th scope="col" className="pb-1">Cant</th>
                      <th scope="col" className="pb-1">Producto</th>
                      <th scope="col" className="pb-1 text-right">P. Unit</th>
                      <th scope="col" className="pb-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sale.items?.map((item, idx) => {
                      const qtyBig = new Big(item.quantity?.toString() || '0');
                      const priceBig = new Big(item.unit_price?.toString() || '0');
                      const subtotalBig = qtyBig.times(priceBig);
                      const unit = item.product_id?.unit_type || 'unidad';
                      const unitLabel = unit !== 'unidad' ? unit : qtyBig.eq(1) ? 'ud' : 'uds';

                      return (
                        <tr key={idx} className="align-top">
                          <td className="py-1 pr-1 font-semibold text-gray-700 whitespace-nowrap">
                            {qtyBig.toString()} {unitLabel}
                          </td>
                          <td className="py-1 px-1 font-medium text-gray-900">
                            {item.product_id?.name || "Artículo"}
                          </td>
                          <td className="py-1 px-1 text-right whitespace-nowrap text-gray-600">
                            <div>{fmtUSD(priceBig.toString())}</div>
                            <div className="text-[9px] text-gray-500">
                              {fmtBs(priceBig.toString(), exchangeRate)}
                            </div>
                          </td>
                          <td className="py-1 pl-1 text-right whitespace-nowrap font-bold text-gray-950">
                            <div>{fmtUSD(subtotalBig.toString())}</div>
                            <div className="text-[9px] text-gray-600 font-normal">
                              {fmtBs(subtotalBig.toString(), exchangeRate)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totales y Tasa de Cambio */}
              <div className="pt-3 pb-2 space-y-1.5 text-xs">
                {Number(exchangeRate) > 0 && (
                  <div className="flex justify-between text-[11px] text-gray-600 font-sans">
                    <span>Tasa de Cambio Oficial:</span>
                    <span>1 USD = Bs. {exchangeRate}</span>
                  </div>
                )}
                <div className="flex justify-between items-baseline pt-1">
                  <span className="font-bold text-gray-800 text-sm font-sans">TOTAL USD:</span>
                  <span className="text-base font-black text-gray-950">{fmtUSD(sale.total_amount)}</span>
                </div>
                <div className="flex justify-between items-baseline border-t border-gray-200 pt-1">
                  <span className="font-bold text-blue-700 text-sm font-sans">TOTAL BS:</span>
                  <span className="text-base font-black text-blue-700">
                    {fmtBs(sale.total_amount, exchangeRate)}
                  </span>
                </div>
              </div>

              {/* Pie del Ticket */}
              <div className="pt-4 mt-2 border-t border-dashed border-gray-300 text-center text-[10px] text-gray-500 space-y-1 font-sans">
                <p className="font-bold text-gray-700">¡GRACIAS POR SU PREFERENCIA!</p>
                <p>Comprobante de Entrega y Control Interno</p>
                <p className="text-[9px] text-gray-400">ID Completo: {sale._id}</p>
              </div>
            </div>
          </div>

          {/* Modal Footer (Hidden during print) */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-white/10 bg-black/30 print:hidden">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-400 hover:text-white">
              Cerrar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-black font-semibold"
            >
              <Printer size={16} /> Imprimir Comprobante
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

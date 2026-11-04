import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Printer, X, FileText, Calendar, Building2, Layers, Loader2, Tag } from 'lucide-react';
import Button from './atoms/Button';
import Badge from './atoms/Badge';
import { usePrintProductsQuery } from '../hooks/queries/useProductQueries';
import { useBranchesQuery } from '../hooks/queries/useBranchQueries';
import { useAuthStore } from '../store/authStore';
import { toBs } from '../utils/currency';

interface ProductListPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchTerm?: string;
  showDebtOnly?: boolean;
  exchangeRate: string;
}

export default function ProductListPrintModal({
  isOpen,
  onClose,
  searchTerm = '',
  showDebtOnly = false,
  exchangeRate,
}: ProductListPrintModalProps) {
  const printSheetRef = useRef<HTMLElement | null>(null);

  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const user = useAuthStore((s) => s.user);

  const { data: branches = [] } = useBranchesQuery();
  const activeBranch = branches.find((b) => b._id === activeBranchId);

  const {
    data: products = [],
    isLoading,
    isError,
  } = usePrintProductsQuery(searchTerm, showDebtOnly, isOpen);

  const branchName = activeBranch?.name || user?.businessName || user?.name || 'Inventario Principal';
  const branchAddress = activeBranch?.address || '';
  const now = new Date();
  const formattedDate = now.toLocaleDateString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const formattedTime = now.toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handlePrint = () => {
    const sheetElement = printSheetRef.current;
    if (!sheetElement) return;

    // Crear iframe aislado para imprimir limpiamente sin fondos oscuros ni controles
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

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>Lista_Productos_${branchName.replace(/\s+/g, '_')}_${now.toISOString().slice(0, 10)}</title>
          <style>
            @page {
              margin: 10mm;
              size: portrait;
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
              color: #111827 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              font-size: 11px;
              line-height: 1.35;
            }
            .print-document {
              width: 100%;
              max-width: 100%;
              margin: 0 auto;
              background: #ffffff;
            }
            .header-box {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #111827;
              padding-bottom: 12px;
              margin-bottom: 14px;
            }
            .company-title {
              font-size: 18px;
              font-weight: 800;
              text-transform: uppercase;
              color: #111827;
              margin: 0 0 2px 0;
            }
            .report-subtitle {
              font-size: 12px;
              font-weight: 700;
              color: #ea580c;
              text-transform: uppercase;
              margin: 2px 0 0 0;
            }
            .meta-text {
              font-size: 10.5px;
              color: #4b5563;
              margin: 2px 0;
            }
            .meta-strong {
              font-size: 11px;
              font-weight: 700;
              color: #111827;
            }
            table {
              width: 100% !important;
              border-collapse: collapse !important;
              margin-top: 6px;
            }
            thead {
              display: table-header-group;
            }
            tr {
              page-break-inside: avoid;
            }
            th {
              background-color: #f3f4f6 !important;
              color: #111827 !important;
              font-weight: 700 !important;
              border-top: 1px solid #9ca3af !important;
              border-bottom: 1.5px solid #111827 !important;
              padding: 5px 6px !important;
              font-size: 10px !important;
              text-transform: uppercase;
              letter-spacing: 0.03em;
            }
            td {
              padding: 5px 6px !important;
              border-bottom: 1px solid #e5e7eb !important;
              font-size: 10.5px !important;
              color: #1f2937 !important;
            }
            tbody tr:nth-child(even) {
              background-color: #f9fafb !important;
            }
            .text-left { text-align: left !important; }
            .text-center { text-align: center !important; }
            .text-right { text-align: right !important; }
            .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; }
            .font-bold { font-weight: 700 !important; }
            .price-usd { color: #111827 !important; font-weight: 700 !important; }
            .price-bs { color: #2563eb !important; font-weight: 600 !important; }
            .footer-box {
              margin-top: 16px;
              padding-top: 8px;
              border-top: 1px solid #9ca3af;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 9.5px;
              color: #6b7280;
            }
          </style>
        </head>
        <body>
          <div class="print-document">
            ${sheetElement.innerHTML}
          </div>
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('Error al invocar impresión:', err);
      } finally {
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 1500);
      }
    }, 250);
  };

  // Atajo de teclado: Ctrl+P o Cmd+P imprime directamente cuando el modal está abierto
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, products, exchangeRate]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-4xl bg-[#14141c] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        >
          {/* Header del modal */}
          <header className="p-4 sm:p-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 bg-black/40">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
                <Printer size={20} aria-hidden="true" />
              </div>
              <div>
                <h2 id="print-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
                  Impresión de Lista de Productos
                </h2>
                <p className="text-xs text-gray-400">
                  Formato de catálogo listo para impresión en hoja o exportación PDF.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar modal"
              className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition"
            >
              <X size={20} />
            </button>
          </header>

          {/* Barra de opciones y badges */}
          <section
            aria-label="Resumen de datos para impresión"
            className="px-4 py-3 bg-[#1a1a24] border-b border-white/5 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 text-gray-300 border border-white/10">
                <Layers size={13} className="text-orange-400" />
                <strong>{products.length}</strong> {products.length === 1 ? 'producto' : 'productos'}
              </span>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                Tasa: <strong>Bs. {exchangeRate}</strong>
              </span>

              {searchTerm && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Filtro: "{searchTerm}"
                </span>
              )}

              {showDebtOnly && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/10 text-red-300 border border-red-500/20">
                  🚨 Deuda Operativa
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-gray-300 border-white/10 hover:text-white"
              >
                Cerrar
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handlePrint}
                disabled={isLoading || products.length === 0}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-black font-semibold"
              >
                <Printer size={16} />
                <span>Imprimir Lista (Ctrl+P)</span>
              </Button>
            </div>
          </section>

          {/* Contenedor de Vista Previa */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-black/50">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
                <Loader2 className="animate-spin text-orange-500" size={36} />
                <p className="text-sm">Cargando catálogo para impresión…</p>
              </div>
            ) : isError ? (
              <div role="alert" className="p-4 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl text-sm">
                No se pudieron cargar los productos para impresión. Por favor, reintenta.
              </div>
            ) : products.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <FileText size={40} className="mx-auto mb-3 opacity-30 text-orange-400" />
                <p className="text-base font-medium text-white">No hay productos para imprimir</p>
                <p className="text-xs text-gray-400 mt-1">
                  Asegúrate de tener productos registrados o ajusta los filtros de búsqueda.
                </p>
              </div>
            ) : (
              /* Hoja de impresión previsualizada */
              <div className="max-w-3xl mx-auto bg-white text-gray-900 rounded-lg shadow-2xl p-6 sm:p-8 border border-gray-200">
                <article ref={printSheetRef} className="print-document">
                  {/* Cabecera del Documento Imprimible */}
                  <header className="header-box flex justify-between items-start border-b-2 border-gray-900 pb-3 mb-4">
                    <div>
                      <h1 className="company-title text-lg sm:text-xl font-bold uppercase text-gray-900">
                        {branchName}
                      </h1>
                      {branchAddress && (
                        <p className="meta-text text-xs text-gray-600">{branchAddress}</p>
                      )}
                      <h2 className="report-subtitle text-xs sm:text-sm font-bold uppercase text-orange-600 mt-1">
                        Catálogo de Inventario y Lista de Precios
                      </h2>
                    </div>

                    <div className="text-right">
                      <p className="meta-text text-xs text-gray-600 font-mono">
                        Fecha: <strong>{formattedDate}</strong> {formattedTime}
                      </p>
                      <p className="meta-strong text-xs font-semibold text-gray-900 mt-0.5">
                        Tasa: 1 USD = Bs. {exchangeRate}
                      </p>
                      <p className="meta-text text-[11px] text-gray-500">
                        Total ítems: <strong>{products.length}</strong>
                      </p>
                    </div>
                  </header>

                  {/* Tabla Principal de Productos */}
                  <main className="w-full">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-100 border-t border-b border-gray-300">
                          <th className="py-2 px-2 text-left w-7">#</th>
                          <th className="py-2 px-2 text-left">Código / Barras</th>
                          <th className="py-2 px-2 text-left">Producto</th>
                          <th className="py-2 px-2 text-left">Categoría</th>
                          <th className="py-2 px-2 text-center">Stock</th>
                          <th className="py-2 px-2 text-right">Precio ($)</th>
                          <th className="py-2 px-2 text-right">Precio (Bs)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((prod, idx) => {
                          const categoryName =
                            typeof prod.category === 'object' && prod.category
                              ? prod.category.name
                              : 'Sin Categoría';
                          const numericStock = Number(prod.totalStock ?? 0);
                          const unitLabel =
                            prod.unit_type && prod.unit_type !== 'unidad' ? prod.unit_type : '';
                          const priceUsd = Number(prod.price).toFixed(2);
                          const priceBs = toBs(String(prod.price), exchangeRate);

                          return (
                            <tr key={prod._id} className="border-b border-gray-200">
                              <td className="py-1.5 px-2 text-gray-500 font-mono text-[10px]">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-2 font-mono text-[10.5px] text-gray-700">
                                {prod.barcode || prod._id?.slice(-6) || '-'}
                              </td>
                              <td className="py-1.5 px-2 font-medium text-gray-900">
                                {prod.name}
                              </td>
                              <td className="py-1.5 px-2 text-gray-600 text-[10.5px]">
                                {categoryName}
                              </td>
                              <td className="py-1.5 px-2 text-center font-semibold text-gray-800">
                                {numericStock} {unitLabel}
                              </td>
                              <td className="py-1.5 px-2 text-right font-bold text-gray-900">
                                ${priceUsd}
                              </td>
                              <td className="py-1.5 px-2 text-right font-semibold text-blue-700">
                                Bs. {priceBs}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </main>

                  {/* Pie del Documento Imprimible */}
                  <footer className="footer-box mt-5 pt-3 border-t border-gray-300 flex justify-between items-center text-[10px] text-gray-500">
                    <p>
                      Documento oficial de control de inventario y consulta de precios. Precios en Bolívares calculados según la tasa del día.
                    </p>
                    <p className="font-mono">
                      Emisión: {formattedDate}
                    </p>
                  </footer>
                </article>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}


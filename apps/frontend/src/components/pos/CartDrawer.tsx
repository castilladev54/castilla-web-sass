import { AnimatePresence, motion } from 'framer-motion';
import { Check, ShoppingCart, Trash2, X } from 'lucide-react';
import Big from 'big.js';
import { fmtUSD, fmtBs, itemSubtotal } from '../../utils/salesFormatters';
import Button from '../atoms/Button';
import InputText from '../atoms/InputText';
import KBD from '../atoms/KBD';
import type { FormEvent, RefObject } from 'react';

import type { POSCartItem } from '../../hooks/usePOSCart';
import type { Customer, CustomerPayload } from '../../hooks/queries/useCustomerQueries';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: POSCartItem[];
  onQtyChange: (index: number, val: string) => void;
  onRemove: (index: number) => void;
  onSubmit: (e: FormEvent) => void;
  paymentMethod: string;
  onPaymentChange: (val: string) => void;
  isLoading: boolean;
  currentTotal: number;
  exchangeRate: string;
  submitBtnRef?: RefObject<HTMLButtonElement | null>;
  paymentSelectRef?: RefObject<HTMLSelectElement | null>;
  customers: Customer[];
  selectedCustomerId: string | null;
  onCustomerChange: (customerId: string) => void;
  onCreateCustomer?: (payload: CustomerPayload) => Promise<void>;
  isCreatingCustomer?: boolean;
  isCustomersLoading: boolean;
  isCustomersError: boolean;
  saleStatus: 'completed' | 'pending';
  onStatusChange: (status: 'completed' | 'pending') => void;
}

/**
 * CartDrawer — Panel deslizante superior del carrito de compras.
 * Muestra los ítems, permite editar cantidades, elegir método de pago
 * y confirmar la venta.
 */
const CartDrawer = ({
  isOpen,
  onClose,
  items,
  onQtyChange,
  onRemove,
  onSubmit,
  paymentMethod,
  onPaymentChange,
  isLoading,
  currentTotal,
  exchangeRate,
  submitBtnRef,
  paymentSelectRef,
  customers,
  selectedCustomerId,
  onCustomerChange,
  onCreateCustomer,
  isCreatingCustomer,
  isCustomersLoading,
  isCustomersError,
  saleStatus,
  onStatusChange,
}: CartDrawerProps) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          key="cart-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          key="cart-sheet"
          initial={{ y: '-100%' }}
          animate={{ y: 0 }}
          exit={{ y: '-100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute top-0 left-0 right-0 z-40 bg-[#1a1a24] border-b border-orange-500/30 shadow-2xl shadow-orange-500/10 rounded-b-3xl flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-black/20">
            <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <ShoppingCart className="text-orange-500" aria-hidden="true" /> Detalle de Compra
            </h3>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Cerrar carrito"
              className="p-2 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition"
            >
              <X size={20} />
            </button>
          </div>

          {/* Items */}
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-[30vh]">
            {items.length === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center text-gray-500">
                <ShoppingCart size={48} className="mb-4 opacity-30" aria-hidden="true" />
                <p className="text-lg text-center">No has agregado productos</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {items.map((item, index) => (
                  <li
                    key={index}
                    className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-black/30 p-3 sm:p-4 rounded-xl border border-white/5"
                  >
                    <div className="flex-1 mb-3 sm:mb-0">
                      <h5 className="text-white font-medium text-sm sm:text-base line-clamp-1">
                        {item.name}
                        {(item.unit_type ?? "unidad") !== "unidad" ? ` (${item.unit_type})` : ''}
                      </h5>
                      <div className="flex gap-4 items-center mt-1">
                        <span className="text-orange-500 font-bold">{fmtUSD(item.unit_price)}</span>
                        <span className="text-blue-400 text-xs sm:text-sm font-medium">{fmtBs(item.unit_price, exchangeRate)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                      <div className={`flex items-center gap-2 rounded-xl border p-1 transition-colors ${
                        (() => {
                          try {
                            const maxStock = new Big(item.maxStock || "0");
                            const qty = new Big(item.quantity || "0");
                            return maxStock.lt(qty);
                          } catch {
                            return false;
                          }
                        })()
                          ? 'bg-red-500/10 border-red-500/50'
                          : 'bg-[#1a1a24] border-white/10'
                      }`}>
                        <InputText
                          type="number"
                          min={item.unit_type === "unidad" ? "1" : "0.01"}
                          step={item.unit_type === "unidad" ? "1" : "0.01"}
                          value={item.quantity}
                          onChange={(e) => onQtyChange(index, e.target.value)}
                          aria-label={`Cantidad de ${item.name}`}
                          className={`w-16 sm:w-20 text-center text-base sm:text-lg font-bold bg-transparent border-none h-10 p-0 focus:ring-0 ${
                            (() => {
                              try {
                                return new Big(item.maxStock || "0").lt(new Big(item.quantity || "0"));
                              } catch {
                                return false;
                              }
                            })() ? 'text-red-400' : ''
                          }`}
                        />
                      </div>
                      <div className="text-right w-20 sm:w-24 ml-auto">
                        <span className="text-amber-500 font-bold text-base sm:text-lg">
                          {fmtUSD(itemSubtotal({ ...item, unit_type: item.unit_type ?? "unidad" }))}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => onRemove(index)}
                        aria-label={`Quitar ${item.name}`}
                        className="text-red-400 hover:bg-red-500/20 hover:text-red-300 !p-2 sm:!p-3 rounded-xl ml-2"
                      >
                        <Trash2 size={20} />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer / Cobro */}
          <form onSubmit={onSubmit} className="p-4 sm:p-6 bg-black/40 border-t border-white/5 rounded-b-3xl shrink-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 items-end">
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="sale-customer"
                    className="block text-xs sm:text-sm font-medium text-gray-300 mb-2"
                  >
                    Cliente
                  </label>

                  <select
                    id="sale-customer"
                    value={selectedCustomerId ?? ''}
                    onChange={(event) => onCustomerChange(event.target.value)}
                    disabled={isCustomersLoading || isLoading}
                    className="w-full bg-[#1a1a24] border border-white/10 rounded-xl px-4 py-3 text-white"
                  >
                    <option value="">Venta sin cliente</option>
                    {customers.map((customer) => (
                      <option key={customer._id} value={customer._id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>

                  {isCustomersError && (
                    <p role="status" className="mt-2 text-sm text-amber-400">
                      No se pudieron cargar los clientes. Puedes registrar una venta sin cliente.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="sale-status"
                    className="block text-xs sm:text-sm font-medium text-gray-300 mb-2"
                  >
                    Estado de Venta
                  </label>

                  <select
                    id="sale-status"
                    value={saleStatus}
                    onChange={(event) => onStatusChange(event.target.value as 'completed' | 'pending')}
                    disabled={isLoading}
                    className="w-full bg-[#1a1a24] border border-white/10 rounded-xl px-4 py-3 text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition text-sm sm:text-base font-medium appearance-none"
                  >
                    <option value="completed">Al contado (Completada)</option>
                    <option value="pending">A crédito (Pendiente)</option>
                  </select>

                  {saleStatus === 'pending' && !selectedCustomerId && (
                    <p role="status" className="mt-2 text-xs text-amber-400">
                      ⚠️ Selecciona un cliente arriba para registrar la venta a crédito.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="payment-method" className="block text-xs sm:text-sm font-medium text-gray-300 mb-2">
                    Método de Pago <KBD>F5</KBD>
                  </label>
                  <select
                    id="payment-method"
                    ref={paymentSelectRef}
                    value={paymentMethod}
                    onChange={(e) => onPaymentChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitBtnRef?.current?.focus();
                      }
                    }}
                    required
                    className="w-full bg-[#1a1a24] border border-white/10 rounded-xl px-4 py-3 text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition text-sm sm:text-base font-medium appearance-none"
                  >
                    <option value="Efectivo">Efectivo</option>
                    <option value="Divisas">Divisas</option>
                    <option value="Tarjeta">Tarjeta</option>
                    <option value="Pago Movil">Pago Móvil</option>
                    <option value="Transferencia">Transferencia</option>
                    <option value="Zelle">Zelle</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:gap-3">
                <div className="flex justify-between items-center text-lg sm:text-xl font-bold text-gray-300">
                  <span className="text-sm sm:text-base">Total Bs</span>
                  <span className="text-blue-400">{fmtBs(currentTotal, exchangeRate)}</span>
                </div>
                <div className="flex justify-between items-center text-xl sm:text-2xl font-bold text-white bg-orange-500/10 p-3 rounded-xl border border-orange-500/20">
                  <span className="text-base sm:text-lg text-orange-400">Total a Pagar</span>
                  <span className="text-orange-500">{fmtUSD(currentTotal)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 sm:mt-6">
              <Button
                ref={submitBtnRef}
                variant="primary"
                type="submit"
                disabled={isLoading || items.length === 0}
                className="w-full py-4 text-base sm:text-lg rounded-xl shadow-[0_0_20px_rgba(249,115,22,0.3)]"
              >
                {isLoading ? (
                  'Procesando...'
                ) : (
                  <>
                    <Check size={24} className="mr-2" />
                    {saleStatus === 'pending' ? 'Registrar Venta a Crédito' : 'Procesar Pago'} <KBD>F9</KBD>
                  </>
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default CartDrawer;

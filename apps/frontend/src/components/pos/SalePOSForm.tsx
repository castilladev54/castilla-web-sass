import { motion } from "framer-motion";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { fmtUSD } from "../../utils/salesFormatters";
import Button from "../atoms/Button";
import KBD from "../atoms/KBD";
import ProductCard from "./ProductCard";
import type { Product } from "@inventory/shared";
import CartDrawer from "./CartDrawer";
import type { POSCartItem } from "../../hooks/usePOSCart";
import ProductSearchBar from "../molecules/ProductSearchBar";
import type { FormEvent, RefObject } from "react";
import type { Customer, CustomerPayload } from "../../hooks/queries/useCustomerQueries";


interface SalePOSFormProps {
  items: POSCartItem[];
  onCancel: () => void;
  onAddItem: (product: Product, qty: string | number | undefined, getBranchStock: (p: Product) => string) => void;
  onRemoveItem: (index: number) => void;
  onQtyChange: (index: number, val: string) => void;
  onSubmit: (e: FormEvent) => void;
  paymentMethod: string;
  onPaymentChange: (val: string) => void;
  isLoading: boolean;
  currentTotal: number;
  filteredProducts: Product[];
  searchTerm: string;
  onSearch: (val: string) => void;
  onOpenScanner: () => void;
  cartPulse: boolean;
  submitBtnRef: RefObject<HTMLButtonElement | null>;
  paymentSelectRef: RefObject<HTMLSelectElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  hasOpenShift: boolean; // 🚨 GUARDRAIL de Turno de Caja
  onOpenCashShift: () => void; // Acción para abrir caja
  exchangeRate: string;
  getBranchStock: (product: Product) => string;
  customers: Customer[];
  selectedCustomerId: string | null;
  onCustomerChange: (customerId: string) => void;
  onCreateCustomer: (payload: CustomerPayload) => Promise<void>;
  isCreatingCustomer: boolean;
  isCustomersLoading: boolean;
  isCustomersError: boolean;
  saleStatus: 'completed' | 'pending';
  onStatusChange: (status: 'completed' | 'pending') => void;
}

/**
 * SalePOSForm — Pantalla completa del Punto de Venta.
 * Muestra el catálogo de productos con búsqueda local + el carrito lateral.
 * Los datos de productos ya vienen filtrados desde el componente padre.
 */
const SalePOSForm = ({
  items,
  onCancel,
  onAddItem,
  onRemoveItem,
  onQtyChange,
  onSubmit,
  paymentMethod,
  onPaymentChange,
  isLoading,
  currentTotal,
  filteredProducts,
  searchTerm,
  onSearch,
  onOpenScanner,
  cartPulse,
  submitBtnRef,
  paymentSelectRef,
  searchInputRef,
  isCartOpen,
  setIsCartOpen,
  hasOpenShift,
  onOpenCashShift,
  exchangeRate,
  getBranchStock,
  customers,
  selectedCustomerId,
  onCustomerChange,
  onCreateCustomer,
  isCreatingCustomer,
  isCustomersLoading,
  isCustomersError,
  saleStatus,
  onStatusChange,
}: SalePOSFormProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-[#0f0f13] flex flex-col font-sans overflow-hidden"
    >
      {/* Top bar */}
      <div
        className="bg-[#1a1a24] border-b border-orange-500/20 p-3 sm:p-4 shadow-[0_4px_30px_rgba(0,0,0,0.5)] flex justify-between items-center cursor-pointer hover:bg-[#22222f] transition z-20"
        onClick={() => {
          if (hasOpenShift) setIsCartOpen(true);
        }}
      >
        <div className="flex items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="!p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition"
          >
            <ArrowLeft size={24} />
          </Button>
          <div className="flex flex-col">
            <span className="text-xs sm:text-sm text-gray-400 font-medium">Total de Venta</span>
            <motion.div
              animate={
                cartPulse
                  ? { scale: [1, 1.1, 1], color: ["#f59e0b", "#fbbf24", "#f59e0b"] }
                  : {}
              }
              transition={{ duration: 0.3 }}
              className="text-xl sm:text-3xl font-bold text-amber-500 tracking-tight leading-none"
            >
              {fmtUSD(currentTotal)}
            </motion.div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          <div className="text-right flex flex-col items-end">
            <span className="text-xs sm:text-sm text-gray-400 font-medium hidden sm:block">
              Artículos
            </span>
            <div className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-3 py-1 rounded-full text-sm sm:text-lg font-bold flex items-center gap-2">
              <ShoppingCart size={16} aria-hidden="true" />
              {items.length}
            </div>
          </div>

          {/* GUARDRAIL: Si no hay turno abierto, deshabilita y pide abrir caja */}
          {hasOpenShift ? (
            <Button
              variant="primary"
              className="rounded-full px-5 sm:px-8 py-2.5 sm:py-3 text-sm sm:text-base font-bold shadow-[0_0_15px_rgba(249,115,22,0.4)]"
              onClick={(e) => {
                e.stopPropagation();
                setIsCartOpen(true);
              }}
            >
              <span className="hidden sm:inline">
                Pagar <KBD>F4</KBD>
              </span>
              <span className="sm:hidden">Pagar</span>
            </Button>
          ) : (
            <Button
              variant="danger"
              className="rounded-full px-5 sm:px-8 py-2.5 sm:py-3 text-sm sm:text-base font-bold animate-pulse"
              onClick={(e) => {
                e.stopPropagation();
                onOpenCashShift();
              }}
            >
              <span>Abrir Turno de Caja</span>
            </Button>
          )}
        </div>
      </div>

      {/* Alerta visible debajo del topbar si no hay caja abierta */}
      {!hasOpenShift && (
        <div className="bg-red-500/90 text-white text-center py-2 text-sm font-semibold shadow-md flex justify-center items-center gap-2 z-10">
          ⚠️ Tienes que abrir tu turno de caja para poder procesar pagos y emitir ventas.
        </div>
      )}

      {/* Buscador + catálogo */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-[#1a1a24]/50 to-[#0f0f13] p-3 sm:p-6">
        <div className="mb-4 sm:mb-6">
          <ProductSearchBar
            searchTerm={searchTerm}
            onSearch={onSearch}
            searchInputRef={searchInputRef}
            onOpenScanner={onOpenScanner}
            placeholder="Buscar producto... (F3)"
            onEnter={(term: string) => {
              if (filteredProducts.length > 0 && !term.includes("*")) {
                onAddItem(filteredProducts[0]!, 1, getBranchStock);
                onSearch("");
              } else if (term.length >= 2) {
                let code = term,
                  qty = 1;
                if (term.includes("*")) {
                  const parts = term.split("*");
                  qty = parseFloat(parts[0] ?? "") || 1;
                  code = parts[1] ?? "";
                }
                if (code) onSearch(code);
              }
            }}
          />
        </div>

        {/* Grid de productos */}
        <div className="flex-1 overflow-y-auto w-full max-w-6xl mx-auto pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filteredProducts.map((product: Product) => {
              const cartItem = items.find((i) => i.product_id === product._id);
              const qty = cartItem?.quantity ?? 0;
              return (
                <ProductCard
                  key={product._id}
                  product={product}
                  stock={getBranchStock(product)}
                  cartQty={typeof qty === 'string' ? parseFloat(qty) || 0 : qty}
                  onAdd={(p) => onAddItem(p, 1, getBranchStock)}
                  exchangeRate={exchangeRate}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Cart drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={items}
        onQtyChange={onQtyChange}
        onRemove={onRemoveItem}
        onSubmit={onSubmit}
        paymentMethod={paymentMethod}
        onPaymentChange={onPaymentChange}
        isLoading={isLoading}
        currentTotal={currentTotal}
        exchangeRate={exchangeRate}
        submitBtnRef={submitBtnRef}
        paymentSelectRef={paymentSelectRef}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onCustomerChange={onCustomerChange}
        onCreateCustomer={onCreateCustomer}
        isCreatingCustomer={isCreatingCustomer}
        isCustomersLoading={isCustomersLoading}
        isCustomersError={isCustomersError}
        saleStatus={saleStatus}
        onStatusChange={onStatusChange}
      />
    </motion.div>
  );
};

export default SalePOSForm;

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save } from "lucide-react";
import Button from "../atoms/Button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUpdateSale, saleKeys } from "../../hooks/queries/useSaleQueries";
import { useAuthStore } from "../../store/authStore";
import type { SaleDetailDTO, PaymentMethod } from '@inventory/shared';
import type { FormEvent } from "react";
import toast from "react-hot-toast";

const PAYMENT_METHODS: PaymentMethod[] = ["Efectivo", "Divisas", "Punto de Venta", "Pago Móvil", "Transferencia", "Zelle"];

interface EditSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: SaleDetailDTO;
  onSave: (updatedSale: SaleDetailDTO) => void;
}

interface EditableSaleItem {
  product_id: string;
  name: string;
  quantity: number | string;
  unit_price: number;
  unit_type: string;
}

const EditSaleModal = ({ isOpen, onClose, sale, onSave }: EditSaleModalProps) => {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Efectivo");
  const [items, setItems] = useState<EditableSaleItem[]>([]);
  
  const queryClient = useQueryClient();
  const updateSaleMutation = useUpdateSale();

  useEffect(() => {
    if (sale) {
      setPaymentMethod(sale.payment_method || "Efectivo");
      setItems(
        sale.items?.map((i: any) => ({
          product_id: (i.product_id?._id || i.product_id || "") as string,
          name: i.product_id?.name || "Producto desconocido",
          quantity: Number(i.quantity) || 0,
          unit_price: Number(i.unit_price) || 0,
          unit_type: i.product_id?.unit_type || "unidad",
        })) || []
      );
    }
  }, [sale]);

  const computedTotal = items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_price),
    0
  );

  const handleQtyChange = (idx: number, newQty: string) => {
    const val = parseFloat(newQty);
    if (val < 0) return;
    const newItems = [...items];
    const item = newItems[idx];
    if (!item) return;
    item.quantity = newQty; // keep string/number representation while typing
    setItems(newItems);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    
    const payload = {
      total_amount: String(computedTotal),
      payment_method: paymentMethod,
      items: items.map((i) => ({
        product_id: i.product_id as any,
        quantity: String(Number(i.quantity) || 0),
        unit_price: String(Number(i.unit_price) || 0),
      })),
    };

    updateSaleMutation.mutate(
      { id: sale._id, data: payload },
      {
        onSuccess: async (data) => {
          // Fuerza a limpiar la caché de ['products'] y ['sales'] de manera simultánea en el bloque onSuccess del useMutation
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["products", useAuthStore.getState().activeBranchId] }),
            queryClient.invalidateQueries({ queryKey: saleKeys.all(useAuthStore.getState().activeBranchId) }),
          ]);
          onSave(data as any);
        },
        onError: (err: any) => {
          toast.error(err?.response?.data?.message || "Error al actualizar la venta");
        },
      }
    );
  };

  if (!isOpen || !sale) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-[#1a1a24] border border-white/10 rounded-2xl w-full max-w-lg my-8 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          <div className="flex justify-between items-center p-5 border-b border-white/5 shrink-0">
            <h3 className="text-xl font-bold text-white">Editar Venta</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-white transition"
              disabled={updateSaleMutation.isPending}
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            <form id="edit-sale-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div>
                <label htmlFor="edit-payment" className="block text-sm font-medium text-gray-300 mb-1">
                  Método de Pago
                </label>
                <select
                  id="edit-payment"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  disabled={updateSaleMutation.isPending}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition outline-none"
                >
                  {PAYMENT_METHODS.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Artículos (Editar Cantidad)</h4>
                <div className="bg-black/30 border border-white/5 rounded-xl overflow-hidden divide-y divide-white/5">
                  {items.map((item, idx) => {
                    const isFractional = item.unit_type === "Kg" || item.unit_type === "Litro";
                    return (
                      <div key={idx} className="p-3 flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">{item.name}</p>
                          <p className="text-xs text-gray-400">
                            ${Number(item.unit_price).toFixed(2)} / {item.unit_type}
                          </p>
                        </div>
                        <div className="w-24 shrink-0">
                          <input
                            type="number"
                            min="0"
                            step={isFractional ? "0.001" : "1"}
                            value={item.quantity}
                            onChange={(e) => handleQtyChange(idx, e.target.value)}
                            disabled={updateSaleMutation.isPending}
                            className="w-full bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-center text-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition outline-none text-sm"
                          />
                        </div>
                        <div className="w-20 text-right shrink-0">
                          <p className="text-sm text-amber-500 font-medium">
                            ${(Number(item.quantity) * Number(item.unit_price)).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-between items-center bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
                <span className="text-orange-400 font-medium">Total Calculado</span>
                <span className="text-2xl font-bold text-amber-500">${computedTotal.toFixed(2)}</span>
              </div>
            </form>
          </div>

          <div className="p-5 border-t border-white/5 bg-black/20 shrink-0">
            <div className="flex gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                className="flex-1 text-gray-400 hover:text-white"
                disabled={updateSaleMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                form="edit-sale-form"
                variant="primary"
                className="flex-1 justify-center"
                disabled={updateSaleMutation.isPending}
              >
                {updateSaleMutation.isPending ? (
                  "Guardando..."
                ) : (
                  <>
                    <Save size={18} className="mr-2" /> Guardar Cambios
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default EditSaleModal;


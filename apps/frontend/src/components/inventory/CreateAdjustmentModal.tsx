import { useState } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import Button from '../atoms/Button';
import InputText from '../atoms/InputText';
import TextArea from '../atoms/TextArea';
import { useCreateAdjustment } from '../../hooks/queries/useAdjustmentQueries';
import { useAllProductsForPOS } from '../../hooks/queries/useProductQueries';
import toast from 'react-hot-toast';
import { Product } from '@inventory/shared';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const CreateAdjustmentModal = ({ isOpen, onClose }: Props) => {
  const { data: products = [], isLoading: isLoadingProducts } = useAllProductsForPOS();
  const { mutate: createAdjustment, isPending } = useCreateAdjustment();

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<'INITIAL_INVENTORY' | 'CORRECTION' | 'LOSS' | 'DAMAGE' | 'EXPIRED'>('CORRECTION');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!productId) {
      setError('Debes seleccionar un producto.');
      return;
    }

    const qty = Number(quantity);
    if (!quantity || isNaN(qty) || qty === 0) {
      setError('La cantidad no puede ser 0.');
      return;
    }

    createAdjustment(
      {
        product_id: productId,
        quantity: qty,
        reason,
        notes: notes.trim(),
      },
      {
        onSuccess: () => {
          toast.success('Ajuste registrado exitosamente');
          onClose();
        },
        onError: (err: any) => {
          setError(err?.response?.data?.message || 'Error al crear el ajuste');
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div 
        className="w-full max-w-lg bg-[#1a1a24] rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 id="modal-title" className="text-xl font-bold text-white">Nuevo Ajuste de Inventario</h2>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
              <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={18} />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <form id="adjustment-form" onSubmit={handleSubmit} className="space-y-5">
            {/* Producto */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Producto <span className="text-red-400">*</span>
              </label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                required
                disabled={isLoadingProducts}
              >
                <option value="">Selecciona un producto...</option>
                {products.map((p: Product) => (
                  <option key={p._id} value={p._id}>
                    {p.name} {p.barcode ? `(${p.barcode})` : ''} - Stock actual: {(p as any).stock ?? (p as any).quantity ?? 0}
                  </option>
                ))}
              </select>
            </div>

            {/* Motivo */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Motivo del Ajuste <span className="text-red-400">*</span>
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as any)}
                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                required
              >
                <option value="INITIAL_INVENTORY">Inventario Inicial</option>
                <option value="CORRECTION">Corrección</option>
                <option value="LOSS">Pérdida</option>
                <option value="DAMAGE">Dañado</option>
                <option value="EXPIRED">Caducado</option>
              </select>
            </div>

            {/* Cantidad */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Variación de Cantidad (+/-) <span className="text-red-400">*</span>
              </label>
              <InputText
                type="number"
                placeholder="Ej: 5 (suma) o -3 (resta)"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
                className="w-full"
              />
              <p className="mt-1 text-xs text-gray-500">Usa números negativos para restar stock.</p>
            </div>

            {/* Notas */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Notas (Opcional)
              </label>
              <TextArea
                placeholder="Detalles adicionales del ajuste..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full"
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-black/20 flex items-center justify-end gap-3 rounded-b-2xl">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="text-gray-400 hover:text-white"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="adjustment-form"
            disabled={isPending}
            isLoading={isPending}
            className="bg-orange-500 hover:bg-orange-600 text-white min-w-[120px]"
          >
            <Save size={18} className="mr-2" />
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateAdjustmentModal;

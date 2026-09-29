import { useMemo, useState } from 'react';
import { ArrowRight, Package, Trash2, X, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

import type { BranchId, Product, CreateStockTransferDTO } from '@inventory/shared';

import Modal from '../molecules/Modal';
import ProductSearchBar from '../molecules/ProductSearchBar';

import { useBranchesQuery } from '../../hooks/queries/useBranchQueries';
import { useTransferProductsQuery } from '../../hooks/queries/useProductQueries';
import { useCreateStockTransfer } from '../../hooks/queries/useStockTransferQueries';
import { useTransferCart } from '../../features/transfers/hooks/useTransferCart';
import { getProductStockForBranch } from '../../features/transfers/utils/transferInventory';

interface CreateStockTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateStockTransferModal({
  isOpen,
  onClose,
}: CreateStockTransferModalProps) {
  const [sourceBranchId, setSourceBranchId] = useState<BranchId | null>(null);
  const [destinationBranchId, setDestinationBranchId] = useState<BranchId | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Estado para la fila intermedia (UX)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantityInput, setQuantityInput] = useState('');

  const { data: branches = [], isLoading: branchesLoading } = useBranchesQuery();

  const {
    data: products = [],
    isLoading: productsLoading,
  } = useTransferProductsQuery(sourceBranchId);

  const createTransfer = useCreateStockTransfer();

  const {
    cart,
    addItem,
    updateQuantity,
    removeItem,
    clear,
  } = useTransferCart(sourceBranchId);

  const availableProducts = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return products;
    }

    return products.filter((product) => {
      return (
        product.name.toLowerCase().includes(normalizedSearch) ||
        product.barcode?.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [products, searchTerm]);

  const destinationBranches = useMemo(
    () => branches.filter((branch) => branch._id !== sourceBranchId),
    [branches, sourceBranchId],
  );

  const handleSourceBranchChange = (branchId: BranchId) => {
    setSourceBranchId(branchId);
    clear();
    
    if (destinationBranchId === branchId) {
      setDestinationBranchId(null);
    }

    // Al cambiar de origen limpiamos todo el flujo
    setSelectedProduct(null);
    setQuantityInput('');
    setSearchTerm('');
  };

  const handleClose = () => {
    clear();
    setSearchTerm('');
    setSelectedProduct(null);
    setQuantityInput('');
    setSourceBranchId(null);
    setDestinationBranchId(null);
    onClose();
  };

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setQuantityInput('1');
    setSearchTerm('');
  };

  const handleAddToCart = () => {
    if (!selectedProduct || !sourceBranchId) return;
    
    try {
      addItem(selectedProduct, quantityInput);
      setSelectedProduct(null);
      setQuantityInput('');
    } catch (error: any) {
      toast.error(error.message || 'Error al agregar cantidad');
    }
  };

  const handleTransfer = async () => {
    if (!sourceBranchId || !destinationBranchId || cart.length === 0) {
      return;
    }

    const payload: CreateStockTransferDTO = {
      sourceBranchId,
      destinationBranchId,
      items: cart.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
      })),
    };

    try {
      await createTransfer.mutateAsync(payload);
      toast.success('Transferencia creada exitosamente');
      handleClose();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error.message || 'Error al procesar transferencia');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Crear transferencia"
      icon={<Package className="text-orange-500" size={22} />}
      className="max-w-4xl max-h-[90vh] overflow-y-auto"
    >
      <div className="space-y-5">
        {/* Sucursales */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <div>
            <label
              htmlFor="transfer-source-branch"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Sucursal origen
            </label>

            <select
              id="transfer-source-branch"
              value={sourceBranchId ?? ''}
              onChange={(event) =>
                handleSourceBranchChange(event.target.value as BranchId)
              }
              disabled={branchesLoading}
              className="w-full h-11 rounded-xl bg-black/40 border border-white/10 px-3 text-white focus:outline-none focus:border-orange-500"
            >
              <option value="">
                {branchesLoading
                  ? 'Cargando sucursales...'
                  : 'Seleccionar origen'}
              </option>

              {branches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          <ArrowRight
            className="hidden md:block text-orange-500 mb-3"
            size={22}
          />

          <div>
            <label
              htmlFor="transfer-destination-branch"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Sucursal destino
            </label>

            <select
              id="transfer-destination-branch"
              value={destinationBranchId ?? ''}
              onChange={(event) =>
                setDestinationBranchId(
                  event.target.value as BranchId,
                )
              }
              disabled={!sourceBranchId || branchesLoading}
              className="w-full h-11 rounded-xl bg-black/40 border border-white/10 px-3 text-white focus:outline-none focus:border-orange-500 disabled:opacity-50"
            >
              <option value="">
                Seleccionar destino
              </option>

              {destinationBranches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Productos */}
        {sourceBranchId && (
          <div className="space-y-3">
            {/* Si NO hay producto seleccionado, mostramos la búsqueda */}
            {!selectedProduct && (
              <>
                <ProductSearchBar
                  searchTerm={searchTerm}
                  onSearch={setSearchTerm}
                  placeholder="Buscar producto para transferir..."
                />

                {productsLoading && (
                  <p className="text-sm text-gray-400">
                    Cargando productos...
                  </p>
                )}

                {!productsLoading && searchTerm.trim() && availableProducts.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-6">
                    No se encontraron productos.
                  </p>
                )}

                {!productsLoading && searchTerm.trim() && availableProducts.length > 0 && (
                  <div className="grid gap-2 max-h-64 overflow-y-auto">
                    {availableProducts.slice(0, 10).map((product) => {
                      const stock = getProductStockForBranch(product, sourceBranchId);
                      return (
                        <button
                          key={product._id}
                          type="button"
                          onClick={() => handleSelectProduct(product)}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10 transition"
                        >
                          <div>
                            <p className="text-white font-medium">
                              {product.name}
                            </p>
                            <p className="text-xs text-gray-400">
                              {product.unit_type} | Max: {stock}
                            </p>
                          </div>
                          <span className="text-sm text-orange-400">
                            Seleccionar
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Fila intermedia de ingreso de cantidad */}
            {selectedProduct && (
              <div className="rounded-xl border border-orange-500/50 bg-orange-500/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-white font-medium">{selectedProduct.name}</h3>
                    <p className="text-xs text-orange-300/80">
                      Stock disponible: {getProductStockForBranch(selectedProduct, sourceBranchId)} {selectedProduct.unit_type}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(null)}
                    className="text-gray-400 hover:text-white transition"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddToCart();
                    }}
                    placeholder="Cantidad"
                    autoFocus
                    className="flex-1 h-11 rounded-xl bg-black/40 border border-white/10 px-3 text-white focus:outline-none focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="h-11 px-5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 flex items-center gap-2 transition"
                  >
                    <Plus size={18} />
                    Agregar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Carrito */}
        {cart.length > 0 && (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="px-4 py-3 bg-white/5 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Productos a transferir
              </h3>

              <button
                type="button"
                onClick={clear}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Limpiar
              </button>
            </div>

            <div className="divide-y divide-white/10 max-h-60 overflow-y-auto">
              {cart.map((item) => {
                const product = products.find((p) => p._id === item.product_id);
                const stock = product && sourceBranchId ? getProductStockForBranch(product, sourceBranchId) : '0';
                
                return (
                  <div
                    key={item.product_id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {item.unit_type} | Max: {stock}
                      </p>
                    </div>

                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.quantity}
                      onChange={(event) => {
                        if (product) {
                          try {
                            updateQuantity(product, event.target.value);
                          } catch (error: any) {
                            toast.error(error.message);
                          }
                        }
                      }}
                      className="w-24 h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-white text-right focus:outline-none focus:border-orange-500"
                    />

                    <button
                      type="button"
                      onClick={() => removeItem(item.product_id)}
                      aria-label={`Eliminar ${item.name}`}
                      className="text-gray-400 hover:text-red-400 p-1"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={handleClose}
            className="h-11 px-5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 transition"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={
              createTransfer.isPending ||
              !sourceBranchId ||
              !destinationBranchId ||
              sourceBranchId === destinationBranchId ||
              cart.length === 0
            }
            onClick={() => void handleTransfer()}
            className="h-11 px-5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {createTransfer.isPending ? 'Transfiriendo...' : 'Transferir'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useState, useMemo, ChangeEvent, FormEvent } from 'react';
import { Plus, PackageOpen, Camera, ScanBarcode, Tag as TagIcon, Printer } from 'lucide-react';
import {
  useProductsQuery,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useAllCategoriesQuery,
  useBranchesQuery,
} from '../hooks/queries';
import { useExchangeRateQuery } from '../hooks/queries/useExchangeRateQueries';
import { toBs } from '../utils/currency';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import type { Product, ProductId, Branch } from '@inventory/shared';

import Button from './atoms/Button';
import Badge from './atoms/Badge';
import Modal from './molecules/Modal';
import FormField from './molecules/FormField';
import SectionHeader from './molecules/SectionHeader';
import ConfirmDialog from './molecules/ConfirmDialog';
import DataTable, { DataTableColumn } from './organisms/DataTable';
import { createDataTableColumn } from './organisms/DataTable.types';
import BarcodeScanner from './BarcodeScanner';
import ProductSearchBar from './molecules/ProductSearchBar';
import { RateGuard } from './pos/RateGuard';
import { RequireBranchGuard } from './guards/RequireBranchGuard';
import ProductListPrintModal from './ProductListPrintModal';

const ITEMS_PER_PAGE = 20;

interface ProductFormData {
  name: string;
  description: string;
  price: string;
  stock: string;
  category: string;
  unit_type: 'unidad' | 'kg' | 'litro' | 'metro';
  barcode: string;
  new_stock: string;
  stock_reason: string;
}

const EMPTY_FORM: ProductFormData = {
  name: '', description: '', price: '', stock: '',
  category: '', unit_type: 'unidad', barcode: '',
  new_stock: '', stock_reason: '',
};

const STOCK_REASONS = [
  { value: 'initial_count', label: 'Inventario Inicial' },
  { value: 'damaged', label: 'Dañado / Merma' },
  { value: 'stolen', label: 'Extravío / Robo' },
  { value: 'expired', label: 'Vencido' },
  { value: 'correction', label: 'Corrección' },
  { value: 'other', label: 'Otro motivo' },
];

const UNIT_OPTIONS = [
  { value: 'unidad', label: 'Unidad (ud)' },
  { value: 'kg', label: 'Kilogramos (kg)' },
  { value: 'litro', label: 'Litros (l)' },
  { value: 'metro', label: 'Metros (m)' },
];

const stockVariant = (stock: number) => {
  if (stock > 10) return 'success';
  if (stock > 0) return 'warning';
  return 'danger';
};

const formatUnit = (stock: number, unit_type?: string) => {
  if (unit_type && unit_type !== 'unidad') return unit_type;
  return stock === 1 ? 'unidad' : 'unidades';
};

const formatShortUnit = (unit_type?: string) => {
  switch (unit_type) {
    case 'kg':
      return 'kg';
    case 'litro':
      return 'L';
    case 'metro':
      return 'm';
    case 'unidad':
    default:
      return 'ud';
  }
};

export const buildColumns = (
  toBsFn: (usd: string, rate: string) => string,
  rate: string,
  branches: Branch[] = [],
  activeBranchId: string | null = null,
) => {
  const column = createDataTableColumn<Product>();

  return [
    column({
      key: 'name',
      label: 'Producto',
      render: (val, row) => (
        <div>
          <p className="font-semibold text-white text-sm sm:text-base">{val}</p>
          <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">ID: {row._id?.slice(-6)}</p>
        </div>
      ),
    }),

    column({
      key: 'category',
      label: 'Categoría',
      headerClassName: 'hidden md:table-cell',
      className: 'hidden md:table-cell',
      render: (val) => (
        <span className="bg-white/5 px-2 py-1 rounded-md text-xs border border-white/10 text-gray-400">
          {typeof val === 'string' ? 'Sin Categoría' : val.name}
        </span>
      ),
    }),

    column({
      key: 'price',
      label: 'Precio',
      render: (val) => (
        <div>
          <p className="text-amber-500 font-medium text-sm sm:text-base">
            ${Number(val).toFixed(2)}
          </p>
          <p className="text-[10px] sm:text-xs text-blue-400 mt-0.5">
            Bs {toBsFn(String(val), rate)}
          </p>
        </div>
      ),
    }),

    column({
      key: 'branchInventories',
      label: 'Stock por Sucursal',
      className: 'min-w-[180px] max-w-[320px]',
      render: (_val, row) => {
        const inventories = row.branchInventories ?? [];
        const invMap = new Map<string, number>();
        for (const inv of inventories) {
          invMap.set(String(inv.branch_id), Number(inv.stock));
        }

        let branchItems: Array<{
          branchId: string;
          name: string;
          stock: number;
          isActive: boolean;
        }> = [];

        if (branches.length > 0) {
          branchItems = branches.map((b) => ({
            branchId: String(b._id),
            name: b.name,
            stock: invMap.get(String(b._id)) ?? 0,
            isActive: String(b._id) === activeBranchId,
          }));

          const knownIds = new Set(branches.map((b) => String(b._id)));
          for (const inv of inventories) {
            const bId = String(inv.branch_id);
            if (!knownIds.has(bId)) {
              branchItems.push({
                branchId: bId,
                name: `Sucursal (${bId.slice(-4)})`,
                stock: Number(inv.stock),
                isActive: bId === activeBranchId,
              });
            }
          }
        } else if (inventories.length > 0) {
          branchItems = inventories.map((inv) => ({
            branchId: String(inv.branch_id),
            name: `Sucursal (${String(inv.branch_id).slice(-4)})`,
            stock: Number(inv.stock),
            isActive: String(inv.branch_id) === activeBranchId,
          }));
        }

        if (branchItems.length === 0) {
          return (
            <span className="text-xs text-gray-500 italic">
              Sin sucursales
            </span>
          );
        }

        return (
          <ul
            className="flex flex-wrap gap-1.5 list-none p-0 m-0"
            aria-label={`Stock de ${row.name} por sucursal`}
          >
            {branchItems.map((item) => {
              const numericStock = item.stock;
              const formattedStock = new Intl.NumberFormat('es-VE', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 3,
              }).format(numericStock);
              const shortUnit = formatShortUnit(row.unit_type);

              let badgeClasses = 'bg-white/5 border-white/10 text-gray-300';
              let stockColor = 'text-emerald-400 font-semibold';

              if (numericStock < 0) {
                badgeClasses = 'bg-red-500/10 border-red-500/25 text-red-400';
                stockColor = 'text-red-400 font-bold';
              } else if (numericStock === 0) {
                badgeClasses = 'bg-black/20 border-white/5 text-gray-400';
                stockColor = 'text-gray-400 font-medium';
              }

              if (item.isActive) {
                badgeClasses += ' ring-1 ring-orange-500/40 bg-orange-500/10';
              }

              return (
                <li key={item.branchId}>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs border ${badgeClasses} transition-colors`}
                    title={`${item.name}: ${formattedStock} ${formatUnit(numericStock, row.unit_type)}${item.isActive ? ' (Sucursal activa actual)' : ''}`}
                  >
                    {item.isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0"
                        title="Sucursal activa"
                        aria-hidden="true"
                      />
                    )}
                    <span className="text-gray-400 font-medium truncate max-w-[110px]">
                      {item.name}:
                    </span>
                    <span className={stockColor}>
                      {formattedStock}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {shortUnit}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        );
      },
    }),

    column({
      key: 'totalStock',
      label: 'Stock Global',
      render: (val, row) => {
        const numericStock = Number(val);
        const formattedStock = new Intl.NumberFormat('es-VE', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
        }).format(numericStock);
        return (
          <Badge variant={stockVariant(numericStock)}>
            {formattedStock}{' '}
            <span className="hidden sm:inline">
              {formatUnit(numericStock, row.unit_type)}
            </span>
          </Badge>
        );
      },
    }),

    column({
      key: 'barcode',
      label: 'Barcode',
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell font-mono text-xs text-gray-400',
    }),
  ];
};

const ProductManagerInner = () => {
  useEffect(() => {
    console.log('[ProductManager] MOUNT');
    return () => {
      console.log('[ProductManager] UNMOUNT');
    };
  }, []);

  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showDebtOnly, setShowDebtOnly] = useState(false);

  // Queries
  const { data, isLoading, error } = useProductsQuery(currentPage, ITEMS_PER_PAGE, debouncedSearch, showDebtOnly);
  const { data: categories = [] } = useAllCategoriesQuery();
  const { data: rateData } = useExchangeRateQuery();
  const { data: branches = [] } = useBranchesQuery();
  const exchangeRate = rateData?.rate ?? "1";
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const columns = useMemo(
    () => buildColumns(toBs, exchangeRate, branches, activeBranchId),
    [exchangeRate, branches, activeBranchId]
  );

  // Mutations
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<ProductId | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const products = data?.products ?? [];
  const totalPages = data?.totalPages ?? 1;

  // Debounce search term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      if (searchTerm !== debouncedSearch) {
        setCurrentPage(1);
      }
    }, 400);
    return () => clearTimeout(handler);
  }, [searchTerm, debouncedSearch]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEdit = (product: Product) => {
    setEditingId(product._id);
    setFormData({
      name: product.name,
      description: product.description || '',
      price: String(product.price),
      stock: '',
      category: typeof product.category === 'object' && product.category ? product.category._id : String(product.category),
      unit_type: product.unit_type || 'unidad',
      barcode: product.barcode || '',
      new_stock: '',
      stock_reason: '',
    });
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // Payload base: solo campos de catálogo (sin dependencias logísticas)
    const payload: any = {
      name: formData.name,
      description: formData.description,
      price: Number(formData.price),
      category: formData.category,
      unit_type: formData.unit_type,
      barcode: formData.barcode || undefined,
    };

    if (editingId) {
      // Creación/Edición pura de catálogo — sin stock_inicial, sin branch_id

      toast.promise(
        updateMutation.mutateAsync({ id: editingId, data: payload }),
        {
          loading: 'Actualizando producto...',
          success: () => {
            closeForm();
            return 'Producto actualizado';
          },
          error: (err: any) => err.response?.data?.message || 'Error al actualizar',
        }
      );
    } else {
      // Creación pura de catálogo — sin stock_inicial, sin branch_id
      toast.promise(
        createMutation.mutateAsync(payload),
        {
          loading: 'Creando producto...',
          success: () => {
            closeForm();
            return 'Producto creado';
          },
          error: (err: any) => err.response?.data?.message || 'Error al crear',
        }
      );
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    toast.promise(
      deleteMutation.mutateAsync(deleteTarget._id),
      {
        loading: 'Eliminando producto...',
        success: () => {
          setDeleteTarget(null);
          return 'Producto eliminado exitosamente';
        },
        error: (err: any) => err.response?.data?.message || 'Error al eliminar el producto',
      }
    );
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData(EMPTY_FORM);
  };

  const selectClass =
    'w-full bg-[#1a1a24] border border-white/10 rounded-xl px-4 py-3 text-white ' +
    'focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition';

  const isWorking = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <section aria-labelledby="products-heading" className="w-full max-w-7xl mx-auto p-4 sm:p-6">
      <SectionHeader
        id="products-heading"
        title={<>Gestión de <span className="text-orange-500">Productos</span></>}
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPrintModalOpen(true)}
              className="flex items-center gap-2 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 font-semibold w-full sm:w-auto"
            >
              <Printer size={18} />
              <span>Imprimir Lista</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => setIsFormOpen(true)}
              className="flex items-center gap-2 w-full sm:w-auto"
            >
              <Plus size={18} />
              <span>Nuevo Producto</span>
            </Button>
          </div>
        }
      />

      {error && !isFormOpen && (
        <p role="alert" className="p-4 mb-6 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
          {error.message || 'Error al obtener los productos'}
        </p>
      )}

      {/* Buscador */}
      {!isFormOpen && (
        <div className="mb-6 flex flex-col sm:flex-row gap-3 items-center">
          <div className="flex-1 w-full">
            <ProductSearchBar
              searchTerm={searchTerm}
              onSearch={setSearchTerm}
              placeholder="Buscar por nombre o código de barras..."
              onOpenScanner={() => setIsScannerOpen(true)}
            />
          </div>
          <Button
            type="button"
            variant={showDebtOnly ? 'primary' : 'outline'}
            onClick={() => {
              setShowDebtOnly(!showDebtOnly);
              setCurrentPage(1);
            }}
            className={`whitespace-nowrap ${showDebtOnly ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/50' : 'text-gray-400 border-white/10 hover:text-white'}`}
          >
            🚨 Ver Deuda Operativa
          </Button>
        </div>
      )}

      {/* Formulario */}
      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingId ? 'Editar Producto' : 'Agregar Nuevo Producto'}
        icon={<TagIcon size={20} />}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
            <FormField
              label="Nombre del producto"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="Ej. iPhone 15 Pro"
            />

            {/* Categoría — select nativo */}
            <div className="flex flex-col gap-1">
              <label htmlFor="product-category" className="block text-sm font-medium text-gray-300 mb-1">
                Categoría <span className="text-orange-500" aria-hidden="true">*</span>
              </label>
              <select
                id="product-category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                required
                className={selectClass}
              >
                <option value="" disabled>Selecciona una categoría</option>
                {categories.map((cat) => (
                  <option key={cat._id} value={cat._id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <FormField
              label="Precio ($)"
              name="price"
              type="number"
              value={formData.price}
              onChange={handleChange}
              required
              min="0"
              step="0.01"
              placeholder="Ej. 999.99"
            />


            {/* Código de barras con botón escáner */}
            <div className="flex flex-col gap-1">
              <label htmlFor="product-barcode" className="block text-sm font-medium text-gray-300 mb-1">
                Código de Barras <span className="text-gray-500 text-xs">(Opcional)</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanBarcode
                    size={18}
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
                  />
                  <input
                    id="product-barcode"
                    name="barcode"
                    type="text"
                    value={formData.barcode}
                    onChange={handleChange}
                    placeholder="Escanear o escribir..."
                    className="w-full pl-9 pr-3 py-3 bg-black/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 transition"
                  />
                </div>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  aria-label="Abrir escáner de cámara"
                  className="px-3"
                >
                  <Camera size={20} />
                </Button>
              </div>
            </div>

            {/* Unidad de medida */}
            <div className="flex flex-col gap-1">
              <label htmlFor="product-unit" className="block text-sm font-medium text-gray-300 mb-1">
                Unidad de Medida <span className="text-orange-500" aria-hidden="true">*</span>
              </label>
              <select
                id="product-unit"
                name="unit_type"
                value={formData.unit_type}
                onChange={handleChange}
                required
                className={selectClass}
              >
                {UNIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <FormField
            as="textarea"
            label="Descripción"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Detalles sobre el producto..."
            rows={3}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={closeForm} disabled={isWorking}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" isLoading={isWorking}>
              {editingId ? 'Actualizar' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>

      <DataTable
        columns={columns}
        data={products}
        isLoading={isLoading && !isFormOpen}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
        emptyMessage="No hay productos"
        emptyIcon={<PackageOpen size={30} />}
        emptyDetail="Aún no has agregado ningún producto al inventario."
        emptyAction={{ label: 'Agregar mi primer producto', onClick: () => setIsFormOpen(true) }}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      {/* Confirmación de borrado */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        message={`¿Eliminar "${deleteTarget?.name}"?`}
        detail="Esta acción no se puede deshacer y eliminará el producto del inventario."
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        isLoading={deleteMutation.isPending}
      />

      {/* Escáner de código de barras */}
      <BarcodeScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={(code: string) => {
          setIsScannerOpen(false);
          toast.success(`Código detectado: ${code}`);
          if (isFormOpen) {
            setFormData((prev) => ({ ...prev, barcode: code }));
          } else {
            setSearchTerm(code);
          }
        }}
      />

      {/* Modal de Impresión de Lista de Productos */}
      <ProductListPrintModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        searchTerm={debouncedSearch}
        showDebtOnly={showDebtOnly}
        exchangeRate={exchangeRate}
      />
    </section>
  );
};

export default function ProductManager() {
  return (
    <RateGuard>
      <ProductManagerInner />
    </RateGuard>
  );
}

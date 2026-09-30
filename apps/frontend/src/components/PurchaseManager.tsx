import { useState, useMemo, useCallback, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Check,
  Wallet,
  Calendar as CalendarIcon,
  PackageOpen,
  Trash2,
  ArrowLeft,
  Camera,
  Search,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingDown,
  Building2,
  Receipt,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import Button from './atoms/Button';
import Modal from './molecules/Modal';
import BarcodeScanner from './BarcodeScanner';
import Pagination from './molecules/Pagination';
import { RateGuard } from './pos/RateGuard';

import {
  usePurchasesQuery,
  usePurchaseDetailQuery,
  useCreatePurchase,
  useAddPaymentToPurchase,
  productKeys,
} from '../hooks/queries';
import { useAllProductsForPOS } from '../hooks/queries/useProductQueries';
import { useAuthStore } from '../store/authStore';
import { useExchangeRateQuery } from '../hooks/queries/useExchangeRateQueries';
import { toBs, formatDual, MoneyMath } from '../utils/currency';
import { fmtUSD } from '../utils/salesFormatters';
import type {
  Purchase,
  PurchaseId,
  PurchaseDetailItem,
  Product,
  ProductId,
  UnitType,
} from '@inventory/shared';
import { api as API } from '../api/axiosClient';

/* ─── Constantes ─────────────────────────────────────────── */
const ITEMS_PER_PAGE = 10;

interface FormItem {
  product_id: string;
  quantity: number | string;
  unit_cost: number | string;
  unit_type: UnitType;
}

const EMPTY_ITEM: FormItem = { product_id: '', quantity: 1, unit_cost: 0, unit_type: 'unidad' };
const createEmptyItems = (): FormItem[] => [{ ...EMPTY_ITEM }];

/* ─── Helpers ────────────────────────────────────────────── */
const fmtDate = (iso: string | undefined): string =>
  iso ? new Date(iso).toLocaleDateString() : 'N/A';

/** Resuelve due_date vs dueDate (el backend guarda snake_case). */
const getDueDate = (p: Purchase): string | undefined => p.dueDate ?? p.due_date;

interface StatusInfo {
  id: 'pagado' | 'vencida' | 'parcial' | 'pendiente';
  label: string;
  color: string;
  bg: string;
  icon: typeof CheckCircle2;
}

const getStatusInfo = (purchase: Purchase): StatusInfo => {
  const total = Number(purchase.total_cost || 0);
  const paid = Number(purchase.paid_amount || 0);
  const now = new Date();
  const dueRaw = getDueDate(purchase);
  const due = dueRaw ? new Date(dueRaw) : null;

  if (paid >= total && total > 0) {
    return { id: 'pagado', label: 'Pagado', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle2 };
  }
  if (due && due < now) {
    return { id: 'vencida', label: 'Vencida', color: 'text-rose-400', bg: 'bg-rose-500/15 border-rose-500/30', icon: AlertCircle };
  }
  if (paid > 0) {
    return { id: 'parcial', label: 'Parcial', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30', icon: TrendingDown };
  }
  return { id: 'pendiente', label: 'Pendiente', color: 'text-sky-400', bg: 'bg-sky-500/15 border-sky-500/30', icon: Clock };
};

const inputClasses =
  'w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all duration-200';

/* ─── Subcomponente: badge de estado ─────────────────────── */
interface StatusBadgeProps {
  purchase: Purchase;
}

const StatusBadge = ({ purchase }: StatusBadgeProps) => {
  const s = getStatusInfo(purchase);
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${s.bg} ${s.color}`}>
      <Icon size={13} />
      {s.label}
    </span>
  );
};

/* ─── Subcomponente: card de compra ──────────────────────── */
interface PurchaseCardProps {
  purchase: Purchase;
  onClick: (id: PurchaseId) => void;
}

const PurchaseCard = ({ purchase, onClick }: PurchaseCardProps) => {
  const total = Number(purchase.total_cost || 0);
  const paid = Number(purchase.paid_amount || 0);
  const pctPaid = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  const dueRaw = getDueDate(purchase);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={() => onClick(purchase._id)}
      className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-5 cursor-pointer group hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-300"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-white font-semibold text-lg truncate group-hover:text-indigo-300 transition-colors">
            {purchase.supplier}
          </h3>
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
            <CalendarIcon size={12} /> {fmtDate(purchase.createdAt)}
          </p>
        </div>
        <StatusBadge purchase={purchase} />
      </div>

      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Total</p>
          <p className="text-2xl font-bold text-white">{fmtUSD(total)}</p>
        </div>
        {dueRaw && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Clock size={12} /> Vence {fmtDate(dueRaw)}
          </p>
        )}
      </div>

      {/* Barra de progreso */}
      <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pctPaid}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={`h-full rounded-full ${pctPaid >= 100 ? 'bg-emerald-500' : pctPaid > 0 ? 'bg-amber-500' : 'bg-sky-500'}`}
        />
      </div>

      <div className="flex justify-between mt-2">
        <span className="text-xs text-gray-500">{fmtUSD(paid)} abonado</span>
        <span className="text-xs text-gray-400 flex items-center gap-1 group-hover:text-indigo-400 transition-colors">
          Ver detalles <ChevronRight size={14} />
        </span>
      </div>
    </motion.article>
  );
};

/* ─── Subcomponente: fila de artículo en el formulario ──── */
interface PurchaseItemRowProps {
  item: FormItem;
  index: number;
  products: Product[];
  onChange: (index: number, field: keyof FormItem, value: string) => void;
  onRemove: (index: number) => void;
  showRemove: boolean;
}

const PurchaseItemRow = ({ item, index, products, onChange, onRemove, showRemove }: PurchaseItemRowProps) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, x: -30 }}
    className="relative flex flex-wrap items-end gap-3 p-4 bg-white/5 rounded-xl border border-white/5 backdrop-blur-sm"
  >
    {/* Producto */}
    <div className="flex-[2] min-w-[180px]">
      <label className="block text-xs font-medium text-gray-400 mb-1.5 ml-1">Producto</label>
      <select
        value={item.product_id}
        onChange={(e) => onChange(index, 'product_id', e.target.value)}
        className={`${inputClasses} appearance-none`}
        required
      >
        <option value="">Seleccionar…</option>
        {products.map((p) => (
          <option key={p._id} value={p._id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>

    {/* Cantidad */}
    <div className="flex-1 lg:w-28">
      <label className="block text-xs font-medium text-gray-400 mb-1.5 ml-1">Cant.</label>
      <input
        type="number" min="0.01" step="0.01" required
        value={item.quantity}
        onChange={(e) => onChange(index, 'quantity', e.target.value)}
        className={inputClasses}
        placeholder="0.00"
      />
    </div>

    {/* Costo unitario */}
    <div className="flex-1 lg:w-32">
      <label className="block text-xs font-medium text-gray-400 mb-1.5 ml-1">Costo Unit.</label>
      <input
        type="number" min="0" step="0.01" required
        value={item.unit_cost}
        onChange={(e) => onChange(index, 'unit_cost', e.target.value)}
        className={inputClasses}
        placeholder="$0.00"
      />
    </div>

    {/* Subtotal */}
    <div className="flex-1 lg:w-32">
      <label className="block text-xs font-medium text-gray-400 mb-1.5 ml-1">Subtotal</label>
      <div className="flex items-center h-[42px] px-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 font-medium whitespace-nowrap">
        {fmtUSD(MoneyMath.mul(String(item.quantity || 0), String(item.unit_cost || 0)))}
      </div>
    </div>

    {showRemove && (
      <Button
        variant="icon" type="button"
        onClick={() => onRemove(index)}
        className="text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 absolute -top-2 -right-2 right bg-black lg:relative lg:top-0 lg:right-0 lg:mb-1 h-10 w-10 flex items-center justify-center rounded-full transition-colors"
      >
        <Trash2 size={18} />
      </Button>
    )}
  </motion.div>
);

/* ─── Subcomponente: detalle de una compra y abonos ─────── */
interface PurchaseDetailViewProps {
  purchase: Purchase;
  onBack: () => void;
  onPay: (id: PurchaseId, data: { amount: number }) => Promise<void>;
}

const PurchaseDetailView = ({ purchase, onBack, onPay }: PurchaseDetailViewProps) => {
  const [payAmount, setPayAmount] = useState('');
  const [isPaying, setIsPaying] = useState(false);

  const status = getStatusInfo(purchase);
  const total = Number(purchase.total_cost || 0);
  const paid = Number(purchase.paid_amount || 0);
  const pending = Math.max(0, total - paid);
  const isPaid = status.id === 'pagado';
  const dueRaw = getDueDate(purchase);

  const handlePay = async (e: FormEvent) => {
    e.preventDefault();
    if (!payAmount || Number(payAmount) <= 0) return toast.error('Ingresa un monto válido');
    if (Number(payAmount) > pending) return toast.error(`El monto no puede superar la deuda pendiente (${fmtUSD(pending)})`);

    setIsPaying(true);
    try {
      await onPay(purchase._id, { amount: Number(payAmount) });
      setPayAmount('');
      toast.success('Abono registrado correctamente');
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="mb-8 overflow-hidden bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl"
    >
      <header className="p-6 md:p-8 border-b border-white/5 bg-gradient-to-br from-indigo-500/5 to-transparent flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
        <div>
          <Button variant="ghost" onClick={onBack} className="text-gray-400 hover:text-white mb-4 -ml-2">
            <ArrowLeft size={18} className="mr-2" />
            <span>Volver al historial</span>
          </Button>
          <div className="flex items-center gap-4">
            <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{purchase.supplier}</h2>
            <StatusBadge purchase={purchase} />
          </div>
          <p className="text-sm text-gray-400 mt-2 flex items-center gap-2">
            <CalendarIcon size={14} /> Creado el {fmtDate(purchase.createdAt)}
            {dueRaw && <> <span className="mx-1">•</span> <Clock size={14} /> Vence el {fmtDate(dueRaw)}</>}
          </p>
        </div>

        {/* Resumen Financiero */}
        <div className="flex gap-4 p-4 bg-black/30 rounded-2xl border border-white/5 w-full md:w-auto">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Abonado</p>
            <p className="text-xl font-bold text-emerald-400">{fmtUSD(paid)}</p>
          </div>
          <div className="w-px bg-white/10 mx-2"></div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Pendiente</p>
            <p className="text-xl font-bold text-rose-400">{fmtUSD(pending)}</p>
          </div>
        </div>
      </header>

      <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lista de Items */}
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <PackageOpen size={18} className="text-indigo-400" />
            Artículos Comprados
          </h3>
          <div className="rounded-2xl border border-white/5 overflow-hidden bg-white/5 backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-black/40 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-semibold">Producto</th>
                    <th className="px-6 py-4 font-semibold">Cantidad</th>
                    <th className="px-6 py-4 font-semibold">Costo Unit.</th>
                    <th className="px-6 py-4 font-semibold text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {purchase.items?.map((item: PurchaseDetailItem, idx: number) => {
                    const productName =
                      typeof item.product_id === 'object' && item.product_id !== null
                        ? (item.product_id as { name: string }).name
                        : 'Desconocido';
                    const productIdStr =
                      typeof item.product_id === 'object' && item.product_id !== null
                        ? (item.product_id as { _id: string })._id
                        : String(item.product_id);

                    return (
                      <tr key={idx} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                          <span className="font-medium text-white group-hover:text-indigo-300 transition-colors">
                            {productName}
                          </span>
                          <div className="text-xs text-gray-500 mt-1 font-mono">{productIdStr}</div>
                        </td>
                        <td className="px-6 py-4 text-gray-300">
                          <span className="bg-white/10 px-2 py-1 rounded-md text-sm font-medium">{item.quantity}</span>
                        </td>
                        <td className="px-6 py-4 text-gray-400">{fmtUSD(item.unit_cost)}</td>
                        <td className="px-6 py-4 text-right font-medium text-indigo-300">
                          {fmtUSD(parseFloat(String(item.quantity)) * Number(item.unit_cost))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-black/40 border-t border-white/5 flex justify-end items-center gap-4">
              <span className="text-gray-400 text-sm">Costo Total Compra</span>
              <span className="text-2xl font-bold text-white">{fmtUSD(total)}</span>
            </div>
          </div>
        </div>

        {/* Módulo de Pagos */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Wallet size={18} className="text-indigo-400" />
            Gestión de Pagos
          </h3>

          <div className="bg-white/5 border border-white/5 rounded-2xl p-6 backdrop-blur-sm relative overflow-hidden">
            {/* Background decoration */}
            <div className={`absolute -right-10 -top-10 w-40 h-40 rounded-full blur-3xl opacity-20 ${isPaid ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div>

            {isPaid ? (
              <div className="flex flex-col items-center justify-center p-6 text-center z-10 relative">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} />
                </div>
                <h4 className="text-lg font-bold text-white mb-1">Compra Saldada</h4>
                <p className="text-sm text-gray-400">Esta compra ha sido pagada en su totalidad.</p>
              </div>
            ) : (
              <form onSubmit={handlePay} className="relative z-10">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Ingresar Abono
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                    <input
                      type="number" min="0.01" step="0.01" max={pending} required
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-black/50 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-2xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition shadow-inner"
                    />
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs text-gray-500">Máx: {fmtUSD(pending)}</span>
                    <button
                      type="button"
                      onClick={() => setPayAmount(String(pending))}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      Saldar todo
                    </button>
                  </div>
                </div>

                <Button variant="primary" type="submit" isLoading={isPaying} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20">
                  Registrar Pago
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
};

/* ─── Componente principal ───────────────────────────────── */
const PurchaseManagerInner = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { data: rateData } = useExchangeRateQuery();
  const exchangeRateRaw = rateData?.rate;
  const hasValidRate = exchangeRateRaw != null && exchangeRateRaw !== '' && String(exchangeRateRaw) !== 'NaN' && !MoneyMath.isZeroOrNegative(String(exchangeRateRaw));
  const exchangeRate = hasValidRate ? String(exchangeRateRaw) : undefined;

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [viewedPurchaseId, setViewedPurchaseId] = useState<PurchaseId | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Form state
  const [supplier, setSupplier] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<FormItem[]>(createEmptyItems);

  // ── TanStack Queries ──
  const purchasesQuery = usePurchasesQuery(currentPage, ITEMS_PER_PAGE);
  const purchases = purchasesQuery.data?.purchases ?? [];
  const totalPages = purchasesQuery.data?.totalPages ?? 1;

  const detailQuery = usePurchaseDetailQuery(viewedPurchaseId);
  const viewedPurchase = detailQuery.data ?? null;

  const { data: allProducts = [] } = useAllProductsForPOS();

  // ── Mutations ──
  const createMutation = useCreatePurchase();
  const paymentMutation = useAddPaymentToPurchase();

  /* ── Filtros y Búsqueda ── */
  const filteredPurchases = useMemo(() => {
    let result = purchases;

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.supplier?.toLowerCase().includes(q) ||
          p._id?.toLowerCase().includes(q),
      );
    }

    // Tabs
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    result = result.filter((p) => {
      const state = getStatusInfo(p);
      const dueRaw = getDueDate(p);
      const isDueSoon =
        dueRaw &&
        new Date(dueRaw) <= nextWeek &&
        new Date(dueRaw) >= now &&
        state.id !== 'pagado';

      switch (activeTab) {
        case 'Pendientes':
          return state.id === 'pendiente' || state.id === 'parcial';
        case 'Vencidas':
          return state.id === 'vencida';
        case 'Por Vencer':
          return isDueSoon;
        default:
          return true; // "Todas"
      }
    });

    return result;
  }, [purchases, activeTab, searchQuery]);

  /* ── Handlers ── */
  const handleItemChange = (index: number, field: keyof FormItem, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      const item = next[index];
      if (item) {
        next[index] = { ...item, [field]: value } as unknown as FormItem;
        if (field === 'product_id') {
          const prod = allProducts.find((p) => p._id === value);
          if (prod) {
            next[index].unit_type = prod.unit_type || 'unidad';
          }
        }
      }
      return next;
    });
  };

  const handleBarcodeScan = useCallback(
    async (code: string) => {
      try {
        const res = await API.get(`/products/barcode/${code}`);
        const product = (res.data?.product ?? res.data) as Product | null;
        if (product) {
          setItems((prev) => {
            const emptyIdx = prev.findIndex((i) => !i.product_id);
            if (emptyIdx !== -1) {
              const next = [...prev];
              const currentItem = next[emptyIdx];
              if (currentItem) {
                next[emptyIdx] = {
                  ...currentItem,
                  product_id: product._id,
                  unit_type: product.unit_type || 'unidad',
                };
              }
              return next;
            }
            return [
              ...prev,
              {
                product_id: product._id,
                quantity: 1,
                unit_cost: product.price,
                unit_type: product.unit_type || 'unidad',
              },
            ];
          });
          toast.success(`Añadido: ${product.name}`);
          // Refrescar catálogo de productos
          queryClient.invalidateQueries({ queryKey: productKeys.posCatalog(useAuthStore.getState().activeBranchId) });
        }
      } catch {
        toast.error(`Código "${code}" no encontrado`);
      }
    },
    [queryClient],
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supplier.trim()) return toast.error('El nombre del proveedor es requerido');
    if (items.length === 0) return toast.error('Agrega al menos un artículo');
    if (!hasValidRate) return toast.error('Tasa de cambio no disponible. Operación bloqueada.');
    for (const item of items) {
      if (!item.product_id) return toast.error('Selecciona un producto en todos los campos');
      if (parseFloat(String(item.quantity)) <= 0) return toast.error('La cantidad debe ser mayor a 0');
      if (Number(item.unit_cost) < 0) return toast.error('El costo no puede ser negativo');
    }
    try {
      await createMutation.mutateAsync({
        supplier,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        exchange_rate: exchangeRate ? parseFloat(exchangeRate) : undefined,
        items: items.map(({ product_id, quantity, unit_cost }) => ({
          product_id,
          quantity: parseFloat(String(quantity)) || 0,
          unit_cost: Number(unit_cost),
        })),
      });
      toast.success('Compra/Entrada registrada con éxito');
      closeForm();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Ocurrió un error al registrar la compra';
      toast.error(message);
    }
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSupplier('');
    setDueDate('');
    setItems(createEmptyItems());
  };

  const handleViewDetail = (id: PurchaseId) => {
    setViewedPurchaseId(id);
  };

  const handlePayPurchase = async (id: PurchaseId, paymentData: { amount: number }) => {
    await paymentMutation.mutateAsync({ id, data: paymentData });
  };

  const currentTotal = items.reduce((acc, item) => {
    return MoneyMath.add(acc, MoneyMath.mul(String(item.quantity || 0), String(item.unit_cost || 0)));
  }, "0");
  const TABS = ['Todas', 'Pendientes', 'Por Vencer', 'Vencidas'];

  /* ── Render ── */
  return (
    <section aria-labelledby="purchases-heading" className="w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">

      {/* Header Interactivo */}
      {!viewedPurchase && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 id="purchases-heading" className="text-3xl md:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
              Gestión de <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Compras</span>
            </h1>
            <p className="text-gray-400 mt-2 font-medium">Controla inventario, cuentas por pagar y proveedores.</p>
          </div>

          <Button
            onClick={() => setIsFormOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 border-0 px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
          >
            <Plus size={20} /> Nueva Compra
          </Button>
        </motion.div>
      )}

      {purchasesQuery.isError && !isFormOpen && !viewedPurchase && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert" className="p-4 mb-8 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle size={18} /> Error al cargar compras
        </motion.p>
      )}

      {/* Vista detalle de compra */}
      <AnimatePresence mode="wait">
        {viewedPurchase && !isFormOpen && (
          <PurchaseDetailView
            key="detail"
            purchase={viewedPurchase}
            onBack={() => setViewedPurchaseId(null)}
            onPay={handlePayPurchase}
          />
        )}

        {/* Dashboard Analytics & Historial */}
        {!viewedPurchase && !isFormOpen && (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Controles de Vista */}
            <div className="flex flex-col lg:flex-row justify-between items-center gap-4 mb-8 bg-black/20 p-2 rounded-2xl border border-white/5 backdrop-blur-md">
              {/* Tabs */}
              <div className="flex w-full lg:w-auto overflow-x-auto hide-scrollbar gap-1 p-1 bg-black/40 rounded-xl">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                      activeTab === tab
                        ? 'bg-white/10 text-white shadow-sm'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Búsqueda */}
              <div className="relative w-full lg:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type="text"
                  placeholder="Buscar proveedor o ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
              </div>
            </div>

            {/* Grid de Compras */}
            {purchasesQuery.isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="bg-white/5 border border-white/5 rounded-2xl p-5 h-48"></div>
                ))}
              </div>
            ) : filteredPurchases.length === 0 ? (
              <div className="text-center py-20 bg-black/20 rounded-3xl border border-white/5 border-dashed">
                <PackageOpen size={48} className="mx-auto text-gray-600 mb-4" />
                <h3 className="text-xl font-medium text-white mb-2">No se encontraron compras</h3>
                <p className="text-gray-500">Intenta cambiar los filtros o registra una nueva entrada.</p>
              </div>
            ) : (
              <>
                <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-6">
                  <AnimatePresence>
                    {filteredPurchases.map((purchase) => (
                      <PurchaseCard key={purchase._id} purchase={purchase} onClick={handleViewDetail} />
                    ))}
                  </AnimatePresence>
                </motion.div>
                {totalPages > 1 && (
                  <div className="mt-8 rounded-2xl overflow-hidden border border-white/5">
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Formulario Modal Creador de Compras */}
      <Modal isOpen={isFormOpen} onClose={closeForm} title="Registrar Ingreso de Mercancía" className="max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-8 py-4">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-20">
            {/* Proveedor */}
            <div className="space-y-2">
              <label htmlFor="supplier" className="block text-sm font-medium text-gray-300 ml-1">
                Proveedor / Empresa responsable <span className="text-indigo-400">*</span>
              </label>
              <div className="relative">
                <Building2 size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="supplier" type="text" required value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="Ej. Distribuidora Mayorista S.A."
                  className={`${inputClasses} pl-11`}
                />
              </div>
            </div>

            {/* Fecha Vencimiento */}
            <div className="space-y-2">
              <label htmlFor="dueDate" className="block text-sm font-medium text-gray-300 ml-1">
                Vence El (Opcional)
              </label>
              <div className="relative">
                <CalendarIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  id="dueDate" type="date" value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={`${inputClasses} pl-11 [color-scheme:dark]`}
                />
              </div>
            </div>
          </div>

          {/* Artículos */}
          <fieldset className="border border-white/10 bg-black/30 rounded-2xl p-6 shadow-inner relative z-10 hidden-scroll overflow-visible">
            <legend className="sr-only">Artículos del ingreso</legend>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h4 className="text-xl font-bold text-white flex items-center gap-2">
                <PackageOpen className="text-indigo-400" /> Lista de Ítems
              </h4>
              <div className="flex flex-wrap sm:flex-nowrap gap-3 w-full sm:w-auto">
                <Button variant="ghost" size="sm" type="button" onClick={() => setIsScannerOpen(true)} className="bg-white/5 hover:bg-white/10 text-indigo-300 flex-1 sm:flex-none justify-center">
                  <Camera size={16} className="mr-2" /> Escanear Código
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => setItems((p) => [...p, { ...EMPTY_ITEM }])} className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 flex-1 sm:flex-none justify-center border border-indigo-500/30">
                  <Plus size={16} className="mr-2" /> Añadir Fila
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {items.map((item, index) => (
                  <PurchaseItemRow
                    key={index}
                    item={item}
                    index={index}
                    products={allProducts}
                    onChange={handleItemChange}
                    onRemove={(i) => setItems((p) => p.filter((_, idx) => idx !== i))}
                    showRemove={items.length > 1}
                  />
                ))}
              </AnimatePresence>
            </div>

            {/* Total estimado */}
            <div className="mt-8 pt-6 border-t border-white/5 flex flex-col items-end">
              <span className="text-gray-400 text-sm font-medium uppercase tracking-wider mb-1">Costo Total Estimado</span>
              <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 flex items-center gap-2 flex-wrap justify-end">
                <span>{fmtUSD(currentTotal)}</span>
                {hasValidRate ? (
                  <span className="text-sm font-normal text-gray-500"> / Bs {toBs(currentTotal, String(exchangeRate))}</span>
                ) : (
                  <span className="text-sm font-normal text-rose-500 flex items-center gap-1 border border-rose-500/30 bg-rose-500/10 px-2 py-1 rounded-md">
                    <AlertCircle size={14} /> Tasa Indisponible
                  </span>
                )}
              </div>
            </div>
          </fieldset>

          <div className="flex justify-end gap-4 pt-6 border-t border-white/5">
            <Button variant="secondary" type="button" onClick={closeForm} className="px-6 rounded-xl hover:bg-white/5 border-transparent">
              Cancelar
            </Button>
            <Button variant="primary" type="submit" isLoading={createMutation.isPending} disabled={!hasValidRate} className="px-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 border-0 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600">
              <Check size={18} /> Confirmar Ingreso
            </Button>
          </div>
        </form>
      </Modal>

      <BarcodeScanner isOpen={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScan={(code: string) => { handleBarcodeScan(code); setIsScannerOpen(false); }} />
    </section>
  );
};

export default function PurchaseManager() {
  return (
    <RateGuard>
      <PurchaseManagerInner />
    </RateGuard>
  );
}


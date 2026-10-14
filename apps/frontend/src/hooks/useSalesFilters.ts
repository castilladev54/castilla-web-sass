import { useState, useRef, useEffect, useMemo } from 'react';
import { useSalesQuery } from './queries/useSaleQueries';
import { useAuthStore } from '../store/authStore';

export interface DateFilterOption {
  value: string;
  label: string;
}

export const DATE_FILTER_OPTIONS: DateFilterOption[] = [
  { value: 'all',    label: 'Todas'    },
  { value: 'today',  label: 'Hoy'      },
  { value: 'ayer',   label: 'Ayer'     },
  { value: '7days',  label: '7 días'   },
  { value: '30days', label: '30 días'  },
  { value: 'month',  label: 'Este mes' },
];

export function useSalesFilters() {
  const { user } = useAuthStore();

  const [dateFilter, setDateFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sellerFilter, setSellerFilter] = useState<string | null>(null);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  // Determinar los filtros a enviar según el rol del usuario (empleado tiene visibilidad restringida)
  const isEmployee = user?.role === 'employee';

  const queryFilters = useMemo(() => {
    // Si el rol es employee, el backend fuerza la restricción del día actual y de su propio ID de forma implícita,
    // pero para consistencia pasamos los filtros de consulta correspondientes.
    const finalDateFilter = isEmployee ? undefined : dateFilter;
    const finalDateFrom = isEmployee ? undefined : (dateFrom || undefined);
    const finalDateTo = isEmployee ? undefined : (dateTo || undefined);
    const finalPaymentFilter = isEmployee ? undefined : paymentFilter;
    const finalSellerFilter = isEmployee ? null : sellerFilter;
    const finalStatusFilter = statusFilter !== 'all' ? statusFilter : undefined;

    return {
      page: currentPage,
      limit: 20,
      seller: finalSellerFilter,
      dateFilter: finalDateFilter,
      dateFrom: finalDateFrom,
      dateTo: finalDateTo,
      paymentMethod: finalPaymentFilter,
      status: finalStatusFilter,
      branchId: isEmployee ? undefined : (branchFilter || undefined),
    };
  }, [currentPage, sellerFilter, dateFilter, dateFrom, dateTo, paymentFilter, statusFilter, isEmployee, branchFilter]);

  // Ejecutar consulta mediante TanStack Query
  // Si es un empleado, o si el filtro es 'custom' pero no tiene rango completo, bloqueamos la consulta para evitar ruido
  const isQueryEnabled = !(user?.role !== 'employee' && dateFilter === 'custom' && (!dateFrom || !dateTo));

  const { data, isLoading, error } = useSalesQuery({
    ...queryFilters,
  });

  // Cerrar el datepicker si se hace clic fuera del mismo
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setIsDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const activeDateLabel = useMemo(() => {
    if (dateFilter === 'custom' && dateFrom && dateTo) {
      const fmt = (d: string) =>
        new Date(d + 'T00:00:00').toLocaleDateString('es-VE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
      return `${fmt(dateFrom)} – ${fmt(dateTo)}`;
    }
    return DATE_FILTER_OPTIONS.find((o) => o.value === dateFilter)?.label || 'Todas';
  }, [dateFilter, dateFrom, dateTo]);

  const sales = data?.sales ?? [];
  const totalPages = data?.totalPages ?? 1;
  const totalDocs = data?.total ?? 0;
  const filteredTotal = data?.totalAmount ?? 0;
  const completedTotal = data?.completedAmount ?? data?.totalAmount ?? 0;
  const pendingTotal = data?.pendingAmount ?? 0;

  return {
    sales,
    isLoading,
    error,
    dateFilter,
    setDateFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    sellerFilter,
    setSellerFilter,
    paymentFilter,
    setPaymentFilter,
    statusFilter,
    setStatusFilter,
    isDatePickerOpen,
    setIsDatePickerOpen,
    currentPage,
    setCurrentPage,
    datePickerRef,
    activeDateLabel,
    filteredTotal,
    completedTotal,
    pendingTotal,
    totalPages,
    totalDocs,
    branchFilter,
    setBranchFilter,
    DATE_FILTER_OPTIONS,
  };
}

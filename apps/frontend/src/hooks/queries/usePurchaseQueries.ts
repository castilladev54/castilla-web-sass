import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api as API } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import { exchangeRateKeys } from './useExchangeRateQueries';
import type {
  Purchase,
  PurchaseId,
  PurchaseDbStatus,
  PurchaseWithDetails,
  PurchaseDetailItem,
} from '@inventory/shared';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const purchaseKeys = {
  all: (branchId: string | null) => ['purchases', branchId] as const,
  lists: (branchId: string | null) => [...purchaseKeys.all(branchId), 'list'] as const,
  list: (branchId: string | null, page: number, limit: number, status?: PurchaseDbStatus) =>
    [...purchaseKeys.lists(branchId), { page, limit, status }] as const,
  details: (branchId: string | null) => [...purchaseKeys.all(branchId), 'detail'] as const,
  detail: (branchId: string | null, id: PurchaseId) => [...purchaseKeys.details(branchId), id] as const,
  payments: (branchId: string | null) => [...purchaseKeys.all(branchId), 'payments'] as const,
};

// ─── Tipos de Payload ─────────────────────────────────────────────────────────

export interface PurchaseItemPayload {
  product_id: string;
  quantity: string | number;
  unit_cost: string | number;
  invoice_number?: string | null;
}

export interface CreatePurchasePayload {
  supplier: string;
  dueDate?: string | null;
  items: PurchaseItemPayload[];
  exchange_rate?: string | number;
  invoice_number?: string | null;
}

export interface AddPaymentPayload {
  amount: number;
}

interface PurchaseListResponse {
  purchases: Purchase[];
  total: number;
  totalPages: number;
  currentPage: number;
}

export interface SupplierPayment {
  _id: string;
  purchase_id: string | { _id: string; supplier: string };
  amount: number;
  date?: string;
  createdAt: string;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function usePurchasesQuery(page: number, limit: number, status?: PurchaseDbStatus) {
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);

  return useQuery<PurchaseListResponse>({
    queryKey: purchaseKeys.list(activeBranchId, page, limit, status),
    queryFn: async ({ signal }) => {
      const res = await API.get(`/purchases?${params.toString()}`, { signal });
      const data = res.data;
      return {
        purchases: data.purchases ?? data.data ?? (Array.isArray(data) ? data : []),
        total: data.total ?? 0,
        totalPages: data.totalPages ?? 1,
        currentPage: data.currentPage ?? page,
      };
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/**
 * Obtener detalles de una compra específica.
 * El backend devuelve { purchase, details } donde `details` son
 * los PurchaseDetail poblados con product_id.name.
 * Fusionamos `details` como `.items` dentro del Purchase para
 * que el componente pueda iterar directamente.
 */
export function usePurchaseDetailQuery(id: PurchaseId | null) {
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useQuery<Purchase>({
    queryKey: purchaseKeys.detail(activeBranchId, id as PurchaseId),
    queryFn: async ({ signal }) => {
      const res = await API.get(`/purchases/${id}`, { signal });
      const payload = res.data as PurchaseWithDetails | { purchase: Purchase };

      const purchase = (payload as PurchaseWithDetails).purchase ?? (res.data as Purchase);
      const details: PurchaseDetailItem[] = (payload as PurchaseWithDetails).details ?? [];

      // Inyectar items dentro del objeto purchase para consumo uniforme
      return { ...purchase, items: details };
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Obtener historial de pagos a proveedores */
export function usePurchasePaymentsQuery(global?: boolean) {
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useQuery<SupplierPayment[]>({
    queryKey: [...purchaseKeys.payments(activeBranchId), { global }],
    queryFn: async ({ signal }) => {
      const headers: Record<string, string> = {};
      if (global) headers['x-global-request'] = 'true';

      const res = await API.get('/purchases/payments', { signal, headers });
      const data = res.data;
      return data.payments ?? data.data ?? (Array.isArray(data) ? data : []);
    },
    staleTime: 60_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreatePurchase() {
  const qc = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useMutation<Purchase, Error, CreatePurchasePayload>({
    mutationFn: async (payload) => {
      const res = await API.post('/purchases', payload);
      return (res.data.purchase ?? res.data) as Purchase;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all(activeBranchId) });
      qc.invalidateQueries({ queryKey: ['products', activeBranchId] });
    },
    onError: (error: any) => {
      // Recuperación automática JIT: Si la tasa de cambio cambió, invalidamos la tasa para forzar un refetch.
      if (error?.response?.status === 409 && error?.response?.data?.error === 'EXCHANGE_RATE_MISMATCH') {
        qc.invalidateQueries({ queryKey: exchangeRateKeys.all });
      }
    },
  });
}

/** Registrar un abono a una compra */
export function useAddPaymentToPurchase() {
  const qc = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useMutation<Purchase, Error, { id: PurchaseId; data: AddPaymentPayload }>({
    mutationFn: async ({ id, data }) => {
      const res = await API.patch(`/purchases/${id}/payment`, data);
      return (res.data.purchase ?? res.data) as Purchase;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all(activeBranchId) });
      qc.invalidateQueries({ queryKey: purchaseKeys.detail(activeBranchId, id) });
    },
  });
}

export function useDeletePurchase() {
  const qc = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useMutation<void, Error, PurchaseId>({
    mutationFn: async (id) => {
      await API.delete(`/purchases/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: purchaseKeys.all(activeBranchId) });
      qc.invalidateQueries({ queryKey: ['products', activeBranchId] });
    },
  });
}

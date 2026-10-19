import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import type { BranchId } from '@inventory/shared';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface IInventoryAdjustment {
  _id: string;
  inventory_id: string;
  product_id: {
    _id: string;
    name: string;
    barcode: string;
    price: number;
  };
  branch_id: string;
  owner_id: string;
  type: string;
  quantity_change: number | string;
  previous_quantity: number | string;
  new_quantity: number | string;
  created_by: string;
  reason: string;
  idempotency_key?: string;
  createdAt: string;
  updatedAt: string;
  // mapped fields
  difference: number;
  previous_stock: number;
  new_stock: number;
}

export interface AdjustmentsResponse {
  success: boolean;
  adjustments: IInventoryAdjustment[];
  total: number;
  totalPages: number;
  currentPage: number;
  fromCache?: boolean;
}

export interface CreateAdjustmentPayload {
  product_id: string;
  branch_id?: string;
  quantity: number;
  reason: 'INITIAL_INVENTORY' | 'CORRECTION' | 'LOSS' | 'DAMAGE' | 'EXPIRED';
  notes?: string;
}

// ─── Claves de Caché ────────────────────────────────────────────────────────

export const adjustmentKeys = {
  all: ['adjustments'] as const,
  list: (branchId: BranchId | null, page: number, limit: number) => 
    [...adjustmentKeys.all, 'list', branchId, page, limit] as const,
};

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** Obtiene el historial de ajustes paginado */
export function useAdjustmentsQuery(branchId: BranchId | null, page = 1, limit = 20) {
  return useQuery<AdjustmentsResponse>({
    queryKey: adjustmentKeys.list(branchId, page, limit),
    queryFn: async ({ signal }) => {
      const res = await api.get(`/adjustments?page=${page}&limit=${limit}`, { signal });
      return res.data;
    },
    enabled: true,
  });
}

/** Crea un nuevo ajuste de stock */
export function useCreateAdjustment() {
  const qc = useQueryClient();
  
  return useMutation<{ success: boolean; data: any }, Error, CreateAdjustmentPayload>({
    mutationFn: async (payload) => {
      // Generamos un idempotency key simple basado en tiempo para evitar clicks dobles
      const idempotencyKey = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const res = await api.post('/adjustments', payload, {
        headers: {
          'Idempotency-Key': idempotencyKey
        }
      });
      return res.data;
    },
    onSuccess: () => {
      // Invalidar historial de ajustes
      qc.invalidateQueries({ queryKey: adjustmentKeys.all });
      // Invalidar productos porque el stock ha cambiado
      qc.invalidateQueries({ queryKey: ['products', useAuthStore.getState().activeBranchId] });
    },
  });
}

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import type { IStockTransfer, CreateStockTransferDTO } from '@inventory/shared';
import type { BranchId, StockTransferId } from '@inventory/shared';
import { productKeys } from './useProductQueries';
import { transferProductKeys } from './useProductQueries';

export const stockTransferKeys = {
  all: ['stock-transfers'] as const,
  list: (branchId: BranchId | null) => [...stockTransferKeys.all, 'list', branchId] as const,
  detail: (id: StockTransferId) => [...stockTransferKeys.all, 'detail', id] as const,
};

export interface CreateStockTransferPayload {
  destination_branch_id: BranchId;
  items: { product_id: string; quantity: number }[];
  notes?: string;
}

export interface UpdateStockTransferStatusPayload {
  status: 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  notes?: string;
}

/** Obtiene las transferencias asociadas a la sucursal activa (como origen o destino) */
export function useStockTransfersQuery(branchId: BranchId | null) {
  return useQuery<IStockTransfer[]>({
    queryKey: stockTransferKeys.list(branchId),
    queryFn: async ({ signal }) => {
      if (!branchId) return [];
      const res = await api.get('/stock-transfers', { signal });
      return res.data.transfers ?? res.data.data ?? res.data;
    },
    enabled: !!branchId,
  });
}

export interface CreateStockTransferVariables {
  payload: CreateStockTransferDTO;
  idempotencyKey: string;
}

/** Crea una nueva transferencia de stock */
export function useCreateStockTransfer() {
  const qc = useQueryClient();

  return useMutation<
    any,
    Error,
    CreateStockTransferVariables
  >({
    mutationFn: async ({ payload, idempotencyKey }) => {
      const res = await api.post('/transfers', payload, {
        headers: {
          'x-idempotency-key': idempotencyKey,
        },
      });

      return res.data;
    },

    onSuccess: async (_data, { payload }) => {
      await Promise.all([
        qc.invalidateQueries({
          queryKey: transferProductKeys.byBranch(payload.sourceBranchId),
        }),
        qc.invalidateQueries({
          queryKey: transferProductKeys.byBranch(payload.destinationBranchId),
        }),
        qc.invalidateQueries({
          queryKey: productKeys.all(payload.sourceBranchId),
        }),
        qc.invalidateQueries({
          queryKey: productKeys.all(payload.destinationBranchId),
        }),
        qc.invalidateQueries({
          queryKey: stockTransferKeys.list(payload.sourceBranchId),
        }),
        qc.invalidateQueries({
          queryKey: stockTransferKeys.list(payload.destinationBranchId),
        }),
      ]);
    },
  });
}

/** Actualiza el estado de una transferencia (Recibir, Rechazar, Cancelar) */
export function useUpdateStockTransferStatus() {
  const qc = useQueryClient();
  return useMutation<IStockTransfer, Error, { id: StockTransferId; payload: UpdateStockTransferStatusPayload }>({
    mutationFn: async ({ id, payload }) => {
      const res = await api.put(`/stock-transfers/${id}/status`, payload);
      return res.data.transfer ?? res.data.data ?? res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stockTransferKeys.all });
      // Invalidar productos porque el stock ha cambiado
      qc.invalidateQueries({ queryKey: ['products', useAuthStore.getState().activeBranchId] });
    },
  });
}

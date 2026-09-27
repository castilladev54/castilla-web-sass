import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { productKeys, transferProductKeys } from './useProductQueries';
import { stockTransferKeys, useCreateStockTransfer } from './useStockTransferQueries';
import { api as API } from '../../api/axiosClient';
import type {
  BranchId,
  ProductId,
  CreateStockTransferDTO,
} from '@inventory/shared';

const sourceBranchId = 'branch-A' as BranchId;
const destinationBranchId = 'branch-B' as BranchId;
const productId = 'product-1' as ProductId;

vi.mock('../../api/axiosClient', () => ({
  api: {
    post: vi.fn(),
  },
}));

describe('useCreateStockTransfer', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('debe enviar el payload a /transfers e invalidar origen y destino al tener éxito', async () => {
    const payload: CreateStockTransferDTO = {
      sourceBranchId,
      destinationBranchId,
      items: [{ product_id: productId, quantity: '10' }],
    };

    const mockResponse = {
      data: {
        success: true,
        transfer_id: 't-1',
      },
    };

    vi.mocked(API.post).mockResolvedValueOnce(mockResponse);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateStockTransfer(), { wrapper });

    result.current.mutate(payload);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(API.post).toHaveBeenCalledWith('/transfers', payload);
    expect(result.current.data).toEqual(mockResponse.data);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: transferProductKeys.byBranch(sourceBranchId),
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: transferProductKeys.byBranch(destinationBranchId),
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: productKeys.all(sourceBranchId),
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: productKeys.all(destinationBranchId),
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: stockTransferKeys.list(sourceBranchId),
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: stockTransferKeys.list(destinationBranchId),
    });
  });

  it('no debe limpiar ni invalidar nada si el backend devuelve un error', async () => {
    const payload: CreateStockTransferDTO = {
      sourceBranchId,
      destinationBranchId,
      items: [{ product_id: productId, quantity: '5' }],
    };

    vi.mocked(API.post).mockRejectedValueOnce(
      new Error('Error del servidor'),
    );

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateStockTransfer(), { wrapper });

    result.current.mutate(payload);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
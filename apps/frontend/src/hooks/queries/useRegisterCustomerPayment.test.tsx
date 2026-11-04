import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import {
  saleKeys,
  useRegisterCustomerPayment,
  type RegisterCustomerPaymentPayload,
} from './useSaleQueries';

import { api as API } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import type { SaleId, BranchId } from '@inventory/shared';

vi.mock('../../api/axiosClient', () => ({
  api: {
    post: vi.fn(),
  },
}));

describe('useRegisterCustomerPayment', () => {
  let queryClient: QueryClient;

  const branchId = 'branch-A' as BranchId;

  const payload: RegisterCustomerPaymentPayload = {
    saleId: 'sale-1' as SaleId,
    amountReceived: '25.00',
    currency: 'USD',
    paymentMethod: 'Efectivo',
    exchangeRateType: 'NO_APLICA',
    idempotencyKey: 'payment-key-001',
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    vi.clearAllMocks();

    useAuthStore.getState().setActiveBranch(branchId);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  it('envía el pago con la sucursal y clave de idempotencia', async () => {
    const mockResponse = {
      data: {
        success: true,
        message: 'Abono registrado',
        payment: {},
        sale: {},
        remainingBalance: '75.00',
        isDuplicate: false,
      },
    };

    vi.mocked(API.post).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(
      () => useRegisterCustomerPayment(),
      { wrapper },
    );

    const response = await result.current.mutateAsync(payload);

    expect(API.post).toHaveBeenCalledWith(
      '/sales/sale-1/payments',
      {
        amountReceived: '25.00',
        currency: 'USD',
        paymentMethod: 'Efectivo',
        exchangeRateType: 'NO_APLICA',
      },
      {
        headers: {
          'x-branch-id': branchId,
          'x-idempotency-key': 'payment-key-001',
        },
      },
    );

    expect(response).toEqual(mockResponse.data);
  });

  it('rechaza el registro si no existe una sucursal activa', async () => {
    useAuthStore.getState().setActiveBranch(null);

    const { result } = renderHook(
      () => useRegisterCustomerPayment(),
      { wrapper },
    );

    await expect(
      result.current.mutateAsync(payload),
    ).rejects.toThrow(
      'No hay una sucursal activa seleccionada.',
    );

    expect(API.post).not.toHaveBeenCalled();
  });

  it('invalida las ventas de la sucursal activa después del éxito', async () => {
    vi.mocked(API.post).mockResolvedValueOnce({
      data: {
        success: true,
        message: 'Abono registrado',
        payment: {},
        sale: {},
        remainingBalance: '75.00',
        isDuplicate: false,
      },
    });

    const invalidateSpy = vi.spyOn(
      queryClient,
      'invalidateQueries',
    );

    const { result } = renderHook(
      () => useRegisterCustomerPayment(),
      { wrapper },
    );

    await result.current.mutateAsync(payload);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: saleKeys.all(branchId),
      });
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('no invalida las ventas cuando el servidor rechaza el pago', async () => {
    vi.mocked(API.post).mockRejectedValueOnce(
      new Error('Error del servidor'),
    );

    const invalidateSpy = vi.spyOn(
      queryClient,
      'invalidateQueries',
    );

    const { result } = renderHook(
      () => useRegisterCustomerPayment(),
      { wrapper },
    );

    await expect(
      result.current.mutateAsync(payload),
    ).rejects.toThrow('Error del servidor');

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});


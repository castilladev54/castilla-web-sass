import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Sale } from '@inventory/shared';

import ReceivablesManager from './ReceivablesManager';
import {
  useSalesQuery,
  useRegisterCustomerPayment,
} from '../hooks/queries/useSaleQueries';
import { useExchangeRateQuery } from '../hooks/queries/useExchangeRateQueries';

// Polyfill crypto.randomUUID for JSDOM environments where it may be missing
if (typeof crypto === 'undefined' || !(crypto as any).randomUUID) {
  (globalThis as any).crypto = { randomUUID: () => 'test-idempotency-key' };
}

vi.mock('../hooks/queries/useSaleQueries', () => ({
  useSalesQuery: vi.fn(),
  useRegisterCustomerPayment: vi.fn(),
}));

vi.mock('../hooks/queries/useExchangeRateQueries', () => ({
  useExchangeRateQuery: vi.fn(),
}));

const mockRefetch = vi.fn();
const mockMutateAsync = vi.fn();

type ReceivableSale = Sale & {
  paid_amount?: string;
  remaining_balance?: string;
};

const sale: ReceivableSale = {
  _id: 'sale-001' as Sale['_id'],
  total_amount: '100.00',
  exchange_rate: null,
  payment_method: 'Efectivo',
  status: 'pending',
  sold_by: null,
  customer_id: {
    _id: 'customer-001',
    name: 'Cliente de prueba',
  },
  branch_id: 'branch-001' as Sale['branch_id'],
  items: [],
  is_credit_sale: true,
  createdAt: '2026-11-01T12:00:00.000Z',
  paid_amount: '30.00',
  remaining_balance: '70.00',
};

function configureSalesQuery(
  overrides: Record<string, unknown> = {},
) {
  vi.mocked(useSalesQuery).mockReturnValue({
    data: {
      sales: [sale],
      total: 1,
      totalPages: 1,
      currentPage: 1,
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: mockRefetch,
    ...overrides,
  } as unknown as ReturnType<typeof useSalesQuery>);
}

afterEach(() => {
  cleanup();
});

describe('ReceivablesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureSalesQuery();
    vi.mocked(useRegisterCustomerPayment).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useRegisterCustomerPayment>);
    vi.mocked(useExchangeRateQuery).mockReturnValue({
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useExchangeRateQuery>);
  });

  it('renderiza las cuentas pendientes con sus saldos', () => {
    render(<ReceivablesManager />);
    expect(
      screen.getByRole('heading', { name: 'Cuentas por Cobrar' })
    ).not.toBeNull();
    expect(screen.getByText('Cliente de prueba')).not.toBeNull();
    expect(screen.getByText('$100.00')).not.toBeNull();
    expect(screen.getByText('$30.00')).not.toBeNull();
    expect(screen.getByText('$70.00')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Registrar abono' })
    ).not.toBeNull();
  });

  it('consulta las cuentas saldadas al cambiar de pestaña', async () => {
    render(<ReceivablesManager />);
    const tablist = screen.getByRole('tablist');
    fireEvent.click(
      within(tablist).getByRole('tab', { name: 'Saldadas' })
    );
    await waitFor(() => {
      expect(useSalesQuery).toHaveBeenLastCalledWith({
        page: 1,
        limit: 10,
        status: 'completed',
        is_credit_sale: true,
      });
    });
  });

  it('muestra el error y permite reintentar la consulta', () => {
    configureSalesQuery({
      isError: true,
      data: {
        sales: [],
        total: 0,
        totalPages: 1,
        currentPage: 1,
      },
    });
    render(<ReceivablesManager />);
    expect(
      screen.getByText(/No se pudieron actualizar las cuentas por cobrar/)
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('conserva los datos anteriores y advierte si falla la actualización', () => {
    configureSalesQuery({ isError: true });
    render(<ReceivablesManager />);
    expect(screen.getByText('Cliente de prueba')).not.toBeNull();
    expect(
      screen.getByText(/datos anteriores, que podrían estar desactualizados/)
    ).not.toBeNull();
  });

  it('muestra el estado vacío cuando no existen cuentas pendientes', () => {
    configureSalesQuery({
      data: {
        sales: [],
        total: 0,
        totalPages: 1,
        currentPage: 1,
      },
    });
    render(<ReceivablesManager />);
    expect(
      screen.getByText('No hay cuentas pendientes.')
    ).not.toBeNull();
    expect(
      screen.getByText('Las ventas a crédito aparecerán aquí.')
    ).not.toBeNull();
  });

  // New tests
  it('abre y cierra el modal de registro de abono', async () => {
    render(<ReceivablesManager />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar abono' })
    );
    expect(
      screen.getByRole('heading', { name: 'Registrar abono' })
    ).not.toBeNull();
    expect(screen.getByLabelText('Importe recibido')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Registrar abono' })
      ).toBeNull();
    });
  });

  it('rechaza un importe inválido sin registrar el abono', async () => {
    render(<ReceivablesManager />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar abono' })
    );

    fireEvent.change(screen.getByLabelText('Importe recibido'), {
      target: { value: '0' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar abono' })
    );

    expect(
      await screen.findByText(
        'Ingresa un importe mayor que cero con máximo dos decimales.'
      ),
    ).not.toBeNull();

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockRefetch).not.toHaveBeenCalled();
  });


  // New test: successful USD payment
  it('registra correctamente un abono en USD', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      success: true,
    });

    render(<ReceivablesManager />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar abono' })
    );

    fireEvent.change(screen.getByLabelText('Importe recibido'), {
      target: { value: '25.50' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar abono' })
    );

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const payload = mockMutateAsync.mock.calls[0]?.[0];

    expect(payload).toEqual({
      saleId: sale._id,
      amountReceived: '25.50',
      currency: 'USD',
      paymentMethod: 'Efectivo',
      exchangeRate: undefined,
      exchangeRateType: 'NO_APLICA',
      idempotencyKey: expect.any(String),
    });

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Registrar abono' })
      ).toBeNull();
    });
  });

  it('rechaza un abono en VES si no existe tasa comercial manual', async () => {
    const mockRateRefetch = vi.fn().mockResolvedValue({
      data: {
        rate: '450.00',
        is_manual_override: false,
      },
      error: null,
    });

    vi.mocked(useExchangeRateQuery).mockReturnValue({
      refetch: mockRateRefetch,
    } as unknown as ReturnType<typeof useExchangeRateQuery>);

    render(<ReceivablesManager />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar abono' }),
    );

    fireEvent.change(screen.getByLabelText('Importe recibido'), {
      target: { value: '100.00' },
    });

    fireEvent.change(screen.getByLabelText('Moneda recibida'), {
      target: { value: 'VES' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar abono' }),
    );

    expect(
      await screen.findByText(
        'No existe una tasa comercial vigente. Actualiza la tasa antes de registrar el abono.',
      ),
    ).not.toBeNull();

    expect(mockRateRefetch).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});

import { useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { CreditCard, Wallet, X, Loader2 } from 'lucide-react';

import DataTable, {
  type DataTableColumn,
} from './organisms/DataTable';
import Modal from './molecules/Modal';

import {
  useSalesQuery,
  useRegisterCustomerPayment,
  type CustomerPaymentMethod,
} from '../hooks/queries/useSaleQueries';
import { useExchangeRateQuery } from '../hooks/queries/useExchangeRateQueries';

const PAGE_SIZE = 10;

type ReceivableTab = 'pending' | 'completed';

type ReceivableSale = NonNullable<
  ReturnType<typeof useSalesQuery>['data']
>['sales'][number];

const PAYMENT_METHODS: CustomerPaymentMethod[] = [
  'Efectivo',
  'Divisas',
  'Tarjeta',
  'Pago Movil',
  'Transferencia',
  'Zelle',
  'BIOPAGO',
];

function formatUSD(value: string | undefined): string {
  const amount = Number(value ?? '0');

  if (!Number.isFinite(amount)) return '$0.00';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getCustomerName(
  customer: { name?: string } | string | null | undefined,
): string {
  if (!customer) return 'Cliente no disponible';

  if (typeof customer === 'string') return 'Cliente registrado';

  return customer.name || 'Cliente sin nombre';
}

function getPaymentError(error: unknown): string {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ??
      'No se pudo registrar el abono. Intenta nuevamente.'
    );
  }

  return error instanceof Error
    ? error.message
    : 'Ocurrió un error inesperado.';
}

export default function ReceivablesManager() {
  const [activeTab, setActiveTab] = useState<ReceivableTab>('pending');
  const [page, setPage] = useState(1);
  const [selectedSale, setSelectedSale] =
    useState<ReceivableSale | null>(null);

  const [amountReceived, setAmountReceived] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'VES'>('USD');
  const [paymentMethod, setPaymentMethod] =
    useState<CustomerPaymentMethod>('Efectivo');
  const [paymentError, setPaymentError] = useState('');

  const idempotencyKeyRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

  const salesQuery = useSalesQuery({
    page,
    limit: PAGE_SIZE,
    status: activeTab,
    is_credit_sale: true,
  });

  const paymentMutation = useRegisterCustomerPayment();
  const exchangeRateQuery = useExchangeRateQuery();

  const sales = salesQuery.data?.sales ?? [];
  const total = salesQuery.data?.total ?? 0;
  const totalPages = salesQuery.data?.totalPages ?? 1;

  const isPaymentPending = paymentMutation.isPending;

  const handleTabChange = (tab: ReceivableTab) => {
    setActiveTab(tab);
    setPage(1);
    setSelectedSale(null);
    setPaymentError('');
  };

  const openPaymentModal = (sale: ReceivableSale) => {
    setSelectedSale(sale);
    setAmountReceived('');
    setCurrency('USD');
    setPaymentMethod('Efectivo');
    setPaymentError('');
  };

  const closePaymentModal = () => {
    if (isPaymentPending) return;

    setSelectedSale(null);
    setAmountReceived('');
    setPaymentError('');
  };

  const handleRegisterPayment = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!selectedSale) return;

    // Validación de formato. El backend sigue siendo responsable
    // de validar el importe, el saldo y las reglas financieras.
    const rawAmount = amountReceived.trim();
    let normalizedAmount = rawAmount;

    if (currency === 'VES') {
      // Formato venezolano: 10,50 | 1.234,56 | 1.234.567,89
      const venezuelanFormat = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;

      if (!venezuelanFormat.test(rawAmount)) {
        setPaymentError(
          'Ingresa un importe en formato venezolano. Ejemplo: 10.123,56.',
        );
        return;
      }

      // Convertir a formato decimal canónico para el backend.
      normalizedAmount = rawAmount
        .replace(/\./g, '')
        .replace(',', '.');
    } else {
      // USD conserva exactamente la validación anterior.
      if (
        !/^\d+(\.\d{1,2})?$/.test(rawAmount) ||
        !/[1-9]/.test(rawAmount)
      ) {
        setPaymentError(
          'Ingresa un importe mayor que cero con máximo dos decimales.',
        );
        return;
      }
    }

    if (!/[1-9]/.test(normalizedAmount)) {
      setPaymentError('El importe debe ser mayor que cero.');
      return;
    }

    setPaymentError('');

    try {
      let exchangeRate: string | undefined;
      const exchangeRateType =
        currency === 'VES' ? 'COMERCIAL' : 'NO_APLICA';

      if (currency === 'VES') {
        const rateResult = await exchangeRateQuery.refetch();

        if (rateResult.error) {
          throw rateResult.error;
        }

        if (
          !rateResult.data ||
          !rateResult.data.is_manual_override
        ) {
          throw new Error(
            'No existe una tasa comercial vigente. Actualiza la tasa antes de registrar el abono.',
          );
        }

        exchangeRate = rateResult.data.rate;
      }

      // La misma combinación de datos conserva la misma clave
      // cuando el usuario reintenta una solicitud fallida.
      const fingerprint = [
        selectedSale._id,
        normalizedAmount,
        currency,
        paymentMethod,
        exchangeRate ?? '',
      ].join('|');

      if (
        !idempotencyKeyRef.current ||
        idempotencyKeyRef.current.fingerprint !== fingerprint
      ) {
        idempotencyKeyRef.current = {
          fingerprint,
          key: crypto.randomUUID(),
        };
      }

      await paymentMutation.mutateAsync({
        saleId: selectedSale._id,
        amountReceived: normalizedAmount,
        currency,
        paymentMethod,
        exchangeRate,
        exchangeRateType,
        idempotencyKey: idempotencyKeyRef.current.key,
      });

      // Solo se elimina la clave después de confirmar el éxito.
      idempotencyKeyRef.current = null;
      setSelectedSale(null);
      setAmountReceived('');
      setPaymentError('');
    } catch (error: unknown) {
      setPaymentError(getPaymentError(error));
    }
  };

  const columns: DataTableColumn<ReceivableSale>[] = [
    {
      key: 'customer_id',
      label: 'Cliente',
      render: (_value, sale) => (
        <span className="font-medium text-white">
          {getCustomerName(sale.customer_id)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Fecha',
      render: (_value, sale) =>
        new Date(sale.createdAt).toLocaleDateString('es-VE'),
    },
    {
      key: 'total_amount',
      label: 'Total',
      render: (_value, sale) => formatUSD(sale.total_amount),
    },
    {
      key: 'paid_amount',
      label: 'Abonado',
      render: (_value, sale) => formatUSD(sale.paid_amount),
    },
    {
      key: 'remaining_balance',
      label: 'Saldo pendiente',
      render: (_value, sale) => (
        <span
          className={
            activeTab === 'pending'
              ? 'font-semibold text-amber-400'
              : 'font-semibold text-emerald-400'
          }
        >
          {formatUSD(sale.remaining_balance)}
        </span>
      ),
    },
    {
      key: '__display_actions',
      label: 'Acciones',
      display: true,
      render: (_value, sale) =>
        activeTab === 'pending' ? (
          <button
            type="button"
            onClick={() => openPaymentModal(sale)}
            className="px-3 py-2 rounded-lg bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors text-sm font-medium"
          >
            Registrar abono
          </button>
        ) : null,
    },
  ];

  return (
    <section
      className="p-4 sm:p-6 lg:p-8 space-y-6 text-white max-w-7xl mx-auto"
      aria-labelledby="receivables-heading"
    >
      <header>
        <h1
          id="receivables-heading"
          className="flex items-center gap-3 text-2xl font-bold"
        >
          <Wallet className="text-orange-400" size={28} />
          Cuentas por Cobrar
        </h1>

        <p className="mt-1 text-sm text-gray-400">
          Consulta las ventas a crédito y controla sus saldos.
        </p>
      </header>

      <div
        className="flex flex-wrap gap-3"
        role="tablist"
        aria-label="Estado de las cuentas por cobrar"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pending'}
          onClick={() => handleTabChange('pending')}
          className={`px-5 py-3 rounded-xl text-sm font-medium transition-colors ${
            activeTab === 'pending'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
          }`}
        >
          Pendientes
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'completed'}
          onClick={() => handleTabChange('completed')}
          className={`px-5 py-3 rounded-xl text-sm font-medium transition-colors ${
            activeTab === 'completed'
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
          }`}
        >
          Saldadas
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <CreditCard size={16} />
          {total} {total === 1 ? 'venta' : 'ventas'}
        </div>
      </div>

      {salesQuery.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4"
        >
          <p className="text-sm text-red-300">
            No se pudieron actualizar las cuentas por cobrar.
            {sales.length > 0 &&
              ' Se muestran los datos anteriores, que podrían estar desactualizados.'}
          </p>

          <button
            type="button"
            onClick={() => void salesQuery.refetch()}
            disabled={salesQuery.isFetching}
            className="rounded-lg border border-red-400/30 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {salesQuery.isFetching ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={sales}
        isLoading={salesQuery.isLoading}
        emptyMessage={
          activeTab === 'pending'
            ? 'No hay cuentas pendientes.'
            : 'No hay cuentas saldadas.'
        }
        emptyDetail="Las ventas a crédito aparecerán aquí."
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        getRowKey={(sale) => sale._id}
      />

      <Modal
        isOpen={Boolean(selectedSale)}
        onClose={isPaymentPending ? () => {} : closePaymentModal}
        title="Registrar abono"
        icon={<CreditCard className="text-orange-400" size={22} />}
      >
        {selectedSale && (
          <form onSubmit={handleRegisterPayment} className="space-y-5">
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-2">
              <p className="text-sm text-gray-400">Cliente</p>
              <p className="font-semibold">
                {getCustomerName(selectedSale.customer_id)}
              </p>

              <div className="flex justify-between gap-4 pt-2">
                <span className="text-sm text-gray-400">
                  Saldo pendiente
                </span>
                <span className="font-bold text-amber-400">
                  {formatUSD(selectedSale.remaining_balance)}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="payment-amount"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Importe recibido
              </label>
              <input
                id="payment-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amountReceived}
                onChange={(event) =>
                  setAmountReceived(event.target.value)
                }
                placeholder={currency === 'VES' ? '0,00' : '0.00'}
                disabled={isPaymentPending}
                className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-white outline-none focus:border-orange-400 disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="payment-currency"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Moneda recibida
              </label>
              <select
                id="payment-currency"
                value={currency}
                onChange={(event) =>
                  setCurrency(event.target.value as 'USD' | 'VES')
                }
                disabled={isPaymentPending}
                className="w-full rounded-lg bg-[#252532] border border-white/10 px-4 py-3 text-white outline-none focus:border-orange-400"
              >
                <option value="USD">Dólares (USD)</option>
                <option value="VES">Bolívares (VES)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="payment-method"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Método de pago
              </label>
              <select
                id="payment-method"
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(
                    event.target.value as CustomerPaymentMethod,
                  )
                }
                disabled={isPaymentPending}
                className="w-full rounded-lg bg-[#252532] border border-white/10 px-4 py-3 text-white outline-none focus:border-orange-400"
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>

            {currency === 'VES' && (
              <p className="text-sm text-gray-400">
                Se utilizará la tasa comercial vigente. La tasa será
                verificada nuevamente por el servidor al registrar el pago.
              </p>
            )}

            {paymentError && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
              >
                {paymentError}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closePaymentModal}
                disabled={isPaymentPending}
                className="px-4 py-2 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={isPaymentPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {isPaymentPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Registrando...
                  </>
                ) : (
                  'Confirmar abono'
                )}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

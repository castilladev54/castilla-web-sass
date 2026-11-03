import { useState } from 'react';
import { CreditCard, Wallet } from 'lucide-react';

import DataTable, {
  type DataTableColumn,
} from './organisms/DataTable';

import { useSalesQuery } from '../hooks/queries/useSaleQueries';

const PAGE_SIZE = 10;

type ReceivableTab = 'pending' | 'completed';

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

export default function ReceivablesManager() {
  const [activeTab, setActiveTab] = useState<ReceivableTab>('pending');
  const [page, setPage] = useState(1);

  const salesQuery = useSalesQuery({
    page,
    limit: PAGE_SIZE,
    status: activeTab,
    is_credit_sale: true,
  });

  const sales = salesQuery.data?.sales ?? [];
  const total = salesQuery.data?.total ?? 0;
  const totalPages = salesQuery.data?.totalPages ?? 1;

  const handleTabChange = (tab: ReceivableTab) => {
    setActiveTab(tab);
    setPage(1);
  };

  const columns: DataTableColumn<(typeof sales)[number]>[] = [
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
    </section>
  );
}

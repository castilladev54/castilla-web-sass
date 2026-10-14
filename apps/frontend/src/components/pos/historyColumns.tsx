import type { SaleDetailDTO, SaleId } from '@inventory/shared';
import { fmtUSD } from '../../utils/salesFormatters';
import { toBs } from '../../utils/currency';
import Badge from '../atoms/Badge';
import { Eye, Printer } from 'lucide-react';
import { DataTableColumn } from '../organisms/DataTable.types';

/**
 * Genera las definiciones de columnas para la tabla de historial de ventas.
 * Usa SaleDetailDTO como fuente de verdad — sin casts, sin flotantes.
 */
export const buildHistoryColumns = (
  onView: (id: SaleId) => void,
  exchangeRate: string,
  onPrint?: (sale: SaleDetailDTO) => void
): DataTableColumn<SaleDetailDTO>[] => [
  {
    key: 'createdAt',
    label: 'Fecha',
    render: (value) => {
      const date = new Date(value as string);
      return (
        <div className="text-gray-300 text-sm">
          {date.toLocaleDateString()}
          <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
            {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      );
    },
  },
  {
    key: 'sold_by',
    label: 'Vendedor',
    render: (value) => value?.name ?? '—',
  },
  {
    key: 'payment_method',
    label: 'Método Pago',
  },
  {
    key: 'status',
    label: 'Estado',
    render: (value) => {
      const val = value as string;
      if (val === 'cancelled' || val === 'Anulada') {
        return <Badge variant="danger">Anulada</Badge>;
      }
      if (val === 'pending') {
        return <Badge variant="warning">Pendiente</Badge>;
      }
      return <Badge variant="success">Completada</Badge>;
    },
  },
  {
    key: 'total_amount',
    label: 'Total',
    render: (value, row) => {
      const amount = value;
      const rate = row.exchange_rate;
      const bs = toBs(amount, rate ?? exchangeRate);
      return (
        <div>
          <div className="text-amber-500 font-medium text-sm sm:text-base">{fmtUSD(amount)}</div>
          <p className="text-[10px] sm:text-xs text-blue-400 mt-0.5">Bs {bs}</p>
        </div>
      );
    },
  },
  {
    key: '_id',
    label: 'Acciones',
    render: (_, row) => (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onView(row._id as SaleId)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-lg transition-colors"
        >
          <Eye size={14} /> Ver
        </button>
        {onPrint && (
          <button
            type="button"
            onClick={() => onPrint(row)}
            title="Imprimir Comprobante"
            className="flex items-center justify-center p-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors"
          >
            <Printer size={14} />
          </button>
        )}
      </div>
    ),
  },
];


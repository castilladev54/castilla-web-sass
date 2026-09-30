import { useState } from 'react';
import { Plus, Archive } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useAdjustmentsQuery, IInventoryAdjustment } from '../../hooks/queries/useAdjustmentQueries';
import Button from '../atoms/Button';
import Badge from '../atoms/Badge';
import DataTable, { DataTableColumn } from '../organisms/DataTable';
import CreateAdjustmentModal from './CreateAdjustmentModal';

const REASON_LABELS: Record<string, string> = {
  INITIAL_INVENTORY: 'Inventario Inicial',
  CORRECTION: 'Corrección',
  LOSS: 'Pérdida',
  DAMAGE: 'Dañado',
  EXPIRED: 'Caducado',
};

const REASON_COLORS: Record<string, string> = {
  INITIAL_INVENTORY: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CORRECTION: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  LOSS: 'bg-red-500/20 text-red-400 border-red-500/30',
  DAMAGE: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  EXPIRED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

const AdjustmentManager = () => {
  const { activeBranchId } = useAuthStore();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useAdjustmentsQuery(activeBranchId ?? null, page, limit);
  const adjustments = data?.adjustments || [];
  const totalPages = data?.totalPages || 1;

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const columns: DataTableColumn<any>[] = [
    {
      key: 'createdAt',
      label: 'Fecha',
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      key: 'product',
      label: 'Producto',
      render: (_: any, row: any) => (
        <div>
          <div className="font-medium">{row.product_id?.name || 'Producto Desconocido'}</div>
          <div className="text-xs text-gray-500">{row.product_id?.barcode || 'Sin código'}</div>
        </div>
      ),
    },
    {
      key: 'reason',
      label: 'Motivo',
      render: (val: string) => (
        <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${REASON_COLORS[val] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
          {REASON_LABELS[val] || val}
        </span>
      ),
    },
    {
      key: 'previous_stock',
      label: 'Stock Anterior',
      render: (val: number) => <span className="text-gray-400">{val}</span>,
    },
    {
      key: 'difference',
      label: 'Variación',
      render: (val: number, row: any) => {
        const diff = (row.quantity_change ?? 0);
        return (
          <span className={`font-semibold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {diff > 0 ? `+${diff}` : diff}
          </span>
        );
      },
    },
    {
      key: 'new_stock',
      label: 'Nuevo Stock',
      render: (val: number) => <span className="font-bold text-white">{val}</span>,
    },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Archive className="text-orange-500" />
            Ajustes de Inventario
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Historial de correcciones y ajustes manuales en esta sucursal.
          </p>
        </div>
        
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-lg shadow-orange-500/20"
        >
          <Plus size={18} />
          Nuevo Ajuste
        </Button>
      </div>

      {/* Tabla de Ajustes */}
      <DataTable
        columns={columns}
        data={adjustments}
        isLoading={isLoading}
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyIcon={<Archive size={48} className="text-white/20" />}
        emptyMessage="No hay ajustes registrados"
        emptyDetail="Aún no se han realizado ajustes de stock en esta sucursal."
      />

      {/* Modal de Creación */}
      {isCreateModalOpen && (
        <CreateAdjustmentModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
        />
      )}
    </div>
  );
};

export default AdjustmentManager;

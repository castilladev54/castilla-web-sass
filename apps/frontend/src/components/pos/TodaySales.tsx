import React from 'react';
import DataTable from '../organisms/DataTable';
import { ShoppingCart } from 'lucide-react';
import { useSalesFilters } from '../../hooks/useSalesFilters';
import { useAuthStore } from '../../store/authStore';
import { useExchangeRateQuery } from '../../hooks/queries/useExchangeRateQueries';
import { toBs } from '../../utils/currency';
import { fmtUSD, fmtBs } from '../../utils/salesFormatters';
import { buildHistoryColumns } from './historyColumns';
import { useSaleDetailActions } from '../../hooks/useSaleDetailActions';
import SaleDetailView from './SaleDetailView';
import EditSaleModal from './EditSaleModal';

export default function TodaySales() {
  const { data: rateData } = useExchangeRateQuery();
  const exchangeRate = rateData?.rate ? String(rateData.rate) : "1";
  const { user } = useAuthStore();
  const {
    viewedSale,
    viewedSaleId,
    isLoading: isDetailLoading,
    isError: isDetailError,
    isEditModalOpen,
    openSaleDetail,
    openEditMode,
    closeModals,
    handleViewDetail,
    handleCancelSale,
    handleUpdateSale,
  } = useSaleDetailActions();
  const {
    sales,
    isLoading: isSalesLoading,
    currentPage,
    setCurrentPage,
    filteredTotal,
    totalPages,
    totalDocs,
    activeDateLabel,
    setDateFilter
  } = useSalesFilters();

  const initial = user?.name?.charAt(0).toUpperCase() || 'E';

  if (viewedSaleId) {
    if (isDetailLoading) {
      return (
        <div className="flex justify-center items-center h-64 bg-[#1a1a24] rounded-2xl border border-white/10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
          <span className="ml-3 text-gray-400">Cargando detalle de venta...</span>
        </div>
      );
    }
    
    if (isDetailError || !viewedSale) {
      return (
        <div className="flex flex-col justify-center items-center h-64 bg-[#1a1a24] rounded-2xl border border-white/10 text-center">
          <p className="text-red-400 mb-4">No se pudo cargar la información de la venta.</p>
          <button
            onClick={() => closeModals()}
            className="px-4 py-2 border border-white/20 rounded-lg text-white hover:bg-white/5 transition"
          >
            Volver a Ventas
          </button>
        </div>
      );
    }

    return (
      <>
        <SaleDetailView
          sale={viewedSale}
          onBack={() => closeModals()}
          userRole={user?.role}
          onCancel={() => handleCancelSale(viewedSale._id)}
          onEdit={() => openEditMode()}
        />
        <EditSaleModal
          isOpen={isEditModalOpen}
          onClose={() => closeModals()}
          sale={viewedSale}
          onSave={handleUpdateSale}
        />
      </>
    );
  }

  return (
    <>
      <div
        className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 mb-4
        bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent
        border border-orange-500/25 rounded-2xl"
      >
        <div
          className="w-11 h-11 rounded-full bg-orange-500/20 border border-orange-500/40
          flex items-center justify-center text-orange-400 font-bold text-xl shrink-0"
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-0.5">
            Mi Resumen
          </p>
          <p className="text-white font-bold text-base truncate">Mis Ventas (Sucursal Actual)</p>
          <p className="text-xs text-orange-400/70 mt-0.5">{activeDateLabel}</p>
        </div>
        <div className="flex gap-6 sm:gap-8">
          <div className="text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">
              Ventas
            </p>
            <p className="text-2xl font-extrabold text-white">{totalDocs}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">
              Total
            </p>
            <p className="text-2xl font-extrabold text-amber-500">{fmtUSD(filteredTotal)}</p>
            <p className="text-xs text-blue-400">{fmtBs(filteredTotal, exchangeRate)}</p>
          </div>
        </div>
      </div>

      <DataTable
        columns={buildHistoryColumns(handleViewDetail, exchangeRate)}
        data={sales as any}
        isLoading={isSalesLoading}
        emptyMessage={sales.length === 0 ? "Aún no hay ventas" : "Sin ventas en este período"}
        emptyIcon={<ShoppingCart size={30} />}
        emptyDetail={
          sales.length === 0
            ? "El historial de ventas está vacío."
            : "No se encontraron ventas con el filtro seleccionado."
        }
        emptyAction={
          sales.length > 0 ? { label: "Ver todas las ventas", onClick: () => setDateFilter("all") } : undefined
        }
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </>
  );
}





import React from 'react';
import DataTable from '../organisms/DataTable';
import Button from '../atoms/Button';
import { Calendar, ChevronDown, Check, X, MapPin, ShoppingCart } from 'lucide-react';
import { useSalesFilters, DATE_FILTER_OPTIONS } from '../../hooks/useSalesFilters';
import { useBranchesQuery } from '../../hooks/queries/useBranchQueries';
import { useExchangeRateQuery } from '../../hooks/queries/useExchangeRateQueries';
import { useStaffStore } from '../../store/staffStore';
import { toBs } from '../../utils/currency';
import { fmtUSD, fmtBs } from '../../utils/salesFormatters';
import { motion, AnimatePresence } from 'framer-motion';
import { buildHistoryColumns } from './historyColumns';
import { useSaleDetailActions } from '../../hooks/useSaleDetailActions';
import SaleDetailView from './SaleDetailView';
import EditSaleModal from './EditSaleModal';
import { useAuthStore } from '../../store/authStore';

export default function GlobalSalesHistory() {
  const { data: rateData } = useExchangeRateQuery();
  const exchangeRate = rateData?.rate ? String(rateData.rate) : "1";
  const { staff } = useStaffStore();
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
  const { data: branches = [] } = useBranchesQuery();
  const {
    sales,
    isLoading: isSalesLoading,
    dateFilter,
    setDateFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    sellerFilter,
    setSellerFilter,
    paymentFilter,
    setPaymentFilter,
    isDatePickerOpen,
    setIsDatePickerOpen,
    currentPage,
    setCurrentPage,
    datePickerRef,
    activeDateLabel,
    filteredTotal,
    totalPages,
    totalDocs,
    branchFilter,
    setBranchFilter,
  } = useSalesFilters();

  const seller = sellerFilter ? staff.find((e: any) => e._id === sellerFilter) : null;
  const initial = seller ? seller?.name?.charAt(0).toUpperCase() : 'Σ';
  const sellerName = seller ? seller.name : 'Todas las ventas';

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
          <Button variant="outline" onClick={() => closeModals()}>Volver a Ventas</Button>
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Selector de fecha */}
          <div className="relative" ref={datePickerRef}>
            <button
              type="button"
              onClick={() => setIsDatePickerOpen((p) => !p)}
              aria-expanded={isDatePickerOpen}
              aria-haspopup="true"
              aria-label={`Filtrar por fecha: ${activeDateLabel}`}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all
                ${
                  dateFilter !== "all" || dateFrom
                    ? "bg-orange-500/15 border-orange-500/40 text-orange-400"
                    : "bg-[#1a1a24] border-white/10 text-gray-300 hover:border-orange-500/40 hover:text-orange-400"
                }`}
            >
              <Calendar size={16} aria-hidden="true" />
              <span className="max-w-[160px] truncate">{activeDateLabel}</span>
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${
                  isDatePickerOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <AnimatePresence>
              {isDatePickerOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full mt-2 left-0 z-50 bg-[#1a1a24] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 p-4 min-w-[260px]"
                >
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                    Período rápido
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 mb-4">
                    {DATE_FILTER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setDateFilter(opt.value);
                          setDateFrom("");
                          setDateTo("");
                          setCurrentPage(1);
                          setIsDatePickerOpen(false);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all
                          ${
                            dateFilter === opt.value && !dateFrom
                              ? "bg-orange-500 text-black shadow-[0_0_10px_rgba(249,115,22,0.3)]"
                              : "bg-white/5 text-gray-300 hover:bg-orange-500/20 hover:text-orange-400 border border-white/5"
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                    Rango personalizado
                  </p>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label htmlFor="date-from" className="text-xs text-gray-400 mb-1 block">
                        Desde
                      </label>
                      <input
                        id="date-from"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:border-orange-500 focus:outline-none transition"
                      />
                    </div>
                    <div>
                      <label htmlFor="date-to" className="text-xs text-gray-400 mb-1 block">
                        Hasta
                      </label>
                      <input
                        id="date-to"
                        type="date"
                        value={dateTo}
                        min={dateFrom}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:border-orange-500 focus:outline-none transition"
                      />
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      disabled={!dateFrom || !dateTo}
                      onClick={() => {
                        setDateFilter("custom");
                        setCurrentPage(1);
                        setIsDatePickerOpen(false);
                      }}
                      className="mt-1"
                    >
                      <Check size={14} className="mr-1" /> Aplicar rango
                    </Button>
                    {(dateFilter !== "all" || dateFrom) && (
                      <button
                        type="button"
                        onClick={() => {
                          setDateFilter("all");
                          setDateFrom("");
                          setDateTo("");
                          setCurrentPage(1);
                          setIsDatePickerOpen(false);
                        }}
                        className="text-xs text-gray-500 hover:text-gray-300 text-center py-1 transition"
                      >
                        Limpiar filtro
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Filtro por Sucursal (solo para dueño/tenant) */}
          {branches.length > 1 && (
            <div className="flex items-center gap-2">
              <label htmlFor="branch-filter" className="sr-only">
                Filtrar por sucursal
              </label>
              <div className="flex items-center gap-1.5">
                <MapPin size={14} className="text-gray-500" aria-hidden="true" />
                <select
                  id="branch-filter"
                  aria-label="Filtrar por sucursal"
                  value={branchFilter || ""}
                  onChange={(e) => {
                    setBranchFilter(e.target.value || null);
                    setCurrentPage(1);
                  }}
                  className="bg-[#1a1a24] border border-white/10 rounded-xl px-3 py-1.5 text-sm text-gray-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition outline-none cursor-pointer"
                >
                  <option value="">Todas las sucursales</option>
                  {branches.map((b: any) => (
                    <option key={b._id} value={b._id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Filtro por Método de Pago */}
          <div className="flex items-center gap-2">
            <label htmlFor="payment-filter" className="sr-only">
              Filtrar por método de pago
            </label>
            <select
              id="payment-filter"
              aria-label="Filtrar por método de pago"
              value={paymentFilter}
              onChange={(e) => {
                setPaymentFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-[#1a1a24] border border-white/10 rounded-xl px-3 py-1.5 text-sm text-gray-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition outline-none cursor-pointer"
            >
              <option value="all">Todos los pagos</option>
              <option value="Efectivo">Efectivo</option>
              <option value="Divisas">Divisas</option>
              <option value="Punto de Venta">Punto de Venta</option>
              <option value="Tarjeta">Tarjeta</option>
              <option value="Pago Movil">Pago Móvil</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Zelle">Zelle</option>
            </select>
          </div>

          {/* Filtro por vendedor */}
          <div className="flex items-center gap-2">
            <label htmlFor="seller-filter" className="sr-only">
              Filtrar por vendedor
            </label>
            <select
              id="seller-filter"
              aria-label="Filtrar por vendedor"
              value={sellerFilter || ""}
              onChange={(e) => {
                setSellerFilter(e.target.value || null);
                setCurrentPage(1);
              }}
              className="bg-[#1a1a24] border border-white/10 rounded-xl px-3 py-1.5 text-sm text-gray-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition outline-none cursor-pointer"
            >
              <option value="">Todos los vendedores</option>
              {staff.map((emp: any) => (
                <option key={emp._id} value={emp._id}>
                  {emp.name}
                </option>
              ))}
            </select>
            {sellerFilter && (
              <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 px-3 py-1.5 rounded-xl text-xs font-medium">
                <span>
                  Filtrando: {staff.find((e: any) => e._id === sellerFilter)?.name || "Vendedor"}
                </span>
                <button
                  onClick={() => {
                    setSellerFilter(null);
                    setCurrentPage(1);
                  }}
                  aria-label="Limpiar filtro de vendedor"
                  className="hover:text-white transition"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
            {seller ? "Vendedor" : "Resumen Global"}
          </p>
          <p className="text-white font-bold text-base truncate">{sellerName}</p>
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
        {sellerFilter && (
          <button
            onClick={() => {
              setSellerFilter(null);
              setCurrentPage(1);
            }}
            aria-label="Quitar filtro de vendedor"
            className="text-gray-500 hover:text-white transition p-1 shrink-0"
          >
            <X size={18} />
          </button>
        )}
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





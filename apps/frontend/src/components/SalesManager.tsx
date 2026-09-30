import React, { useEffect, useState } from "react";
import { Plus, Wallet, HelpCircle } from "lucide-react";
import Button from "./atoms/Button";
import KBD from "./atoms/KBD";
import HelpModal from "./pos/HelpModal";

import CashShiftManagerModal from "./pos/CashShiftManagerModal";
import ExchangeRateBar from "./pos/ExchangeRateBar";
import { RateGuard } from "./pos/RateGuard";
import { RequireBranchGuard } from "./guards/RequireBranchGuard";

import { useAuthStore } from "../store/authStore";
import { useCurrentCashShiftQuery } from "../hooks/queries/useCashShiftQueries";
import { useExchangeRateQuery } from "../hooks/queries/useExchangeRateQueries";


import PosForm from "./pos/PosForm";
import TodaySales from "./pos/TodaySales";
import GlobalSalesHistory from "./pos/GlobalSalesHistory";

import { toBs } from "../utils/currency";
import type { SaleId, Sale } from "@inventory/shared";
import Badge from "./atoms/Badge";
import { fmtUSD } from "../utils/salesFormatters";



const SalesManagerInner = () => {
  const { user, activeBranchId } = useAuthStore();
  const { data: currentShift } = useCurrentCashShiftQuery(activeBranchId, user?._id);
  const { data: rateData } = useExchangeRateQuery();
  const exchangeRate = Number(rateData?.rate ?? 1);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isCashShiftModalOpen, setIsCashShiftModalOpen] = useState(false);

  // States for POS Form orchestration without coupling to usePOSCart
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = ['input', 'textarea', 'select'].includes(
        target.tagName.toLowerCase()
      );
      if (isInputFocused) return;

      if (e.key === 'F2') {
        e.preventDefault();
        if (!isFormOpen) {
          setIsFormOpen(true);
        }
      } else if (e.key === 'F1') {
        e.preventDefault();
        setShowHelp(p => !p);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFormOpen]);



  return (
    <section aria-labelledby="sales-heading" className={`w-full max-w-6xl mx-auto p-4 sm:p-6 ${!isFormOpen ? 'min-h-[70vh] flex flex-col items-center justify-center' : ''}`}>
      {/* Encabezado centrado cuando no hay formulario */}
      <header className={`flex flex-col gap-6 w-full ${!isFormOpen ? 'max-w-md items-center text-center' : 'mb-8'}`}>
        {!isFormOpen && (
          <h2 id="sales-heading" className="text-3xl sm:text-4xl font-extrabold text-white tracking-wide mb-2">
            {user?.role === "employee" ? (
              <>Mis <span className="text-orange-500">Ventas</span></>
            ) : (
              <>Punto de <span className="text-orange-500">Venta</span></>
            )}
          </h2>
        )}
        
        {isFormOpen && (
          <div className="flex justify-between w-full items-center">
            <h2 id="sales-heading" className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
              {user?.role === "employee" ? (
                <>Mis <span className="text-orange-500">Ventas</span></>
              ) : (
                <>Punto de <span className="text-orange-500">Venta</span></>
              )}
            </h2>
          </div>
        )}

        {!isFormOpen && (
          <div className="flex flex-col gap-4 w-full">
            <Button variant="primary" onClick={() => setIsFormOpen(true)} className="w-full h-16 text-lg shadow-lg shadow-orange-500/20">
              <Plus size={24} /> Nueva Venta <span className="ml-2"><KBD>F2</KBD></span>
            </Button>
            <Button
              variant={currentShift ? "ghost" : "danger"}
              onClick={() => setIsCashShiftModalOpen(true)}
              className={`w-full h-14 ${currentShift ? 'border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10' : 'animate-pulse'}`}
            >
              <Wallet size={20} />
              <span>
                {currentShift ? 'Turno Abierto' : 'Abrir Turno'}
              </span>
            </Button>
          </div>
        )}
        
        <div className={!isFormOpen ? "w-full mt-4" : "w-full"}>
          <ExchangeRateBar />
        </div>
      </header>

      {/* POS Formulario */}
      {isFormOpen && (
        <PosForm 
          onCancel={() => setIsFormOpen(false)}
          onOpenScanner={() => setIsScannerOpen(true)}
          onOpenCashShift={() => setIsCashShiftModalOpen(true)}
          isScannerOpen={isScannerOpen}
          isFormOpen={isFormOpen}
          isCartOpenExternal={isCartOpen}
          setIsCartOpenExternal={setIsCartOpen}
        />
      )}

      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />

      {!isFormOpen && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={() => setShowHelp(true)}
            aria-label="Ver atajos de teclado"
            className="flex items-center gap-2 px-3 py-2 bg-[#1a1a24]/90 border border-white/10 rounded-xl text-gray-400 hover:text-orange-400 hover:border-orange-500/30 transition backdrop-blur-sm shadow-lg"
          >
            <HelpCircle size={18} />
            <span className="text-xs font-medium">Atajos</span>
            <KBD>F1</KBD>
          </button>
        </div>
      )}

      <CashShiftManagerModal 
        isOpen={isCashShiftModalOpen} 
        onClose={() => setIsCashShiftModalOpen(false)} 
      />
    </section>
  );
};

export default function SalesManager() {
  return (
    <RequireBranchGuard>
      <RateGuard>
        <SalesManagerInner />
      </RateGuard>
    </RequireBranchGuard>
  );
}


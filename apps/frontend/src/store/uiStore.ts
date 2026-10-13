import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Pestañas disponibles en el Dashboard */
export type DashboardTab =
  | 'categories'
  | 'products'
  | 'purchases'
  | 'sales'
  | 'sales_history'
  | 'analytics'
  | 'staff'
  | 'customers'
  | 'transfers'
  | 'adjustments'
  | 'settings'
  | 'plans'
  | 'branches'
  | 'adminCreateUser';

interface UiState {
  /** Pestaña activa en el Dashboard */
  activeTab: DashboardTab;
  /** Estado de apertura del Sidebar en móvil */
  sidebarOpen: boolean;
  /** Modo oscuro activo */
  isDarkMode: boolean;

  // Actions
  setActiveTab: (tab: DashboardTab) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleDarkMode: () => void;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeTab: 'products',
      sidebarOpen: false,
      isDarkMode: true,

      setActiveTab: (tab) => set({ activeTab: tab }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),
    }),
    {
      name: 'ui-storage',
      // Solo persiste preferencias de usuario, no estado transitorio
      partialize: (state) => ({
        activeTab: state.activeTab,
        isDarkMode: state.isDarkMode,
      }),
    }
  )
);

import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useUiStore, DashboardTab } from '../store/uiStore';
import Sidebar from '../components/Sidebar';
import BranchSelector from '../components/BranchSelector';
import CategoryManager from '../components/CategoryManager';
import ProductManager from '../components/ProductManager';
import PurchaseManager from '../components/PurchaseManager';
import SalesManager from '../components/SalesManager';
import SalesHistoryManager from '../components/SalesHistoryManager';
import AnalyticsManager from '../components/AnalyticsManager';
import AdminUserCreator from '../components/AdminUserCreator';
import StaffManager from '../components/StaffManager';
import StockTransferManager from '../components/inventory/StockTransferManager';
import AdjustmentManager from '../components/inventory/AdjustmentManager';
import PermissionGuard from '../components/PermissionGuard';
import { RequireBranchGuard } from '../components/guards/RequireBranchGuard';
import { AiChatWindow } from '../components/organisms/AiChatWindow';
import SettingsGrid from '../components/settings/SettingsGrid';
import BranchManager from '../components/settings/BranchManager';
import CustomerManager from '../components/customers/CustomerManager';
import { Bot, Sparkles, ShieldAlert } from 'lucide-react';

const DashboardPage = () => {
  const { user } = useAuthStore();
  const { activeTab, sidebarOpen: isOpen, setActiveTab, setSidebarOpen: setIsOpen } = useUiStore();
  const [isChatOpen, setIsChatOpen] = useState(false);

  return (
    <>
      <Sidebar isOpen={isOpen} setIsOpen={setIsOpen} activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className={`transition-all duration-300 w-full pt-20 md:pt-[4.5rem] min-h-screen border-t-0 ${isOpen ? 'md:pl-64' : 'md:pl-20'} pl-0`}>
        {activeTab === 'categories' && (
          <PermissionGuard requiredPermission="inventory_access" fallback={<AccessDenied />}>
            <CategoryManager />
          </PermissionGuard>
        )}
        {activeTab === 'products' && (
          <PermissionGuard requiredPermission="inventory_access" fallback={<AccessDenied />}>
            <ProductManager />
          </PermissionGuard>
        )}
        {activeTab === 'purchases' && (
          <PermissionGuard requiredPermission="purchases_access" fallback={<AccessDenied />}>
            <PurchaseManager />
          </PermissionGuard>
        )}
        {activeTab === 'sales' && (
          <PermissionGuard requiredPermission="pos_access" fallback={<AccessDenied />}>
            <RequireBranchGuard>
              <SalesManager />
            </RequireBranchGuard>
          </PermissionGuard>
        )}
        {activeTab === 'sales_history' && (
          <PermissionGuard requiredPermission="pos_access" fallback={<AccessDenied />}>
            <RequireBranchGuard>
              <SalesHistoryManager />
            </RequireBranchGuard>
          </PermissionGuard>
        )}
        {activeTab === 'analytics' && (
          <PermissionGuard requiredPermission="finances_access" fallback={<AccessDenied />}>
            <AnalyticsManager />
          </PermissionGuard>
        )}
        {activeTab === 'staff' && (
          <PermissionGuard requiredPermission="staff_management" fallback={<AccessDenied />}>
            <StaffManager />
          </PermissionGuard>
        )}
        {activeTab === 'customers' && (
          (user?.role === 'admin' || user?.role === 'TENANT_OWNER')
            ? <CustomerManager />
            : <AccessDenied />
        )}
        {activeTab === 'transfers' && (
          <PermissionGuard requiredPermission="inventory_access" fallback={<AccessDenied />}>
            <RequireBranchGuard>
              <StockTransferManager />
            </RequireBranchGuard>
          </PermissionGuard>
        )}
        {activeTab === 'adjustments' && (
          <PermissionGuard requiredPermission="inventory_access" fallback={<AccessDenied />}>
            <RequireBranchGuard>
              <AdjustmentManager />
            </RequireBranchGuard>
          </PermissionGuard>
        )}
        {/* fallback extra para rutas admin custom */}
        {(activeTab as string) === 'adminCreateUser' && <AdminUserCreator />}

        {/* Nuevas vistas agregadas */}
        {activeTab === 'settings' && <SettingsGrid />}
        {activeTab === 'branches' && (
          (user?.role === 'admin' || user?.role === 'TENANT_OWNER') ? <BranchManager /> : <AccessDenied />
        )}
      </main>

      {/* Floating AI Button (Protected) */}
      <PermissionGuard requiredPermission="finances_access">
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="fixed bottom-6 right-6 z-40 p-4 bg-gradient-to-r from-emerald-500 to-green-600 border border-green-400 text-white rounded-full shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:scale-110 hover:shadow-[0_0_40px_rgba(16,185,129,0.5)] transition-all duration-300 flex items-center justify-center group"
          >
            <Bot className="w-8 h-8 group-hover:animate-pulse" />
            <Sparkles className="absolute top-1 right-1 w-4 h-4 text-emerald-100" />
          </button>
        )}

        {/* AI Chat Window */}
        {isChatOpen && <AiChatWindow onClose={() => setIsChatOpen(false)} />}
      </PermissionGuard>
    </>
  );
};

const AccessDenied = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
    <ShieldAlert size={80} className="text-red-500/50 mb-6" />
    <h2 className="text-3xl font-bold text-white mb-2">Acceso Denegado</h2>
    <p className="text-gray-400 max-w-md">
      No tienes los permisos necesarios para ver este módulo. Solicita acceso a tu administrador.
    </p>
  </div>
);

export default DashboardPage;


import { ShoppingBag, UserPlus, Users, Archive, Store } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';

const SettingsGrid = () => {
  const { user } = useAuthStore();
  const { setActiveTab } = useUiStore();

  const handleNavigation = (tab) => {
    setActiveTab(tab);
  };

  return (
    <div className="p-6 md:p-8 animate-fade-in text-white max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-orange-600">
          Centro de Configuración
        </h1>
        <p className="text-gray-400 mt-2">
          Administra los diferentes módulos y configuraciones de tu negocio.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        
        {/* Compras */}
        <button
          onClick={() => handleNavigation('purchases')}
          className="group flex flex-col p-6 rounded-2xl bg-black/40 border border-white/5 hover:border-orange-500/30 hover:bg-white/5 transition-all duration-300 text-left items-start"
        >
          <div className="p-4 rounded-xl bg-orange-500/10 text-orange-400 mb-4 group-hover:scale-110 transition-transform duration-300">
            <ShoppingBag size={32} />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Registro de Compras</h3>
          <p className="text-sm text-gray-400 leading-relaxed">
            Gestiona los ingresos de mercancía, registra proveedores y compras de inventario.
          </p>
        </button>

        {/* Personal */}
        <button
          onClick={() => handleNavigation('staff')}
          className="group flex flex-col p-6 rounded-2xl bg-black/40 border border-white/5 hover:border-purple-500/30 hover:bg-white/5 transition-all duration-300 text-left items-start"
        >
          <div className="p-4 rounded-xl bg-purple-500/10 text-purple-400 mb-4 group-hover:scale-110 transition-transform duration-300">
            <UserPlus size={32} />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Personal</h3>
          <p className="text-sm text-gray-400 leading-relaxed">
            Administra empleados, asigna roles y gestiona permisos de acceso al sistema.
          </p>
        </button>

        {/* Crear Cliente / Clientes (Solo Admin) */}
        {user?.role === 'admin' && (
          <button
            onClick={() => handleNavigation('adminCreateUser')}
            className="group flex flex-col p-6 rounded-2xl bg-black/40 border border-white/5 hover:border-blue-500/30 hover:bg-white/5 transition-all duration-300 text-left items-start"
          >
            <div className="p-4 rounded-xl bg-blue-500/10 text-blue-400 mb-4 group-hover:scale-110 transition-transform duration-300">
              <Users size={32} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Clientes</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Registra nuevos clientes y administra tu cartera para el sistema de ventas.
            </p>
          </button>
        )}

        {/* Carpetas (Placeholder) */}
        <button
          className="group flex flex-col p-6 rounded-2xl bg-black/40 border border-white/5 hover:border-emerald-500/30 hover:bg-white/5 transition-all duration-300 text-left items-start opacity-70 hover:opacity-100"
          onClick={() => console.log('Navegar a carpetas')}
        >
          <div className="p-4 rounded-xl bg-emerald-500/10 text-emerald-400 mb-4 group-hover:scale-110 transition-transform duration-300">
            <Archive size={32} />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Carpetas y Archivos</h3>
          <p className="text-sm text-gray-400 leading-relaxed">
            (Próximamente) Gestión de imágenes, audios y documentos del sistema.
          </p>
        </button>

        {/* Sucursales (Admin/TENANT_OWNER) */}
        {(user?.role === 'admin' || user?.role === 'TENANT_OWNER') && (
          <button
            className="group flex flex-col p-6 rounded-2xl bg-black/40 border border-white/5 hover:border-pink-500/30 hover:bg-white/5 transition-all duration-300 text-left items-start"
            onClick={() => handleNavigation('branches')}
          >
            <div className="p-4 rounded-xl bg-pink-500/10 text-pink-400 mb-4 group-hover:scale-110 transition-transform duration-300">
              <Store size={32} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Sucursales</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Añade, edita y gestiona las distintas sucursales del negocio.
            </p>
          </button>
        )}

      </div>
    </div>
  );
};

export default SettingsGrid;

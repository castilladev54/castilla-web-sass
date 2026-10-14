
import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { isAxiosError } from 'axios';

import DataTable, {
  type DataTableColumn,
} from '../organisms/DataTable';
import Button from '../atoms/Button';
import FormField from '../molecules/FormField';
import Modal from '../molecules/Modal';
import ConfirmDialog from '../molecules/ConfirmDialog';

import {
  useCustomersQuery,
  useCreateCustomer,
  useUpdateCustomer,
  useDeactivateCustomer,
  type Customer,
  type CustomerPayload,
} from '../../hooks/queries/useCustomerQueries';

const PAGE_SIZE = 10;

const emptyForm: CustomerPayload = {
  name: '',
  email: '',
  phone: '',
  document_id: '',
  address: '',
};

function getErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.message;

    if (status === 409) {
      return message || 'Ya existe un cliente con ese documento.';
    }

    if (status === 400) {
      return message || 'Revisa los datos introducidos.';
    }

    if (status === 403) {
      return 'No tienes permisos para realizar esta operación.';
    }

    return message || 'No se pudo completar la solicitud.';
  }

  return 'Ocurrió un error inesperado.';
}

export default function CustomerManager() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] =
    useState<Customer | null>(null);
  const [customerToDeactivate, setCustomerToDeactivate] =
    useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerPayload>(emptyForm);
  const [formError, setFormError] = useState('');

  const customersQuery = useCustomersQuery(page, PAGE_SIZE, search);
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const deactivateCustomer = useDeactivateCustomer();

  const customers = customersQuery.data?.customers ?? [];
  const total = customersQuery.data?.total ?? 0;
  const totalPages = customersQuery.data?.totalPages ?? 1;

  const isSaving = createCustomer.isPending || updateCustomer.isPending;

  const openCreateModal = () => {
    setEditingCustomer(null);
    setForm({ ...emptyForm });
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      document_id: customer.document_id ?? '',
      address: customer.address ?? '',
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSaving) return;

    setIsModalOpen(false);
    setEditingCustomer(null);
    setForm({ ...emptyForm });
    setFormError('');
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');

    const name = form.name.trim();

    if (!name) {
      setFormError('El nombre del cliente es obligatorio.');
      return;
    }

    // No enviamos cadenas vacías en los campos opcionales.
    const payload: CustomerPayload = {
      name,
      ...(form.email?.trim() && { email: form.email.trim() }),
      ...(form.phone?.trim() && { phone: form.phone.trim() }),
      ...(form.document_id?.trim() && {
        document_id: form.document_id.trim(),
      }),
      ...(form.address?.trim() && { address: form.address.trim() }),
    };

    try {
      if (editingCustomer) {
        await updateCustomer.mutateAsync({
          id: editingCustomer._id,
          data: payload,
        });
      } else {
        await createCustomer.mutateAsync(payload);
      }

      setIsModalOpen(false);
      setEditingCustomer(null);
      setForm({ ...emptyForm });
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  const handleDeactivate = async () => {
    if (!customerToDeactivate) return;

    try {
      await deactivateCustomer.mutateAsync(customerToDeactivate._id);
      setCustomerToDeactivate(null);
    } catch (error) {
      setCustomerToDeactivate(null);
      setFormError(getErrorMessage(error));
    }
  };

  const columns: DataTableColumn<Customer>[] = [
    {
      key: 'name',
      label: 'Nombre',
      render: (_value, customer) => (
        <span className="font-medium text-white">{customer.name}</span>
      ),
    },
    {
      key: 'document_id',
      label: 'Documento',
      render: (_value, customer) => customer.document_id || '—',
    },
    {
      key: 'email',
      label: 'Correo',
      render: (_value, customer) => customer.email || '—',
    },
    {
      key: 'phone',
      label: 'Teléfono',
      render: (_value, customer) => customer.phone || '—',
    },
  ];

  return (
    <section className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
            <Users className="text-orange-400" size={28} />
            Clientes
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Administra la información de tus clientes.
          </p>
        </div>

        <Button onClick={openCreateModal}>
          <Plus size={18} />
          Nuevo cliente
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => handleSearch(event.target.value)}
            placeholder="Buscar por nombre, documento, correo o teléfono..."
            aria-label="Buscar clientes"
            className="w-full rounded-xl border border-white/10 bg-[#1a1a24] py-3 pl-10 pr-10 text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => handleSearch('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <p className="text-sm text-gray-400">
          {total} {total === 1 ? 'cliente' : 'clientes'}
        </p>
      </div>

      {formError && !isModalOpen && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span className="flex-1">{formError}</span>
          <button
            type="button"
            onClick={() => setFormError('')}
            aria-label="Cerrar mensaje"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {customersQuery.isError && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300"
        >
          No se pudieron cargar los clientes.{' '}
          <button
            type="button"
            onClick={() => customersQuery.refetch()}
            className="underline"
          >
            Reintentar
          </button>
        </div>
      )}

      <DataTable<Customer>
        columns={columns}
        data={customers}
        isLoading={customersQuery.isLoading}
        onEdit={openEditModal}
        onDelete={setCustomerToDeactivate}
        getRowKey={(customer) => customer._id}
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        emptyIcon={<Users size={28} />}
        emptyMessage={search ? 'No se encontraron clientes' : 'Aún no hay clientes'}
        emptyDetail={
          search
            ? 'Prueba con otro nombre, documento, correo o teléfono.'
            : 'Registra tu primer cliente para comenzar.'
        }
        emptyAction={
          !search
            ? { label: 'Crear cliente', onClick: openCreateModal }
            : undefined
        }
      />

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingCustomer ? 'Editar cliente' : 'Nuevo cliente'}
        icon={<Users size={20} className="text-orange-400" />}
        className="max-h-[90vh] overflow-y-auto"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
            >
              {formError}
            </div>
          )}

          <FormField
            label="Nombre completo"
            name="name"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Nombre del cliente"
            required
            maxLength={150}
            autoComplete="name"
          />

          <FormField
            label="Documento de identidad"
            name="document_id"
            value={form.document_id ?? ''}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                document_id: event.target.value,
              }))
            }
            placeholder="Cédula, RIF u otro documento"
            maxLength={50}
          />

          <FormField
            label="Correo electrónico"
            name="email"
            type="email"
            value={form.email ?? ''}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            placeholder="cliente@ejemplo.com"
            maxLength={254}
            autoComplete="email"
          />

          <FormField
            label="Teléfono"
            name="phone"
            type="tel"
            value={form.phone ?? ''}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value }))
            }
            placeholder="Número de contacto"
            maxLength={30}
            autoComplete="tel"
          />

          <FormField
            label="Dirección"
            name="address"
            as="textarea"
            value={form.address ?? ''}
            onChange={(event) =>
              setForm((current) => ({ ...current, address: event.target.value }))
            }
            placeholder="Dirección del cliente"
            maxLength={300}
            rows={3}
          />

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={closeModal}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSaving}>
              {editingCustomer ? 'Guardar cambios' : 'Crear cliente'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(customerToDeactivate)}
        message="¿Desactivar este cliente?"
        detail={
          customerToDeactivate
            ? `${customerToDeactivate.name} dejará de aparecer en el listado de clientes activos.`
            : undefined
        }
        confirmLabel="Desactivar"
        cancelLabel="Cancelar"
        onConfirm={handleDeactivate}
        onCancel={() => setCustomerToDeactivate(null)}
        isLoading={deactivateCustomer.isPending}
      />
    </section>
  );
}

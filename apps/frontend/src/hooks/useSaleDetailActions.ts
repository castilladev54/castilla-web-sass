import { useSaleUIStore } from '../store/saleUIStore';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { useCancelSale, saleKeys } from './queries/useSaleQueries';
import { api as API } from '../api/axiosClient';
import type { SaleId } from '@inventory/shared';
import type { SaleDetailDTO } from '@inventory/shared';

export function useSaleDetailActions() {
  const queryClient = useQueryClient();
  const cancelSaleMutation = useCancelSale();
  const { activeBranchId } = useAuthStore();
  const {
    viewedSaleId,
    isEditModalOpen,
    openSaleDetail,
    openEditMode,
    closeModals,
  } = useSaleUIStore();

  const { data: viewedSale, isLoading, isError } = useQuery<SaleDetailDTO>({
    queryKey: [...saleKeys.all(activeBranchId), "detail", viewedSaleId],
    queryFn: async () => {
      const res = await API.get(`/sales/${viewedSaleId}`);
      return res.data.sale ?? res.data;
    },
    enabled: !!viewedSaleId,
  });

  const handleViewDetail = async (id: SaleId) => {
    openSaleDetail(id);
  };

  const handleCancelSale = async (id: SaleId) => {
    if (
      !window.confirm(
        "¿Estás seguro de que deseas anular esta venta? El stock será devuelto y el monto quedará en 0."
      )
    ) return;

    cancelSaleMutation.mutate(id, {
      onSuccess: () => {
        toast.success("Venta anulada con éxito");
        closeModals();
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.message || "Error al anular la venta");
      },
    });
  };

  const handleUpdateSale = (updatedSale: SaleDetailDTO) => {
    // La reactividad de React Query actualizará automáticamente 'viewedSale' si configuramos el onMutate correctamente, o podemos forzar invalidación.
    // Solo cerramos el modal de edición
    useSaleUIStore.setState({ isEditModalOpen: false });
    toast.success("Venta actualizada con éxito");
  };

  return {
    viewedSale,
    viewedSaleId,
    isLoading,
    isError,
    isEditModalOpen,
    openSaleDetail,
    openEditMode,
    closeModals,
    handleViewDetail,
    handleCancelSale,
    handleUpdateSale,
  };
}

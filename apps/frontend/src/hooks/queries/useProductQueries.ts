import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api as API } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import type {
  Product,
  ProductId,
  BranchId,
  ApiProductResponse,
  ApiProductListResponse,
} from '@inventory/shared';
import type { CreateStockTransferDTO } from '@inventory/shared';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const productKeys = {
  all: (branchId: string | null) => ['products', branchId] as const,
  lists: (branchId: string | null) => [...productKeys.all(branchId), 'list'] as const,
  list: (branchId: string | null, page: number, limit: number, search: string) =>
    [...productKeys.lists(branchId), { page, limit, search }] as const,
  posCatalog: (branchId: string | null) => [...productKeys.all(branchId), 'pos-catalog'] as const,
  barcode: (branchId: string | null, code: string) => [...productKeys.all(branchId), 'barcode', code] as const,
};

export const transferProductKeys = {
  all: ['transfer-products'] as const,
  byBranch: (branchId: BranchId | null) => [...transferProductKeys.all, branchId] as const,
};

// ─── Tipos de Payload ─────────────────────────────────────────────────────────

export interface CreateProductPayload {
  name: string;
  description: string;
  price: number;
  category: string;
  barcode?: string;
  unit_type: 'unidad' | 'kg' | 'litro' | 'metro';
  /** Stock inicial para la sucursal activa */
  initialStock?: number;
  minStock?: number;
}

export type UpdateProductPayload = Partial<CreateProductPayload>;

interface ProductListResponse {
  products: Product[];
  total: number;
  totalPages: number;
  currentPage: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Lista paginada de productos con búsqueda opcional.
 * keepPreviousData evita el flasheo al cambiar de página.
 */
export function useProductsQuery(page: number, limit: number, search: string, hasDebt?: boolean) {
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) params.set('search', search.trim());
  if (hasDebt) params.set('hasDebt', 'true');

  return useQuery<ProductListResponse>({
    queryKey: [...productKeys.list(activeBranchId, page, limit, search), { hasDebt }] as const,
    queryFn: async ({ signal }) => {
      const res = await API.get<ApiProductListResponse>(`/products?${params.toString()}`, { signal });
      const data = res.data;
      return {
        products: data.products,
        total: data.total,
        totalPages: data.totalPages,
        currentPage: data.currentPage,
      };
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000, // 1 minuto — igual que el TTL de Redis del backend (5min), más conservador en cliente
  });
}

/**
 * Catálogo completo para el POS (sin paginación).
 * staleTime más largo porque el catálogo POS no se invalida frecuentemente.
 */
export function useAllProductsForPOS() {
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useQuery<Product[]>({
    queryKey: productKeys.posCatalog(activeBranchId),
    queryFn: async ({ signal }) => {
      const res = await API.get('/products?page=1&limit=5000', { signal });
      return res.data.products.filter((p: Product) => p.isActive !== false);
    },
    staleTime: 5 * 60_000,  // 5 minutos — alineado con TTL de Redis del backend
    gcTime: 10 * 60_000,
  });
}

/**
 * Busca un producto por su código de barras.
 * Se dispara de forma imperativa (enabled: false) desde mutateAsync.
 */
export function useProductByBarcodeQuery(barcode: string, enabled: boolean) {
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useQuery<ApiProductResponse>({
    queryKey: productKeys.barcode(activeBranchId, barcode),
    queryFn: async ({ signal }) => {
      const res = await API.get<ApiProductResponse>(`/products/barcode/${barcode}`, { signal });
      return res.data;
    },
    enabled: enabled && barcode.length >= 5,
    staleTime: 30_000,
    retry: false,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProduct() {
  const qc = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useMutation<ApiProductResponse, Error, CreateProductPayload>({
    mutationFn: async (payload) => {
      const res = await API.post<ApiProductResponse>('/products', payload);
      return res.data;
    },
    onSuccess: () => {
      // Invalida TODAS las listas de productos (incluye POS catalog)
      qc.invalidateQueries({ queryKey: productKeys.all(activeBranchId) });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useMutation<ApiProductResponse, Error, { id: ProductId; data: UpdateProductPayload }>({
    mutationFn: async ({ id, data }) => {
      const res = await API.put<ApiProductResponse>(`/products/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productKeys.all(activeBranchId) });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  return useMutation<void, Error, ProductId>({
    mutationFn: async (id) => {
      await API.delete(`/products/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productKeys.all(activeBranchId) });
    },
  });
}

/**
 * Obtiene el catálogo de productos para una transferencia, explícitamente para
 * una sucursal origen. NO utiliza el activeBranchId global de la tienda.
 */
export function useTransferProductsQuery(sourceBranchId: BranchId | null) {
  return useQuery<Product[], Error>({
    queryKey: transferProductKeys.byBranch(sourceBranchId),
    queryFn: async () => {
      if (!sourceBranchId) {
        throw new Error('La sucursal origen es requerida');
      }

      const res = await API.get<ApiProductListResponse>('/products', {
        params: { page: 1, limit: 5000 },
        headers: {
          'x-branch-id': sourceBranchId,
        },
      });
      return res.data.products;
    },
    enabled: sourceBranchId !== null,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}



import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { api as API } from '../../api/axiosClient';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface Customer {
    _id: string;
    name: string;
    email?: string;
    phone?: string;
    document_id?: string;
    address?: string;
    businessOwnerId: string;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface CustomerPayload {
    name: string;
    email?: string;
    phone?: string;
    document_id?: string;
    address?: string;
}

export type UpdateCustomerPayload = Partial<CustomerPayload>;

export interface CustomerListResponse {
    customers: Customer[];
    total: number;
    totalPages: number;
    currentPage: number;
}

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const customerKeys = {
    all: ['customers'] as const,
    lists: () => [...customerKeys.all, 'list'] as const,
    list: (page: number, limit: number, search: string) =>
        [...customerKeys.lists(), { page, limit, search }] as const,
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useCustomersQuery(
    page = 1,
    limit = 10,
    search = '',
) {
    return useQuery<CustomerListResponse>({
        queryKey: customerKeys.list(page, limit, search),
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit),
            });

            if (search.trim()) {
                params.set('search', search.trim());
            }

            const res = await API.get(`/customers?${params.toString()}`, {
                signal,
                headers: { 'x-global-request': 'true' },
            });

            return {
                customers: res.data.customers ?? [],
                total: res.data.total ?? 0,
                totalPages: res.data.totalPages ?? 1,
                currentPage: res.data.currentPage ?? page,
            };
        },
        placeholderData: keepPreviousData,
        staleTime: 2 * 60_000,
    });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useCreateCustomer() {
    const qc = useQueryClient();

    return useMutation<Customer, Error, CustomerPayload>({
        mutationFn: async (payload) => {
            const res = await API.post('/customers', payload, {
                headers: { 'x-global-request': 'true' },
            });

            return res.data.customer;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: customerKeys.all });
        },
    });
}

export function useUpdateCustomer() {
    const qc = useQueryClient();

    return useMutation<
        Customer,
        Error,
        { id: string; data: UpdateCustomerPayload }
    >({
        mutationFn: async ({ id, data }) => {
            const res = await API.patch(`/customers/${id}`, data, {
                headers: { 'x-global-request': 'true' },
            });

            return res.data.customer;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: customerKeys.all });
        },
    });
}

/** Desactiva un cliente sin eliminar su registro de la base de datos. */
export function useDeactivateCustomer() {
    const qc = useQueryClient();

    return useMutation<void, Error, string>({
        mutationFn: async (id) => {
            await API.delete(`/customers/${id}`, {
                headers: { 'x-global-request': 'true' },
            });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: customerKeys.all });
        },
    });
}

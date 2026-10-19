import React, {
  FormEvent,
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { useCreateSale } from "../../hooks/queries/useSaleQueries";
import { usePOSCart } from "../../hooks/usePOSCart";
import { useAllProductsForPOS } from "../../hooks/queries/useProductQueries";
import { useAuthStore } from "../../store/authStore";
import { useExchangeRateQuery } from "../../hooks/queries/useExchangeRateQueries";
import { useCurrentCashShiftQuery } from "../../hooks/queries/useCashShiftQueries";
import { usePOSKeyboard } from "../../hooks/usePOSKeyboard";
import SalePOSForm from "./SalePOSForm";
import POSGuardOverlay from "./POSGuardOverlay";
import toast from "react-hot-toast";
import { PaymentMethod } from "@inventory/shared";
import type { Product } from "@inventory/shared";
import {
  useCustomersQuery,
  useCreateCustomer,
} from "../../hooks/queries/useCustomerQueries";
import type {
  Customer,
  CustomerPayload,
} from "../../hooks/queries/useCustomerQueries";

interface PosFormProps {
  onCancel: () => void;
  onOpenScanner: () => void;
  onOpenCashShift: () => void;
  isScannerOpen: boolean;
  isFormOpen: boolean;
  setIsCartOpenExternal: (open: boolean) => void;
  isCartOpenExternal: boolean;
}

export default function PosForm({
  onCancel,
  onOpenScanner,
  onOpenCashShift,
  isScannerOpen,
  isFormOpen,
  setIsCartOpenExternal,
  isCartOpenExternal,
}: PosFormProps) {
  const createSaleMutation = useCreateSale();
  const createCustomerMutation = useCreateCustomer();
  const { data: posProducts = [], isLoading: isPosLoading } =
    useAllProductsForPOS();
  const { user, activeBranchId } = useAuthStore();

  const { data: rateData } = useExchangeRateQuery();
  const exchangeRate = Number(rateData?.rate ?? 1);

  const { data: currentShift } = useCurrentCashShiftQuery(
    activeBranchId,
    user?._id,
  );

  const {
    data: customersData,
    isLoading: isCustomersLoading,
    isError: isCustomersError,
  } = useCustomersQuery(1, 100, "");

  const activeCustomers = useMemo(
    () =>
      (customersData?.customers ?? []).filter((customer) => customer.isActive),
    [customersData?.customers],
  );

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );

  const handleCustomerChange = useCallback((customerId: string) => {
    setSelectedCustomerId(customerId === '' ? null : customerId);
  }, []);

  const handleCreateCustomer = useCallback(
    async (payload: CustomerPayload): Promise<void> => {
      const customer = await createCustomerMutation.mutateAsync(payload);

      setSelectedCustomerId(customer._id);
      toast.success("Cliente registrado y seleccionado");
    },
    [createCustomerMutation],
  );

  const [saleStatus, setSaleStatus] = useState<'completed' | 'pending'>('completed');

  const handleStatusChange = useCallback((status: 'completed' | 'pending') => {
    setSaleStatus(status);
  }, []);

  const {
    items,
    paymentMethod,
    cartPulse,
    currentTotal,
    setPaymentMethod,
    handleAddItem,
    handleQtyChange,
    handleRemoveItem,
    cyclePaymentMethod,
    clearCart,
    modifyLastItemQty,
    resetCart,
    idempotencyKeyRef,
  } = usePOSCart();

  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const submitBtnRef = useRef<HTMLButtonElement | null>(null);
  const paymentSelectRef = useRef<HTMLSelectElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // useEffect removed – React Query handles loading
  //   if (isFormOpen) fetchAllForPOS();
  // }, [isFormOpen, fetchAllForPOS]);

  useEffect(() => {
    if (!isScannerOpen && isFormOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isScannerOpen, isFormOpen]);

  const handleCloseCart = useCallback(
    (open: boolean) => {
      if (!open) {
        if (createSaleMutation.isPending && abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        setIsCartOpenExternal(false);
      } else {
        setIsCartOpenExternal(true);
      }
    },
    [createSaleMutation.isPending, setIsCartOpenExternal],
  );

  const getBranchStock = useCallback(
    (product: Product): string => {
      if (!activeBranchId) return "0";
      return (
        product.branchInventories?.find(
          (inventory) => inventory.branch_id === activeBranchId,
        )?.stock ?? "0"
      );
    },
    [activeBranchId],
  );

  usePOSKeyboard({
    isFormOpen,
    showHelp: false,
    isScannerOpen,
    isCartOpen: isCartOpenExternal,
    items,
    hasOpenShift: !!currentShift,
    setShowHelp: () => {}, // Handled globally
    setIsFormOpen: () => {},
    setIsScannerOpen: onOpenScanner,
    setIsCartOpen: handleCloseCart,
    searchInputRef,
    submitBtnRef,
    cyclePaymentMethod,
    clearCart,
    modifyLastItemQty,
    handleBarcodeScan: async (code: string) => {
      const qty = 1;
      const local = posProducts.find(
        (p) => p.barcode === code || p._id === code,
      );
      if (local) {
        handleAddItem(local, qty, getBranchStock);
        toast.success(`Añadido: ${qty}x ${local.name}`);
        setSearchTerm("");
        return;
      }
      // TODO: Implement barcode lookup via React Query
      // const { data: barcodeResult, isSuccess } = useProductByBarcodeQuery(code, true);
      // if (isSuccess && barcodeResult?.product) {
      //   const product = barcodeResult.product;
      //   handleAddItem(product, qty);
      //   toast.success(`Añadido: ${qty}x ${product.name}`);
      //   setSearchTerm("");
      // } else {
      //   toast.error(`Código "${code}" no encontrado`);
      // }
    },
    cancelForm: onCancel,
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return toast.error("Agrega al menos un artículo");

    if (saleStatus === 'pending' && !selectedCustomerId) {
      return toast.error("Para registrar una venta a crédito o pendiente debes seleccionar un cliente");
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    const payload = {
      items: items.map((i) => ({
        product_id: i.product_id,
        quantity: String(i.quantity),
        unit_price: String(i.unit_price),
      })),
      payment_method: paymentMethod as PaymentMethod,
      customer_id: selectedCustomerId,
      status: saleStatus,
      exchange_rate: String(exchangeRate),
      signal: controller.signal,
      idempotencyKey: idempotencyKeyRef.current,
    };

    createSaleMutation.mutate(payload, {
      onSuccess: () => {
        idempotencyKeyRef.current = null;
        setSelectedCustomerId(null);
        setSaleStatus('completed');
        toast.success("Venta registrada con éxito");
        resetCart();
        onCancel();
      },
      onError: (err: any) => {
        if (err?.response?.status === 403) {
          idempotencyKeyRef.current = null;
        }
        if (
          err.name === "CanceledError" ||
          err.name === "AbortError" ||
          (typeof DOMException !== "undefined" &&
            err instanceof DOMException &&
            err.name === "AbortError")
        ) {
          toast.error("Venta cancelada (operación abortada)");
        } else {
          const errMsg =
            err?.response?.data?.message ||
            (!err?.response
              ? "Error de red: El servidor no responde."
              : "Error inesperado al registrar la venta");
          toast.error(errMsg);
        }
      },
      onSettled: () => {
        abortControllerRef.current = null;
      },
    });
  };

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return posProducts;
    return posProducts.filter(
      (p: Product) =>
        p.name.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)),
    );
  }, [posProducts, searchTerm]);

  return (
    <POSGuardOverlay>
      <SalePOSForm
        items={items}
        onCancel={onCancel}
        onAddItem={handleAddItem}
        onRemoveItem={handleRemoveItem}
        onQtyChange={handleQtyChange}
        onSubmit={handleSubmit}
        paymentMethod={paymentMethod}
        onPaymentChange={setPaymentMethod}
        isLoading={createSaleMutation.isPending || isPosLoading}
        currentTotal={currentTotal}
        filteredProducts={filteredProducts}
        searchTerm={searchTerm}
        onSearch={setSearchTerm}
        onOpenScanner={onOpenScanner}
        exchangeRate={String(exchangeRate)}
        cartPulse={cartPulse}
        submitBtnRef={submitBtnRef}
        paymentSelectRef={paymentSelectRef}
        searchInputRef={searchInputRef}
        isCartOpen={isCartOpenExternal}
        setIsCartOpen={handleCloseCart}
        hasOpenShift={!!currentShift}
        onOpenCashShift={onOpenCashShift}
        getBranchStock={getBranchStock}
        customers={activeCustomers}
        selectedCustomerId={selectedCustomerId}
        onCustomerChange={handleCustomerChange}
        onCreateCustomer={handleCreateCustomer}
        isCreatingCustomer={createCustomerMutation.isPending}
        isCustomersLoading={isCustomersLoading}
        isCustomersError={isCustomersError}
        saleStatus={saleStatus}
        onStatusChange={handleStatusChange}
      />
    </POSGuardOverlay>
  );
}

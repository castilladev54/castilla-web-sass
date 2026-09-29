import { useState, useCallback } from 'react';
import type { Product, BranchId, ProductId } from '@inventory/shared';
import {
  TransferCartItem,
  addItemToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
  TransferCartError,
} from '../utils/transferCart';

/**
 * React hook that wraps the pure transfer‑cart utilities.
 * It keeps the cart in component state and validates operations against the
 * currently selected source branch.
 */
export function useTransferCart(sourceBranchId: BranchId | null = null) {
  const [cart, setCart] = useState<TransferCartItem[]>([]);

  const addItem = useCallback(
    (product: Product, quantity: string) => {
      if (!sourceBranchId) {
        throw new TransferCartError('No source branch selected');
      }
      setCart((prev) => addItemToCart(prev, product, sourceBranchId, quantity));
    },
    [sourceBranchId],
  );

  const updateQuantity = useCallback(
    (product: Product, quantity: string) => {
      if (!sourceBranchId) {
        throw new TransferCartError('No source branch selected');
      }
      setCart((prev) =>
        updateCartItemQuantity(prev, product, sourceBranchId, quantity),
      );
    },
    [sourceBranchId],
  );

  const removeItem = useCallback((productId: ProductId) => {
    setCart((prev) => removeCartItem(prev, productId));
  }, []);

  const clear = useCallback(() => {
    setCart([]);
  }, []);

  return {
    cart,
    addItem,
    updateQuantity,
    removeItem,
    clear,
  };
}

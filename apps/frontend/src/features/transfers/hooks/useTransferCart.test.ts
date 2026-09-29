import { renderHook, act } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import type { Product, BranchId, ProductId, BusinessOwnerId, CategoryId, UnitType } from '@inventory/shared';
import { useTransferCart } from './useTransferCart';
import { TransferCartError } from '../utils/transferCart';



const createMockProduct = (
  branchId: BranchId,
  stock: string,
  productId: ProductId = 'prod-1' as ProductId,
): Product => ({
  _id: productId,
  id: productId,
  name: 'Producto de prueba',
  description: 'Producto de prueba',
  price: '10',
  category: 'cat-1' as CategoryId,
  unit_type: 'unidad' as UnitType,
  user: 'user-1' as BusinessOwnerId,
  createdAt: '',
  updatedAt: '',
  __v: 0,
  branchInventories: [
    {
      _id: 'inventory-1',
      branch_id: branchId,
      product_id: productId,
      stock,
      min_stock: '0',
      createdAt: '',
      updatedAt: '',
    },
  ],
  totalStock: stock,
});

describe('useTransferCart hook', () => {
  const branchA = 'branch-A' as BranchId;
const branchB = 'branch-B' as BranchId;
  const productA = createMockProduct(branchA, '10');
  const productDecimal = createMockProduct(branchA, '12.75');

  test('estado inicial', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    expect(result.current.cart).toEqual([]);
  });

  test('agregar correctamente', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    act(() => {
      result.current.addItem(productA, '5');
    });
    expect(result.current.cart).toEqual([
      expect.objectContaining({ product_id: 'prod-1', quantity: '5' }),
    ]);
  });

  test('acumular el mismo producto', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    act(() => {
      result.current.addItem(productA, '5');
      result.current.addItem(productA, '3');
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]?.quantity).toBe('8');
  });

  test('rechazar exceso y conservar estado', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    act(() => {
      result.current.addItem(productA, '8');
    });
    expect(() => {
      act(() => {
        result.current.addItem(productA, '3');
      });
    }).toThrow(TransferCartError);
    // El carrito debe quedar con la cantidad previa
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]?.quantity).toBe('8');
  });

  test('decimales', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    act(() => {
      result.current.addItem(productDecimal, '5.25');
      result.current.addItem(productDecimal, '7.5');
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]?.quantity).toBe('12.75');
  });

  test('actualizar cantidad', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    act(() => {
      result.current.addItem(productA, '5');
      result.current.updateQuantity(productA, '8');
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]?.quantity).toBe('8');
  });

  test('actualización inválida', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    act(() => {
      result.current.addItem(productA, '8');
    });
    expect(() => {
      act(() => {
        result.current.updateQuantity(productA, '11');
      });
    }).toThrow(TransferCartError);
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]?.quantity).toBe('8');
  });

  test('eliminar', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    act(() => {
      result.current.addItem(productA, '5');
      result.current.removeItem(productA._id);
    });
    expect(result.current.cart).toEqual([]);
  });

  test('limpiar', () => {
    const { result } = renderHook(() => useTransferCart(branchA));
    const productB = createMockProduct(branchA, '10', 'prod-2' as ProductId);
    act(() => {
      result.current.addItem(productA, '2');
      result.current.addItem(productB, '3');
      result.current.clear();
    });
    expect(result.current.cart).toEqual([]);
  });

  test('soporta actualización reactiva de sourceBranchId vía re-render', () => {
    let currentBranch: BranchId | null = null;
    const { result, rerender } = renderHook(() => useTransferCart(currentBranch));

    expect(() => {
      act(() => {
        result.current.addItem(productA, '4');
      });
    }).toThrow(TransferCartError);

    currentBranch = branchA;
    rerender();

    act(() => {
      result.current.addItem(productA, '4');
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]?.quantity).toBe('4');
  });

  test('sourceBranchId null bloquea operaciones', () => {
    const { result } = renderHook(() => useTransferCart(null));
    expect(() => {
      act(() => {
        result.current.addItem(productA, '5');
      });
    }).toThrow(TransferCartError);
  });
});

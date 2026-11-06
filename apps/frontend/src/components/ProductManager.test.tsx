import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { Product, Branch, BranchId, ProductId, CategoryId, BusinessOwnerId } from '@inventory/shared';
import { buildColumns } from './ProductManager';

describe('ProductManager - buildColumns (Stock por Sucursal)', () => {
  afterEach(() => {
    cleanup();
  });

  const branch1: Branch = {
    _id: 'branch-1' as BranchId,
    name: 'Sucursal Central',
    owner_id: 'owner-1' as BusinessOwnerId,
    is_active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const branch2: Branch = {
    _id: 'branch-2' as BranchId,
    name: 'Sucursal Norte',
    owner_id: 'owner-1' as BusinessOwnerId,
    is_active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockProduct: Product = {
    _id: 'prod-1' as ProductId,
    id: 'prod-1' as ProductId,
    name: 'Harina PAN',
    description: 'Harina de maíz blanco',
    price: '1.50',
    category: {
      _id: 'cat-1' as CategoryId,
      name: 'Alimentos',
      description: 'Víveres y alimentos',
      user: 'owner-1' as BusinessOwnerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      __v: 0,
    },
    unit_type: 'unidad',
    user: 'owner-1' as BusinessOwnerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    __v: 0,
    totalStock: '25',
    branchInventories: [
      {
        _id: 'inv-1',
        branch_id: 'branch-1' as BranchId,
        product_id: 'prod-1' as ProductId,
        stock: '25',
        min_stock: '5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  const dummyToBs = (usd: string, rate: string) => (Number(usd) * Number(rate)).toFixed(2);

  it('1. Debe incluir la columna "Stock por Sucursal"', () => {
    const columns = buildColumns(dummyToBs, '50', [branch1, branch2], 'branch-1');
    const branchCol = columns.find((c) => c.key === 'branchInventories');

    expect(branchCol).toBeDefined();
    expect(branchCol?.label).toBe('Stock por Sucursal');
  });

  it('2. Debe mostrar la cantidad para cada sucursal configurada, incluso con 0 si no tiene registro de inventario', () => {
    const columns = buildColumns(dummyToBs, '50', [branch1, branch2], 'branch-1');
    const branchCol = columns.find((c) => c.key === 'branchInventories');
    expect(branchCol?.render).toBeDefined();

    render(
      <>{branchCol!.render!(mockProduct.branchInventories, mockProduct)}</>
    );

    // Debe mostrar ambas sucursales
    expect(screen.getByText('Sucursal Central:')).not.toBeNull();
    expect(screen.getByText('Sucursal Norte:')).not.toBeNull();

    // Sucursal Central tiene 25
    expect(screen.getByText('25')).not.toBeNull();

    // Sucursal Norte no tiene inventario inicial en mockProduct, debe mostrar 0
    expect(screen.getByText('0')).not.toBeNull();
  });

  it('3. Debe resaltar la sucursal activa actual', () => {
    const columns = buildColumns(dummyToBs, '50', [branch1, branch2], 'branch-1');
    const branchCol = columns.find((c) => c.key === 'branchInventories');

    render(
      <>{branchCol!.render!(mockProduct.branchInventories, mockProduct)}</>
    );

    // El indicador de sucursal activa debe estar presente
    const activeIndicator = screen.getByTitle('Sucursal activa');
    expect(activeIndicator).not.toBeNull();
  });

  it('4. Debe formatear correctamente unidades de medida especiales (kg, litro, metro)', () => {
    const productKg: Product = {
      ...mockProduct,
      unit_type: 'kg',
      branchInventories: [
        {
          _id: 'inv-1',
          branch_id: 'branch-1' as BranchId,
          product_id: 'prod-1' as ProductId,
          stock: '12.5',
          min_stock: '2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const columns = buildColumns(dummyToBs, '50', [branch1], 'branch-1');
    const branchCol = columns.find((c) => c.key === 'branchInventories');

    render(
      <>{branchCol!.render!(productKg.branchInventories, productKg)}</>
    );

    expect(screen.getByText('12,5')).not.toBeNull();
    expect(screen.getByText('kg')).not.toBeNull();
  });

  it('5. Debe señalar stock negativo (deuda operativa) en rojo', () => {
    const productWithDebt: Product = {
      ...mockProduct,
      branchInventories: [
        {
          _id: 'inv-1',
          branch_id: 'branch-1' as BranchId,
          product_id: 'prod-1' as ProductId,
          stock: '-3',
          min_stock: '0',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const columns = buildColumns(dummyToBs, '50', [branch1], 'branch-1');
    const branchCol = columns.find((c) => c.key === 'branchInventories');

    render(
      <>{branchCol!.render!(productWithDebt.branchInventories, productWithDebt)}</>
    );

    const negativeStockEl = screen.getByText('-3');
    expect(negativeStockEl).not.toBeNull();
    expect(negativeStockEl.className).toContain('text-red-400');
  });

  it('6. Debe mostrar mensaje si no hay ninguna sucursal configurada ni inventarios', () => {
    const emptyProduct: Product = {
      ...mockProduct,
      branchInventories: [],
    };

    const columns = buildColumns(dummyToBs, '50', [], null);
    const branchCol = columns.find((c) => c.key === 'branchInventories');

    render(
      <>{branchCol!.render!(emptyProduct.branchInventories, emptyProduct)}</>
    );

    expect(screen.getByText('Sin sucursales')).not.toBeNull();
  });
});

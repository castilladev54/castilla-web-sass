import mongoose from "mongoose";
import { Request, Response } from "express";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { Inventory } from "../models/Inventory.js";
import { Branch } from "../models/Branch.js";
import { StockMovement, StockMovementType } from "../models/StockMovement.js";
import {
  invalidateCache,
  getOrSetCache,
  getCacheVersion,
  bumpCacheVersion,
  buildPaginatedKey,
  getBranchCacheVersion,
  bumpBranchCacheVersion,
} from "../lib/redis.js";
import type {
  GetProductsResult,
  ProductFacetAggregationResult,
} from "../types/aggregation.js";
import { getCurrentLogger } from "../lib/logger.js";

export const createProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const {
    name,
    description,
    price,
    category,
    unit_type,
    barcode,
    initial_stock,
    branch_id,
  } = req.body;

  try {
    // Verificar si la categoría existe y pertenece al usuario
    const categoryExists = await Category.findOne({
      _id: category,
      user: req.businessOwnerId,
    });
    if (!categoryExists) {
      res.status(400).json({
        success: false,
        message: "La categoría especificada no existe",
      });
      return;
    }

    // Si se envía barcode, verificar que no esté duplicado para este usuario
    if (barcode) {
      const barcodeExists = await Product.findOne({
        barcode,
        user: req.businessOwnerId,
      });
      if (barcodeExists) {
        res.status(400).json({
          success: false,
          message: `El código de barras "${barcode}" ya está asignado al producto "${barcodeExists.name}"`,
        });
        return;
      }
    }

    const hasInitialStock = initial_stock !== undefined;

    if (hasInitialStock && !branch_id) {
      res.status(400).json({
        success: false,
        message:
          "Se requiere especificar la sucursal (branch_id) al inicializar el producto con stock.",
      });
      return;
    }

    if (!hasInitialStock) {
      // Creación pura de catálogo — sin transacción, sin stock, sin BranchInventory.
      // El inventario se inicializa lazily mediante la primera venta, compra o ajuste (upsert).
      const product = new Product({
        name,
        description,
        price,
        category,
        unit_type,
        ...(barcode ? { barcode } : {}),
        user: req.businessOwnerId,
      });
      await product.save();
      try {
        await bumpCacheVersion("products", req.businessOwnerId);
      } catch (error) {
        getCurrentLogger().error(
          { err: error, productId: product._id },
          "Product created, but cache invalidation failed",
        );
      }

      res.status(201).json({ success: true, product });
      return;
    }

    // Creación con stock inicial usando transacción
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const branch = await Branch.findOne({
        _id: branch_id,
        owner_id: req.businessOwnerId,
        is_active: true,
      }).session(session);

      if (!branch) {
        await session.abortTransaction();

        res.status(404).json({
          success: false,
          message:
            "La sucursal no existe, está inactiva o no pertenece a este negocio.",
        });

        return;
      }

      const product = new Product({
        name,
        description,
        price,
        category,
        unit_type,
        ...(barcode ? { barcode } : {}),
        user: req.businessOwnerId,
      });
      await product.save({ session });

      const decimalQuantity = mongoose.Types.Decimal128.fromString(
        String(initial_stock),
      );

      const inventory = new Inventory({
        product_id: product._id,
        branch_id: branch_id,
        owner_id: req.businessOwnerId,
        quantity: decimalQuantity,
        min_stock_alert: mongoose.Types.Decimal128.fromString("0"),
      });
      await inventory.save({ session });

      const stockMovement = new StockMovement({
        inventory_id: inventory._id,
        product_id: product._id,
        branch_id: branch_id,
        owner_id: req.businessOwnerId,
        type: StockMovementType.INITIAL_INVENTORY,
        quantity_change: decimalQuantity,
        previous_quantity: mongoose.Types.Decimal128.fromString("0"),
        new_quantity: decimalQuantity,
        created_by: req.actorId || req.businessOwnerId,
        reason: "Inventario inicial al crear el producto",
      });
      await stockMovement.save({ session });

      await session.commitTransaction();

      const cacheResults = await Promise.allSettled([
        bumpCacheVersion("products", req.businessOwnerId),
        bumpBranchCacheVersion(
          "products",
          String(req.businessOwnerId),
          String(branch_id),
        ),
        invalidateCache(`product:${product._id}:${req.businessOwnerId}`),
      ]);

      for (const result of cacheResults) {
        if (result.status === "rejected") {
          getCurrentLogger().error(
            { err: result.reason, productId: product._id },
            "Product created, but cache invalidation failed",
          );
        }
      }

      const productResponse = {
        ...product.toObject(),
        branchInventories: [
          {
            _id: inventory._id,
            product_id: inventory.product_id,
            branch_id: inventory.branch_id,
            stock: inventory.quantity,
            min_stock: inventory.min_stock_alert,
            createdAt: inventory.createdAt,
            updatedAt: inventory.updatedAt,
          },
        ],
        totalStock: inventory.quantity,
      };

      res.status(201).json({ success: true, product: productResponse });
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      try {
        await session.endSession();
      } catch (error) {
        getCurrentLogger().error(
          { err: error },
          "Failed to close MongoDB session after product creation",
        );
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    res.status(500).json({ success: false, message });
  }
};

export const getProducts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const ownerId = req.businessOwnerId;
    const branchId = req.branchId;
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);

    // 1. Extracción y sanitización de paginación
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      5000,
      Math.max(1, parseInt(req.query.limit as string) || 20),
    );
    const skip = (page - 1) * limit;

    // Normalización de búsqueda
    const normalizedSearch = ((req.query.search as string) || "")
      .trim()
      .toLowerCase();
    const useCache =
      normalizedSearch.length === 0 || normalizedSearch.length >= 3;
    const ttl = normalizedSearch.length >= 3 ? 30 : 300;

    // 2. Validación estricta de ordenación (Whitelist)
    const allowedSortFields = ["createdAt", "name", "price", "totalStock"];
    const sortBy = allowedSortFields.includes(req.query.sortBy as string)
      ? (req.query.sortBy as string)
      : "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    // 3. Llave de caché determinista con versión global y de sucursal (Lectura pasiva)
    const [globalVersion, branchVersion] = useCache
      ? await Promise.all([
          getCacheVersion("products", ownerId),
          branchId
            ? getBranchCacheVersion("products", ownerId, branchId)
            : Promise.resolve(1),
        ])
      : [null, null];

    const searchSlug = normalizedSearch
      ? `:s${Buffer.from(normalizedSearch).toString("base64url")}`
      : "";
    const hasDebtSlug = req.query.hasDebt === "true" ? ":debt" : "";
    const cacheKey = useCache
      ? `products:g${globalVersion}:b${branchVersion}:${ownerId}:${branchId ?? "catalog"}:p${page}:l${limit}${searchSlug}${hasDebtSlug}:sort:${sortBy}:${sortOrder}`
      : null;

    // Función de base de datos
    const fetchFromDB = async (): Promise<GetProductsResult> => {
      // Construcción del Match inicial
      const matchStage: any = { user: ownerObjectId };
      if (normalizedSearch) {
        const regex = new RegExp(normalizedSearch, "i");
        matchStage.$or = [{ name: regex }, { barcode: regex }];
      }

      const pipeline: mongoose.PipelineStage[] = [
        { $match: matchStage },
        {
          $lookup: {
            from: "inventories",
            let: {
              productId: "$_id",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$product_id", "$$productId"] },
                      { $eq: ["$owner_id", ownerObjectId] },
                    ],
                  },
                },
              },
              {
                $project: {
                  _id: 1,
                  product_id: 1,
                  branch_id: 1,
                  quantity: 1,
                  min_stock_alert: 1,
                  createdAt: 1,
                  updatedAt: 1,
                },
              },
            ],
            as: "inventoryData",
          },
        },
        {
          $addFields: {
            branchInventories: {
              $map: {
                input: "$inventoryData",
                as: "inv",
                in: {
                  _id: "$$inv._id",
                  product_id: "$$inv.product_id",
                  branch_id: "$$inv.branch_id",
                  stock: "$$inv.quantity",
                  min_stock: "$$inv.min_stock_alert",
                  createdAt: "$$inv.createdAt",
                  updatedAt: "$$inv.updatedAt",
                },
              },
            },
            totalStock: {
              $sum: "$inventoryData.quantity",
            },
          },
        },
        ...(req.query.hasDebt === "true"
          ? [{ $match: { totalStock: { $lt: 0 } } }]
          : []),
        {
          $lookup: {
            from: "categories",
            localField: "category",
            foreignField: "_id",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  name: 1,
                  user: 1,
                  description: 1,
                  createdAt: 1,
                  updatedAt: 1,
                  __v: 1,
                },
              },
            ],
            as: "category",
          },
        },
        {
          $unwind: {
            path: "$category",
            preserveNullAndEmptyArrays: true,
          },
        },
        { $project: { inventoryData: 0 } },
        { $sort: { [sortBy]: sortOrder } },
        {
          $facet: {
            metadata: [{ $count: "total" }],
            data: [{ $skip: skip }, { $limit: limit }],
          },
        },
      ];
      const [result] =
        await Product.aggregate<ProductFacetAggregationResult>(pipeline);

      const total = result?.metadata[0]?.total || 0;
      const products = result?.data || [];

      return {
        products,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        currentPage: page,
      };
    };

    // Cache logic
    let data, fromCache;
    if (useCache && cacheKey) {
      ({ data, fromCache } = await getOrSetCache(cacheKey, fetchFromDB, ttl));
    } else {
      data = await fetchFromDB();
      fromCache = false;
    }

    if (data.currentPage > data.totalPages && data.totalPages > 0) {
      res.status(200).json({
        success: true,
        products: [],
        total: data.total,
        totalPages: data.totalPages,
        currentPage: page,
        fromCache,
      });
      return;
    }

    res.status(200).json({
      success: true,
      products: data.products,
      total: data.total,
      totalPages: data.totalPages,
      currentPage: data.currentPage,
      fromCache,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    res.status(500).json({ success: false, message });
  }
};

export const getProductById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const cacheKey = `product:${id}:${req.businessOwnerId}`;
    const { data: product, fromCache } = await getOrSetCache(cacheKey, () =>
      Product.findOne({ _id: id, user: req.businessOwnerId })
        .populate("category", "name")
        .lean(),
    );

    if (!product) {
      res
        .status(404)
        .json({ success: false, message: "Producto no encontrado" });
      return;
    }

    res.status(200).json({ success: true, product, fromCache });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    res.status(500).json({ success: false, message });
  }
};

// ─── Buscar producto por código de barras ──────────────────────
export const getProductByBarcode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { code } = req.params;
    const cacheKey = `barcode:${code}:${req.businessOwnerId}`;

    const { data: product, fromCache } = await getOrSetCache(cacheKey, () =>
      Product.findOne({ barcode: code, user: req.businessOwnerId })
        .populate("category", "name")
        .lean(),
    );

    if (!product) {
      res.status(404).json({
        success: false,
        message: "No se encontró un producto con ese código de barras",
      });
      return;
    }

    res.status(200).json({ success: true, product, fromCache });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    res.status(500).json({ success: false, message });
  }
};

export const updateProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, price, category, unit_type, barcode } = req.body;

    // Capturar el barcode anterior para invalidar su caché si cambia.
    let oldBarcode: string | undefined;

    if (barcode !== undefined) {
      const old = await Product.findOne(
        { _id: id, user: req.businessOwnerId },
        "barcode",
      ).lean();

      oldBarcode = old?.barcode;
    }

    // Validar que la categoría pertenezca al negocio.
    if (category) {
      const categoryExists = await Category.findOne({
        _id: category,
        user: req.businessOwnerId,
      });

      if (!categoryExists) {
        res.status(400).json({
          success: false,
          message: "La categoría especificada no existe",
        });
        return;
      }
    }

    // Evitar códigos de barras duplicados dentro del negocio.
    if (barcode) {
      const barcodeExists = await Product.findOne({
        barcode,
        user: req.businessOwnerId,
        _id: { $ne: id },
      });

      if (barcodeExists) {
        res.status(400).json({
          success: false,
          message: `El código de barras "${barcode}" ya está asignado al producto "${barcodeExists.name}"`,
        });
        return;
      }
    }

    interface ProductUpdateFields {
      name?: string;
      description?: string;
      price?: number;
      category?: string;
      unit_type?: string;
      barcode?: string | null;
    }

    const updateData: ProductUpdateFields = {};

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (category !== undefined) updateData.category = category;
    if (unit_type !== undefined) updateData.unit_type = unit_type;
    if (barcode !== undefined) updateData.barcode = barcode;

    const product = await Product.findOneAndUpdate(
      { _id: id, user: req.businessOwnerId },
      updateData,
      { returnDocument: "after", runValidators: true },
    ).populate("category", "name");

    if (!product) {
      res.status(404).json({
        success: false,
        message: "Producto no encontrado",
      });
      return;
    }

    // La escritura ya fue confirmada. La invalidación es secundaria.
    const keysToInvalidate = [`product:${id}:${req.businessOwnerId}`];

    if (oldBarcode) {
      keysToInvalidate.push(`barcode:${oldBarcode}:${req.businessOwnerId}`);
    }

    if (barcode && barcode !== oldBarcode) {
      keysToInvalidate.push(`barcode:${barcode}:${req.businessOwnerId}`);
    }

    const cacheResults = await Promise.allSettled([
      bumpCacheVersion("products", req.businessOwnerId),
      invalidateCache(...keysToInvalidate),
    ]);

    cacheResults.forEach((result) => {
      if (result.status === "rejected") {
        getCurrentLogger().error(
          {
            err: result.reason,
            productId: id,
            businessOwnerId: req.businessOwnerId,
          },
          "Failed to invalidate product cache after update",
        );
      }
    });

    res.status(200).json({ success: true, product });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";

    getCurrentLogger().error(
      { err: error, productId: req.params.id },
      "updateProduct error",
    );

    res.status(500).json({ success: false, message });
  }
};

export const deleteProduct = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const product = await Product.findOneAndDelete({
      _id: id,
      user: req.businessOwnerId,
    });

    if (!product) {
      res
        .status(404)
        .json({ success: false, message: "Producto no encontrado" });
      return;
    }

    // Invalidar caché paginada (bump de versión) + claves individuales
    const keysToInvalidate = [`product:${id}:${req.businessOwnerId}`];
    if (product.barcode) {
      keysToInvalidate.push(
        `barcode:${product.barcode}:${req.businessOwnerId}`,
      );
    }
    await Promise.all([
      bumpCacheVersion("products", req.businessOwnerId),
      invalidateCache(...keysToInvalidate),
    ]);

    res
      .status(200)
      .json({ success: true, message: "Producto eliminado correctamente" });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error interno del servidor";
    res.status(500).json({ success: false, message });
  }
};

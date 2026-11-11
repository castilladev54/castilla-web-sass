import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import app from "../server.js";
import { User } from "../models/User.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { Branch } from "../models/Branch.js";
import { Inventory } from "../models/Inventory.js";
import { StockMovement } from "../models/StockMovement.ts";
import bcryptjs from "bcryptjs";
import { getAuthHeadersForUser } from "./helpers/auth.js";

// Mocking external email delivery API to avoid sending real emails
vi.mock("../mailtrap/emails.js", () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

// Mock Redis: evita llamadas HTTP reales a Upstash en CI/CD
vi.mock("../lib/redis.js", () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    exists: vi.fn(async () => 0),
    pipeline: vi.fn(() => ({
      sismember: vi.fn().mockReturnThis(),
      sadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn(async () => [[null, 0]]),
    })),
  },
  getOrSetCache: vi.fn(async (_key, fn) => ({
    data: await fn(),
    fromCache: false,
  })),
  invalidateCache: vi.fn(async () => {}),
  bumpCacheVersion: vi.fn(async () => {}),
  getCacheVersion: vi.fn(async () => 0),
  bumpBranchCacheVersion: vi.fn(async () => {}),
  getBranchCacheVersion: vi.fn(async () => 0),
  buildPaginatedKey: vi.fn((_p, _v, _pg, _l, uid) => `mock:${uid}`),
}));

let mongoReplSet;

beforeAll(async () => {
  mongoReplSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, launchTimeout: 60000 },
    instanceOpts: [{ launchTimeout: 60000 }],
  });

  const mongoUri = mongoReplSet.getUri();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await mongoose.connect(mongoUri);
  await Promise.all([
    Product.init(),
    Inventory.init(),
    StockMovement.init(),
    Branch.init(),
  ]);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();

  if (mongoReplSet) {
    await mongoReplSet.stop();
  }
});

afterEach(async () => {
  await StockMovement.deleteMany({});
  await Inventory.deleteMany({});
  await Product.deleteMany({});
  vi.clearAllMocks();
});

describe("Product Controllers Integration", () => {
  let authHeaders;
  let categoryId;
  let userId;
  let testEmail;
  let branchId;

  beforeAll(async () => {
    testEmail = `user${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

    // 1. Creamos un usuario de prueba directamente en DB (pues signup ya no existe)
    const hashedPassword = await bcryptjs.hash("password123", 10);
    const user = await User.create({
      email: testEmail,
      password: hashedPassword,
      name: "Test Admin",
      role: "admin",
    });
    userId = user._id.toString();

    const branch = await Branch.create({
      name: "Test Branch",
      address: "Test Address",
      owner_id: user._id,
      is_active: true,
      max_debt_limit: -20,
    });
    branchId = branch._id;

    // 2. Generar JWT directamente (stateless, sin login HTTP)
    authHeaders = getAuthHeadersForUser(user._id, user.role);

    // 3. Creamos una categoría directamente en la BD asociandolo a nuestro usuario
    const category = new Category({
      name: "Test Category DB",
      description: "Created from DB",
      user: userId,
    });
    await category.save();
    categoryId = category._id.toString();
  });

  describe("POST /api/products", () => {
    it("should create a new product successfully with unit_type (kg support)", async () => {
      const response = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "Test Product",
          description: "A great test product",
          price: 150,
          category: categoryId,
          unit_type: "kg",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.product.name).toBe("Test Product");
      expect(response.body.product.price).toBe("150");
      // stock ya no vive en Product — migrado a Inventory
      expect(response.body.product.category).toBe(categoryId);
      expect(response.body.product.user).toBe(userId);
      expect(response.body.product.unit_type).toBe("kg");

      expect(
        await Inventory.countDocuments({
          product_id: response.body.product._id,
        }),
      ).toBe(0);

      expect(
        await StockMovement.countDocuments({
          product_id: response.body.product._id,
        }),
      ).toBe(0);
    });

    it("should return 400 if category does not exist for this user", async () => {
      const fakeCategoryId = new mongoose.Types.ObjectId().toString(); // ID válido pero no existente
      const response = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "Test Product Fake Cat",
          price: 100,
          category: fakeCategoryId,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("La categoría especificada no existe");
    });

    it("should return validation error if required fields are missing", async () => {
      const response = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          // Falta 'name' y 'price'
          category: categoryId,
        });

      expect(response.status).toBe(400); // Bad Request proveniente de Zod o mongoose
      expect(response.body.success).toBe(false);
    });

    it("should create product, initial inventory and stock movement atomically", async () => {
      const initialStock = "12.5";

      const response = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "Product With Initial Stock",
          price: 25,
          category: categoryId,
          unit_type: "kg",
          initial_stock: initialStock,
          branch_id: branchId.toString(),
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const productId = response.body.product._id;

      const inventory = await Inventory.findOne({
        product_id: productId,
        branch_id: branchId,
        owner_id: userId,
      });

      expect(inventory).not.toBeNull();
      expect(inventory.quantity.toString()).toBe(initialStock);

      const movement = await StockMovement.findOne({
        product_id: productId,
        branch_id: branchId,
        owner_id: userId,
      });

      expect(movement).not.toBeNull();
      expect(movement.type).toBe("INITIAL_INVENTORY");
      expect(movement.quantity_change.toString()).toBe(initialStock);
      expect(movement.previous_quantity.toString()).toBe("0");
      expect(movement.new_quantity.toString()).toBe(initialStock);
    });

    it("should return 201 when session cleanup fails after transaction commit", async () => {
      const initialStock = "8.5";

      const originalStartSession = mongoose.startSession.bind(mongoose);

      const startSessionSpy = vi
        .spyOn(mongoose, "startSession")
        .mockImplementation(async (...args) => {
          const session = await originalStartSession(...args);
          const originalEndSession = session.endSession.bind(session);

          vi.spyOn(session, "endSession").mockImplementation(async () => {
            await originalEndSession();
            throw new Error("Simulated session cleanup failure");
          });

          return session;
        });

      try {
        const response = await request(app)
          .post("/api/products")
          .set({ ...authHeaders, "x-branch-id": branchId.toString() })
          .send({
            name: "Product With Session Cleanup Failure",
            price: 35,
            category: categoryId,
            unit_type: "kg",
            initial_stock: initialStock,
            branch_id: branchId.toString(),
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);

        const productId = response.body.product._id;

        const product = await Product.findById(productId);
        const inventory = await Inventory.findOne({
          product_id: productId,
          branch_id: branchId,
          owner_id: userId,
        });
        const movement = await StockMovement.findOne({
          product_id: productId,
          branch_id: branchId,
          owner_id: userId,
        });

        expect(product).not.toBeNull();
        expect(inventory).not.toBeNull();
        expect(inventory.quantity.toString()).toBe(initialStock);
        expect(movement).not.toBeNull();
        expect(movement.type).toBe("INITIAL_INVENTORY");
      } finally {
        startSessionSpy.mockRestore();
      }
    });

    it("should reject initial inventory for a branch owned by another business", async () => {
      const foreignBranch = await Branch.create({
        name: "Foreign Branch",
        address: "Foreign Address",
        owner_id: new mongoose.Types.ObjectId(),
        is_active: true,
        max_debt_limit: -20,
      });

      const response = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "Product With Foreign Branch",
          price: 30,
          category: categoryId,
          unit_type: "unidad",
          initial_stock: "7",
          branch_id: foreignBranch._id.toString(),
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);

      expect(
        await Product.countDocuments({
          name: "Product With Foreign Branch",
          user: userId,
        }),
      ).toBe(0);

      expect(await Inventory.countDocuments({ branch_id: foreignBranch._id })).toBe(0);

      expect(
        await StockMovement.countDocuments({ branch_id: foreignBranch._id }),
      ).toBe(0);
    });
  });

  describe("GET /api/products", () => {
    it("should return empty list if user has no products", async () => {
      const response = await request(app)
        .get("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.products).toHaveLength(0);
    });

    it("should return list of products for the logged in user with populated category", async () => {
      // Creamos un producto primero
      await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "My Custom Product",
          price: 60,
          category: categoryId,
        });

      const response = await request(app)
        .get("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() });

      expect(response.status).toBe(200);
      expect(response.body.products).toHaveLength(1);
      expect(response.body.products[0].name).toBe("My Custom Product");
      expect(response.body.products[0].category._id).toBe(categoryId);
      expect(response.body.products[0].category.name).toBe("Test Category DB"); // 'name' debe venir populated
    });

    describe('branch inventory isolation', () => {
      let secondBranchId;

      beforeAll(async () => {
        const secondBranch = await Branch.create({
          name: 'Second Test Branch',
          address: 'Second Test Address',
          owner_id: new mongoose.Types.ObjectId(userId),
          is_active: true,
          max_debt_limit: -20,
        });

        secondBranchId = secondBranch._id;
      });

      beforeEach(async () => {
        const productA = await Product.create({
          name: 'Producto A',
          barcode: 'TEST-PRODUCT-A',
          price: mongoose.Types.Decimal128.fromString('10.00'),
          category: new mongoose.Types.ObjectId(categoryId),
          user: new mongoose.Types.ObjectId(userId),
          unit_type: 'unidad',
        });

        const productB = await Product.create({
          name: 'Producto B',
          barcode: 'TEST-PRODUCT-B',
          price: mongoose.Types.Decimal128.fromString('20.00'),
          category: new mongoose.Types.ObjectId(categoryId),
          user: new mongoose.Types.ObjectId(userId),
          unit_type: 'kg',
        });

        await Inventory.create([
          {
            product_id: productA._id,
            branch_id: branchId,
            owner_id: new mongoose.Types.ObjectId(userId),
            quantity: mongoose.Types.Decimal128.fromString('9'),
          },
          {
            product_id: productA._id,
            branch_id: secondBranchId,
            owner_id: new mongoose.Types.ObjectId(userId),
            quantity: mongoose.Types.Decimal128.fromString('3'),
          },
          {
            product_id: productB._id,
            branch_id: secondBranchId,
            owner_id: new mongoose.Types.ObjectId(userId),
            quantity: mongoose.Types.Decimal128.fromString('5'),
          },
        ]);
      });

      it('should return the complete catalog without inventory when no branch is selected', async () => {
        const response = await request(app)
          .get('/api/products')
          .set(authHeaders);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.products).toHaveLength(2);

        for (const product of response.body.products) {
          expect(product.branchInventories).toEqual([]);
          expect(Number(product.totalStock)).toBe(0);
        }
      });

      it('should return only inventory belonging to the selected branch A', async () => {
        const response = await request(app)
          .get('/api/products')
          .set({
            ...authHeaders,
            'x-branch-id': branchId.toString(),
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.products).toHaveLength(2);

        const productA = response.body.products.find(
          product => product.name === 'Producto A'
        );

        const productB = response.body.products.find(
          product => product.name === 'Producto B'
        );

        expect(productA).toBeDefined();
        expect(productB).toBeDefined();

        expect(productA.branchInventories).toHaveLength(1);
        expect(Number(productA.branchInventories[0].stock)).toBe(9);
        expect(Number(productA.totalStock)).toBe(9);

        expect(productB.branchInventories).toEqual([]);
        expect(Number(productB.totalStock)).toBe(0);
      });

      it('should return only inventory belonging to the selected branch B', async () => {
        const response = await request(app)
          .get('/api/products')
          .set({
            ...authHeaders,
            'x-branch-id': secondBranchId.toString(),
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.products).toHaveLength(2);

        const productA = response.body.products.find(
          product => product.name === 'Producto A'
        );

        const productB = response.body.products.find(
          product => product.name === 'Producto B'
        );

        expect(productA).toBeDefined();
        expect(productB).toBeDefined();

        expect(productA.branchInventories).toHaveLength(1);
        expect(Number(productA.branchInventories[0].stock)).toBe(3);
        expect(Number(productA.totalStock)).toBe(3);

        expect(productB.branchInventories).toHaveLength(1);
        expect(Number(productB.branchInventories[0].stock)).toBe(5);
        expect(Number(productB.totalStock)).toBe(5);
      });
    });
  });

  describe("GET /api/products/:id", () => {
    it("should fetch a specific product by its ID", async () => {
      // Creamos primero
      const createRes = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "Target Product",
          price: 75,
          category: categoryId,
        });
      const productId = createRes.body.product._id;

      // Buscamos
      const response = await request(app)
        .get(`/api/products/${productId}`)
        .set({ ...authHeaders, "x-branch-id": branchId.toString() });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.product.name).toBe("Target Product");
      expect(response.body.product.category.name).toBe("Test Category DB"); // Viene populated
    });

    it("should return 404 for non-existent product ID", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const response = await request(app)
        .get(`/api/products/${fakeId}`)
        .set({ ...authHeaders, "x-branch-id": branchId.toString() });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Producto no encontrado");
    });
  });

  describe("PUT /api/products/:id", () => {
    it("should update a product successfully (ignoring stock, updating unit_type)", async () => {
      // Creamos
      const createRes = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "Old Name",
          price: 10,
          category: categoryId,
          unit_type: "unidad",
        });
      const productId = createRes.body.product._id;

      // Actualizamos
      const response = await request(app)
        .put(`/api/products/${productId}`)
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "New Name",
          price: 20,
          unit_type: "litro",
          quantity: 99, // Este valor debería ignorarse según la lógica del controlador
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.product.name).toBe("New Name");
      expect(response.body.product.price).toBe("20");
      expect(response.body.product.unit_type).toBe("litro");
      // stock ya no vive en Product — migrado a Inventory
    });

    it("should return 400 if trying to update with non-existent category", async () => {
      const createRes = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({ name: "Prod", price: 10, category: categoryId });
      const productId = createRes.body.product._id;

      const fakeCategoryId = new mongoose.Types.ObjectId().toString();
      const response = await request(app)
        .put(`/api/products/${productId}`)
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({ category: fakeCategoryId });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("La categoría especificada no existe");
    });
  });

  describe("DELETE /api/products/:id", () => {
    it("should delete a product successfully", async () => {
      // Creamos
      const createRes = await request(app)
        .post("/api/products")
        .set({ ...authHeaders, "x-branch-id": branchId.toString() })
        .send({
          name: "To be deleted",
          price: 100,
          category: categoryId,
        });
      const productId = createRes.body.product._id;

      // Eliminamos
      const response = await request(app)
        .delete(`/api/products/${productId}`)
        .set({ ...authHeaders, "x-branch-id": branchId.toString() });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Producto eliminado correctamente");

      // Verificamos que ya no exista
      const verifyRes = await request(app)
        .get(`/api/products/${productId}`)
        .set({ ...authHeaders, "x-branch-id": branchId.toString() });
      expect(verifyRes.status).toBe(404);
    });

    it("should return 404 for deleting non-existent product", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const response = await request(app)
        .delete(`/api/products/${fakeId}`)
        .set({ ...authHeaders, "x-branch-id": branchId.toString() });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Producto no encontrado");
    });
  });
});
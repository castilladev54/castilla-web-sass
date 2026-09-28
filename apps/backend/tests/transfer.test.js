import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import app from '../server.js';
import { User } from '../models/User.js';
import { Branch } from '../models/Branch.js';
import { Product } from '../models/Product.js';
import { Inventory } from '../models/Inventory.js';
import {
  StockMovement,
  StockMovementType
} from '../models/StockMovement.js';

import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { getAuthHeadersForUser } from './helpers/auth.js';

describe('POST /api/transfers', () => {
  let mongoServer;

  let owner;
  let otherOwner;

  let sourceBranch;
  let destinationBranch;
  let otherOwnerBranch;

  let product;

  let authHeaders;

  beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({
      binary: {
        version: '7.0.14',
      },
      replSet: {
        count: 1,
      },
      instanceOpts: [
        {
          launchTimeout: 60000,
        },
      ],
    });

    await mongoose.connect(mongoServer.getUri());

    await Promise.all(
      mongoose.modelNames().map((modelName) =>
        mongoose.model(modelName).init(),
      ),
    );

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    console.log('MONGO HELLO:', {
      setName: hello.setName,
      isWritablePrimary: hello.isWritablePrimary,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Branch.deleteMany({}),
      Product.deleteMany({}),
      Inventory.deleteMany({}),
      StockMovement.deleteMany({})
    ]);

    const passwordHash = await bcrypt.hash('Password123!', 10);

    owner = await User.create({
      name: 'Transfer Owner',
      email: `owner-${Date.now()}@test.com`,
      password: passwordHash,
      role: 'TENANT_OWNER'
    });

    otherOwner = await User.create({
      name: 'Other Owner',
      email: `other-${Date.now()}@test.com`,
      password: passwordHash,
      role: 'TENANT_OWNER'
    });

    sourceBranch = await Branch.create({
      name: 'Sucursal Origen',
      address: 'Address 1',
      owner_id: owner._id,
      is_active: true
    });

    destinationBranch = await Branch.create({
      name: 'Sucursal Destino',
      address: 'Address 2',
      owner_id: owner._id,
      is_active: true
    });

    otherOwnerBranch = await Branch.create({
      name: 'Sucursal Otro Owner',
      address: 'Address 3',
      owner_id: otherOwner._id,
      is_active: true
    });

    product = await Product.create({
      name: 'Producto Transferible',
      description: 'Producto para pruebas de transferencia',
      price: '10',
      category: new mongoose.Types.ObjectId(),
      unit_type: 'unidad',
      user: owner._id
    });

    await Inventory.create({
      product_id: product._id,
      branch_id: sourceBranch._id,
      owner_id: owner._id,
      quantity: mongoose.Types.Decimal128.fromString('10'),
      min_stock_alert: mongoose.Types.Decimal128.fromString('0')
    });

    authHeaders = await getAuthHeadersForUser(owner._id, owner.role, { ownerId: owner._id });
  });

  it('debe transferir stock correctamente entre dos sucursales', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '3'
          }
        ],
        notes: 'Transferencia de prueba'
      });

    console.log('TRANSFER RESPONSE:', response.status, response.body);

    expect(response.status).toBe(200);

    console.log('TRANSFER RESPONSE:', response.status, response.body);

    expect(response.body).toMatchObject({
      success: true,
      message: 'Transferencia completada exitosamente.',
      transfer: {
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        status: 'COMPLETED',
        createdBy: owner._id.toString(),
        businessOwnerId: owner._id.toString(),
        notes: 'Transferencia de prueba',
      },
    });

    expect(response.body.transfer.items).toEqual([
      {
        product_id: product._id.toString(),
        quantity: '3',
      },
    ]);

    const sourceInventory = await Inventory.findOne({
      branch_id: sourceBranch._id,
      product_id: product._id
    });

    const destinationInventory = await Inventory.findOne({
      branch_id: destinationBranch._id,
      product_id: product._id
    });

    expect(sourceInventory.quantity.toString()).toBe('7');
    expect(destinationInventory.quantity.toString()).toBe('3');

    const movements = await StockMovement.find({
      product_id: product._id
    }).sort({ createdAt: 1 });

    expect(movements).toHaveLength(2);

    const transferOut = movements.find(
      (movement) => movement.type === StockMovementType.TRANSFER_OUT
    );

    const transferIn = movements.find(
      (movement) => movement.type === StockMovementType.TRANSFER_IN
    );

    expect(transferOut).toBeDefined();
    expect(transferIn).toBeDefined();

    expect(transferOut.quantity_change.toString()).toBe('-3');
    expect(transferOut.previous_quantity.toString()).toBe('10');
    expect(transferOut.new_quantity.toString()).toBe('7');

    expect(transferIn.quantity_change.toString()).toBe('3');
    expect(transferIn.previous_quantity.toString()).toBe('0');
    expect(transferIn.new_quantity.toString()).toBe('3');
  });

  it('debe aceptar cantidades decimales', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '2.5'
          }
        ]
      });

    expect(response.status).toBe(200);

    const sourceInventory = await Inventory.findOne({
      branch_id: sourceBranch._id,
      product_id: product._id
    });

    const destinationInventory = await Inventory.findOne({
      branch_id: destinationBranch._id,
      product_id: product._id
    });

    expect(sourceInventory.quantity.toString()).toBe('7.5');
    expect(destinationInventory.quantity.toString()).toBe('2.5');
  });

  it('debe crear el inventario destino cuando no existe', async () => {
    const destinationInventoryBefore = await Inventory.findOne({
      branch_id: destinationBranch._id,
      product_id: product._id
    });

    expect(destinationInventoryBefore).toBeNull();

    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '4'
          }
        ]
      });

    expect(response.status).toBe(200);

    const destinationInventory = await Inventory.findOne({
      branch_id: destinationBranch._id,
      product_id: product._id
    });

    expect(destinationInventory).not.toBeNull();
    expect(destinationInventory.quantity.toString()).toBe('4');
  });

  it('debe rechazar cantidad igual a cero', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '0'
          }
        ]
      });

    expect(response.status).toBe(400);
  });

  it('debe rechazar cantidad negativa', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '-2'
          }
        ]
      });

    expect(response.status).toBe(400);
  });

  it('debe rechazar sucursal origen y destino iguales', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: sourceBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '2'
          }
        ]
      });

    expect(response.status).toBe(400);
  });

  it('debe rechazar transferencia sin items', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: []
      });

    expect(response.status).toBe(400);
  });

  it('debe rechazar producto inexistente', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: new mongoose.Types.ObjectId().toString(),
            quantity: '2'
          }
        ]
      });

    expect(response.status).toBe(400);
  });

  it('debe rechazar stock insuficiente', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '11'
          }
        ]
      });

    expect(response.status).toBe(400);

    const sourceInventory = await Inventory.findOne({
      branch_id: sourceBranch._id,
      product_id: product._id
    });

    const destinationInventory = await Inventory.findOne({
      branch_id: destinationBranch._id,
      product_id: product._id
    });

    expect(sourceInventory.quantity.toString()).toBe('10');
    expect(destinationInventory).toBeNull();

    const movements = await StockMovement.find({
      product_id: product._id
    });

    expect(movements).toHaveLength(0);
  });

  it('debe rechazar sucursal de origen de otro tenant', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: otherOwnerBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '2'
          }
        ]
      });

    expect(response.status).toBe(404);
  });

  it('debe rechazar sucursal destino de otro tenant', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: otherOwnerBranch._id.toString(),
        items: [
          {
            product_id: product._id.toString(),
            quantity: '2'
          }
        ]
      });

    expect(response.status).toBe(404);
  });

  it('debe rechazar product_id con formato inválido', async () => {
    const response = await request(app)
      .post('/api/transfers')
      .set(authHeaders)
      .send({
        sourceBranchId: sourceBranch._id.toString(),
        destinationBranchId: destinationBranch._id.toString(),
        items: [
          {
            product_id: 'invalid-id',
            quantity: '2'
          }
        ]
      });

    expect(response.status).toBe(400);
  });

  it('debe rechazar quantity que no sea un numericString válido', async () => {
    const invalidQuantities = ['abc', '2abc', '1,5', '1.2.3'];

    for (const quantity of invalidQuantities) {
      const response = await request(app)
        .post('/api/transfers')
        .set(authHeaders)
        .send({
          sourceBranchId: sourceBranch._id.toString(),
          destinationBranchId: destinationBranch._id.toString(),
          items: [
            {
              product_id: product._id.toString(),
              quantity
            }
          ]
        });

      expect(response.status).toBe(400);
    }
  });
});

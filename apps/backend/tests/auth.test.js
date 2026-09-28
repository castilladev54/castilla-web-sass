import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../server.js';
import { User } from '../models/User.js';
import bcryptjs from 'bcryptjs';
import { getAuthHeadersForUser } from './helpers/auth.js';

// Mocking external email delivery API
vi.mock('../mailtrap/emails.js', () => ({
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

let mongoServer;

beforeAll(async () => {
  // Asegurar que exista una clave secreta para los tests
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key';

  mongoServer = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14' },
    replSet: { count: 1 },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
  vi.clearAllMocks();
});

describe('Auth Controllers Integration', () => {

  describe('POST /api/auth/create-user', () => {
    let adminHeaders;

    beforeEach(async () => {
      // 1. Inyectar un admin directo a la BD para las pruebas
      const hashedPassword = await bcryptjs.hash('admin123', 10);
      const admin = await User.create({
        email: 'admin@test.com',
        password: hashedPassword,
        name: 'Admin User',
        role: 'admin'
      });
      
      // 2. Generar Bearer token directamente (stateless)
      adminHeaders = getAuthHeadersForUser(admin._id, admin.role);
    });

    it('should allow admin to create a new customer successfully', async () => {
      const response = await request(app)
        .post('/api/auth/create-user')
        .set(adminHeaders)
        .send({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test Customer'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.email).toBe('test@example.com');
      
      // verify DB directly
      const userInDb = await User.findOne({ email: 'test@example.com' });
      expect(userInDb).toBeTruthy();
      expect(userInDb.subscriptionExpiresAt).toBeDefined();
    });

    it('should reject unauthenticated request without admin token', async () => {
      const response = await request(app)
        .post('/api/auth/create-user')
        // No enviamos el header Authorization
        .send({
          email: 'hacker@example.com',
          password: 'password123',
          name: 'Hacker'
        });

      expect(response.status).toBe(401); // Unauthorized
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      const hashedPassword = await bcryptjs.hash('password123', 10);
      await User.create({
        email: 'login@example.com',
        password: hashedPassword,
        name: 'Login User'
      });
    });

    it('should login with correct credentials and return a Bearer token in the body', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // El token ahora viaja en el JSON, no en una cookie
      expect(response.body.token).toBeDefined();
      expect(typeof response.body.token).toBe('string');
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Invalid credentials');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should return 200 and instruct client to purge local storage', async () => {
      const response = await request(app).post('/api/auth/logout');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // El servidor ya no limpia cookies; le indica al cliente que purgue su estado
      expect(response.body.message).toContain('Client must purge local authentication storage');
    });
  });

  describe('GET /api/auth/check-auth', () => {
    let userHeaders;
    
    beforeEach(async () => {
      const hashedPassword = await bcryptjs.hash('password123', 10);
      const user = await User.create({
        email: 'check@example.com',
        password: hashedPassword,
        name: 'Check User'
      });
      userHeaders = getAuthHeadersForUser(user._id, user.role);
    });

    it('should return user info when authenticated via Bearer token', async () => {
      const response = await request(app)
        .get('/api/auth/check-auth')
        .set(userHeaders);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('check@example.com');
    });

    it('should return 401 if unauthenticated (no token)', async () => {
      const response = await request(app).get('/api/auth/check-auth');
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized - no token provided');
    });
  });
});

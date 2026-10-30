import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../server.js';
import { User, ROLES } from '../models/User.js';
import { ExchangeRate } from '../models/ExchangeRate.js';
import bcryptjs from 'bcryptjs';
import { getAuthHeadersForUser } from './helpers/auth.js';

// ───────────────────────────────────────────────────────────────
// MOCKS OBLIGATORIOS (idénticos a los de toda la suite de tests)
// ───────────────────────────────────────────────────────────────

vi.mock('../mailtrap/emails.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
  },
  getOrSetCache: vi.fn(async (_key: string, fn: () => Promise<unknown>) => ({ data: await fn(), fromCache: false })),
  invalidateCache: vi.fn(async () => { }),
  bumpCacheVersion: vi.fn(async () => { }),
  getCacheVersion: vi.fn(async () => 0),
  buildPaginatedKey: vi.fn((_p: string, _v: unknown, _pg: unknown, _l: unknown, uid: string) => `mock:${uid}`),
}));

// ───────────────────────────────────────────────────────────────
// SETUP: MongoMemoryServer (igual que el resto de la suite)
// ───────────────────────────────────────────────────────────────

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(mongoUri);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

afterEach(async () => {
  await ExchangeRate.deleteMany({});
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// SUITE DE INTEGRACIÓN: MOTOR CAMBIARIO Y ZONAS HORARIAS
//
// Campos reales del modelo ExchangeRate:
//   - customer_id (ObjectId, ref: User)  → dueño del negocio
//   - rate        (Number, min: 0.01)    → tasa de cambio
//   - date        (Date)                 → día normalizado (VE TZ)
//
// Endpoints reales:
//   POST /api/rates          → setDailyRate  (upsert por día + ownerId)
//   GET  /api/rates/today    → getDailyRate  (tasa más reciente)
//   GET  /api/rates/history  → getRateHistory (historial paginado)
//
// El controlador normaliza fechas a timezone Venezuela (UTC-4)
// usando getStartOfDayVE() antes de guardar en MongoDB.
// ═══════════════════════════════════════════════════════════════

describe('Suite de Integración: Motor Cambiario y Zonas Horarias', () => {
  let authHeaders: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    const testEmail = `ratetest${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    const hashedPassword = await bcryptjs.hash('password123', 10);
    const user = await User.create({
      email: testEmail,
      password: hashedPassword,
      name: 'Rate Tester',
      role: 'admin',
    });
    userId = user._id.toString();
    authHeaders = getAuthHeadersForUser(user._id, user.role);
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 1: PRUEBA DE COLISIÓN (UPSERT)
  // Debe sobrescribir silenciosamente la tasa si se actualiza
  // el mismo día, sin explotar por E11000 duplicate key.
  // ─────────────────────────────────────────────────────────────
  it('1. PRUEBA DE COLISIÓN (UPSERT): Debe sobrescribir silenciosamente la tasa si se actualiza el mismo día', async () => {
    const targetDate = '2026-07-10';

    // Inserción inicial vía API
    const res1 = await request(app)
      .post('/api/rates')
      .set(authHeaders)
      .send({ rate: '45.50', date: targetDate });

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.exchangeRate.rate).toBe('45.5');

    // Intento de sobrescritura del MISMO DÍA con nueva tasa
    const res2 = await request(app)
      .post('/api/rates')
      .set(authHeaders)
      .send({ rate: '46.20', date: targetDate });

    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);

    // Verificamos que no explotó por E11000 y que hay exactamente 1 documento
    const ratesCount = await ExchangeRate.countDocuments({ customer_id: userId });
    expect(ratesCount).toBe(1);

    // La tasa final debe ser la actualizada (46.20), no la original (45.50)
    const finalRate = await ExchangeRate.findOne({ customer_id: userId });
    expect(finalRate?.rate?.toString()).toBe('46.2');
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 2: PRUEBA DE BUCLE TEMPORAL
  // El servidor no debe desfasar fechas. Dos tasas con fechas
  // distintas deben generar documentos separados sin colisión,
  // y el índice compuesto { customer_id, date } lo permite.
  // ─────────────────────────────────────────────────────────────
  it('2. PRUEBA DE BUCLE TEMPORAL: Fechas distintas generan registros separados sin colisión', async () => {
    // Tasa del 10 de julio
    const res1 = await request(app)
      .post('/api/rates')
      .set(authHeaders)
      .send({ rate: '45.00', date: '2026-07-10' });

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);

    // Tasa del 11 de julio (día siguiente)
    const res2 = await request(app)
      .post('/api/rates')
      .set(authHeaders)
      .send({ rate: '46.50', date: '2026-07-11' });

    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);

    // Validamos que el índice compuesto permitió ambos registros sin colisión
    const totalRates = await ExchangeRate.countDocuments({ customer_id: userId });
    expect(totalRates).toBe(2);

    // Verificamos que las tasas corresponden a cada fecha
    const history = await ExchangeRate.find({ customer_id: userId }).sort({ date: -1 }).lean();
    expect(history[0].rate.toString()).toBe('46.5'); // 11 julio (más reciente)
    expect(history[1].rate.toString()).toBe('45'); // 10 julio
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 3: PRUEBA DE BLOQUEO ESTRICTO
  // Si NO hay ninguna tasa registrada, getDailyRate debe
  // devolver null — nunca inventar datos.
  // (El controlador real devuelve 200 + rate: null cuando no hay
  // registro, permitiendo al frontend bloquear la caja.)
  // ─────────────────────────────────────────────────────────────
  it('3. PRUEBA DE BLOQUEO ESTRICTO: Debe devolver null si no hay tasa registrada (No Fallback inventado)', async () => {
    // No insertamos ninguna tasa — la BD está vacía tras afterEach

    // Consultamos la tasa de hoy
    const res = await request(app)
      .get('/api/rates/today')
      .set(authHeaders);

    // El sistema DEBE devolver null para que el frontend bloquee la caja
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rate).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 4: PRUEBA DE INVALIDACIÓN DE CACHÉ
  // Redis debe purgarse tras una nueva inserción/actualización.
  // El controlador usa invalidateCache() de ../lib/redis.js
  // para limpiar las claves rate:today:{ownerId} y
  // rate:history:{ownerId}:30.
  // ─────────────────────────────────────────────────────────────
  it('4. PRUEBA DE INVALIDACIÓN DE CACHÉ: Redis debe purgarse tras una nueva inserción', async () => {
    const { invalidateCache } = await import('../lib/redis.js');

    // Ejecutamos una actualización manual de tasa y verificamos la respuesta
    const response = await request(app)
      .post('/api/rates')
      .set(authHeaders)
      .send({ rate: '47.00' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Verificamos que el controlador ejecutó el comando de purga en Redis
    expect(invalidateCache).toHaveBeenCalled();
    // Verifica que se purgaron las claves correctas (rate:today + rate:history)
    expect(invalidateCache).toHaveBeenCalledWith(
      `rate:today:${userId}`,
      `rate:history:${userId}:30`
    );
  });

  // ─────────────────────────────────────────────────────────────
  // TEST 5: CONTROL DE ACCESO Y AUTORIZACIÓN (RBAC)
  // Verificar acceso a POST /api/rates según el rol:
  //   - admin:        200 OK
  //   - TENANT_OWNER: 200 OK
  //   - employee:     403 Forbidden
  // ─────────────────────────────────────────────────────────────
  describe('5. CONTROL DE ACCESO Y AUTORIZACIÓN (RBAC): POST /api/rates', () => {
    it('Permite registrar/actualizar tasa a usuarios con rol admin (200)', async () => {
      const adminHeaders = getAuthHeadersForUser(userId, ROLES.ADMIN);

      const res = await request(app)
        .post('/api/rates')
        .set(adminHeaders)
        .send({ rate: '50.25', date: '2026-08-01' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.exchangeRate.rate).toBe('50.25');
    });

    it('Permite registrar/actualizar tasa a usuarios con rol TENANT_OWNER (200)', async () => {
      const ownerHeaders = getAuthHeadersForUser(userId, ROLES.TENANT_OWNER);

      const res = await request(app)
        .post('/api/rates')
        .set(ownerHeaders)
        .send({ rate: '51.50', date: '2026-08-02' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.exchangeRate.rate).toBe('51.5');
    });

    it('Deniega el acceso a usuarios con rol employee aunque envíen un cuerpo válido (403)', async () => {
      const employeeHeaders = getAuthHeadersForUser(userId, ROLES.EMPLOYEE, {
        ownerId: userId,
      });

      const res = await request(app)
        .post('/api/rates')
        .set(employeeHeaders)
        .send({ rate: '52.75', date: '2026-08-03' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/acceso denegado/i);

      // Verificamos que la tasa no fue persistida en la base de datos
      const rateInDb = await ExchangeRate.findOne({ rate: 52.75 });
      expect(rateInDb).toBeNull();
    });
  });
});


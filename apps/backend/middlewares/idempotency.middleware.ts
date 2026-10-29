import { Request, Response, NextFunction } from 'express';
import { idempotencyHeaderSchema } from '@inventory/shared';
import { redis } from '../lib/redis.js';
import { getCurrentLogger } from '../lib/logger.js';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 horas

/**
 * Middleware que verifica si un request transaccional ya fue procesado o está en proceso,
 * utilizando Redis (SET NX) para implementar un cerrojo distribuido (Distributed Lock).
 */
export const checkIdempotency = async (req: Request | any, res: Response, next: NextFunction) => {
  try {
    const key = req.headers['x-idempotency-key'];

    if (!key) {
      return res.status(400).json({ success: false, message: 'Falta la cabecera x-idempotency-key' });
    }

    const parsed = idempotencyHeaderSchema.safeParse(key);
    if (!parsed.success) {
      return res.status(400).json({ success: false, essage: parsed.error.issues[0]?.message ?? 'Cabecera x-idempotency-key inválida' });
    }

    const actorId = req.actorId?.toString() ?? req.userId?.toString();
    const businessOwnerId = req.businessOwnerId?.toString();

    if (!actorId || !businessOwnerId) {
      return res.status(401).json({
        success: false,
        message: 'No se pudo identificar al usuario y su negocio para procesar la solicitud.',
      });
    }

    const redisKey = `idempotency:${businessOwnerId}:${actorId}:${key}`;

    // SET NX: Guardamos el estado explícito PROCESSING
    const processingState = JSON.stringify({ state: "PROCESSING" });
    const lockAcquired = await redis.set(redisKey, processingState, { nx: true, ex: IDEMPOTENCY_TTL_SECONDS });

    if (lockAcquired) {
      req.idempotencyKey = redisKey;

      // Fase 5: Limpieza robusta. Si cualquier middleware o controlador falla (statusCode >= 400),
      // liberamos el lock. Esto cubre fallos en validate() y errores de negocio.
      res.on('finish', () => {
        if (res.statusCode >= 400) {
          redis.del(redisKey).catch(err => getCurrentLogger().error({ err }, "Error borrando lock idempotente on finish"));
        }
      });

      return next();
    }

    // Si lockAcquired es nulo, la llave ya existe.
    const existingRaw = await redis.get(redisKey);
    // Upstash Redis parsea JSON automáticamente si detecta un objeto, así que manejamos ambos casos.
    const existingState = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;

    if (existingState?.state === "PROCESSING") {
      getCurrentLogger().warn({ redisKey }, "Intento concurrente bloqueado por idempotencia");
      return res.status(409).json({
        success: false,
        message: 'La transacción está siendo procesada actualmente. Por favor, espere.'
      });
    }

    if (existingState?.state === "COMPLETED") {
      getCurrentLogger().info({ redisKey }, "Devolviendo respuesta cacheada por idempotencia");
      res.setHeader('X-Idempotent-Replay', 'true');
      return res.status(200).json(existingState.response);
    }

    // Fallback por si la estructura está corrupta o no coincide
    return res.status(409).json({ success: false, message: 'Estado de transacción inválido.' });

  } catch (error) {
    getCurrentLogger().error({ err: error }, "Error en checkIdempotency");
    return res.status(503).json({ success: false, message: 'Servicio de idempotencia temporalmente no disponible.' });
  }
};

/**
 * Higher-Order Function (Wrapper) para el controlador transaccional.
 */
export const withIdempotency = (controllerFn: any) => {
  return async (req: Request | any, res: Response | any, next: NextFunction) => {
    try {
      const responsePayload = await controllerFn(req, res, next);

      if (responsePayload && req.idempotencyKey) {
        // Fase 6: Estado explícito COMPLETED + response
        const completedState = JSON.stringify({ state: "COMPLETED", response: responsePayload });
        await redis.set(req.idempotencyKey, completedState, { ex: IDEMPOTENCY_TTL_SECONDS });
        return res.status(201).json(responsePayload);
      }
    } catch (error) {
      // Ya no borramos el lock aquí porque res.on('finish') en checkIdempotency lo hará
      // de forma global si la respuesta termina en error (statusCode >= 400).
      next(error);
    }
  };
};

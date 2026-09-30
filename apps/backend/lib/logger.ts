import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

const isDev = process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // En producción, Pino escribe asíncronamente por defecto para no bloquear el Event Loop.
  // En desarrollo, usamos pino-pretty para legibilidad.
  transport: isDev
    ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
    : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Almacén asíncrono para mantener el contexto del logger (con reqId) sin acoplar código a Express
export const loggerStorage = new AsyncLocalStorage<pino.Logger>();

/**
 * Retorna el logger asociado a la petición actual (con su respectivo ID de correlación).
 * Si se llama fuera de un ciclo de petición (ej. scripts o tareas de fondo),
 * retorna la instancia raíz (singleton) de logger de forma segura.
 */
export const getCurrentLogger = (): pino.Logger => {
  return loggerStorage.getStore() || logger;
};

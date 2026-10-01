import mongoose from "mongoose";
import { getCurrentLogger } from "./logger.js";

// ─── Singleton: Persiste la conexión entre warm-starts de Vercel ─────────────
let isConnected = false;
let connectionPromise = null; // Caché de la promesa de conexión

/**
 * Conecta a MongoDB usando Singleton Pattern.
 * Reutiliza la conexión existente en entornos Serverless (Vercel).
 */
export const connectDB = async () => {
  // 1. Reutilizar conexión cacheada → 0ms de latencia extra
  if (isConnected) {
    return;
  }

  // 1.5. Prevención de concurrencia: si hay 40 peticiones al mismo tiempo,
  // esperar a que finalice el primer intento de conexión.
  if (connectionPromise) {
    await connectionPromise;
    return;
  }

  // 2. Guardia: falla rápido y claro si falta la variable de entorno
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI no está definida en las variables de entorno");
  }

  const isProduction = process.env.NODE_ENV === "production";

  try {
    connectionPromise = mongoose.connect(process.env.MONGO_URI, {
      // Fix #1 — autoIndex desactivado en producción para evitar bloqueos
      // en colecciones grandes. En desarrollo sigue activo por comodidad.
      autoIndex: !isProduction,

      // Fix #2 — Pool limitado a 10 por función.
      // Protege el cluster Atlas Free (50 conexiones máx.) ante picos de tráfico.
      maxPoolSize: 10,

      // No permitir que Mongo bloquee la función durante 30s
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    // Fix #3 — Booleano explícito, nunca depender del valor numérico de readyState
    const conn = await connectionPromise;
    isConnected = true;
    getCurrentLogger().info(`MongoDB conectado`);

    // Fix #4 — Listeners que resetean el flag si la conexión cae
    // Así la próxima llamada a connectDB intentará reconectar correctamente
    mongoose.connection.on("disconnected", () => {
      getCurrentLogger().warn("MongoDB desconectado. Se reconectará en la próxima petición.");
      isConnected = false;
      connectionPromise = null;
    });

    mongoose.connection.on("error", (err) => {
      getCurrentLogger().error({ err }, "Error en la conexión de MongoDB");
      isConnected = false;
      connectionPromise = null;
    });

  } catch (error) {
    getCurrentLogger().error({ err: error }, "Error al conectar con MongoDB");
    connectionPromise = null;

    // En Serverless no matamos el proceso: dejamos que la función muera sola
    // y que Vercel la reinicie. En local sí salimos para detectar el fallo.
    if (!isProduction && !process.env.VERCEL) {
      process.exit(1);
    }

    // Propagamos el error al middleware de server.js para responder al cliente
    throw error;
  }
};
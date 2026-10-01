import mongoose from "mongoose";
import { getCurrentLogger } from "./logger.js";

let isConnected = false;
let connectionPromise = null;

export const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  if (connectionPromise) {
    await connectionPromise;
    return;
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI no está definida en las variables de entorno");
  }

  const isProduction = process.env.NODE_ENV === "production";

  try {
    connectionPromise = mongoose.connect(process.env.MONGO_URI, {
      autoIndex: !isProduction,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    await connectionPromise;

    isConnected = true;

    getCurrentLogger().info("MongoDB conectado");

    mongoose.connection.on("disconnected", () => {
      isConnected = false;
      connectionPromise = null;
      getCurrentLogger().warn("MongoDB desconectado");
    });

    mongoose.connection.on("error", (err) => {
      isConnected = false;
      connectionPromise = null;
      getCurrentLogger().error(
        { err },
        "Error en la conexión de MongoDB"
      );
    });

  } catch (error) {
    isConnected = false;
    connectionPromise = null;

    getCurrentLogger().error(
      { err: error },
      "Error al conectar con MongoDB"
    );

    if (!isProduction && !process.env.VERCEL) {
      process.exit(1);
    }

    throw error;
  }
};
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Sale } from '../models/Sale.js';

dotenv.config();

async function migrateSaleBusinessOwner() {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error('MONGO_URI not found in .env');
    }

    await mongoose.connect(mongoUri);

    console.log('Conectado a MongoDB para la migración de ventas.');

    const result = await Sale.updateMany(
      {
        customer_id: { $exists: true, $ne: null },
        business_owner_id: { $exists: false },
      },
      [
        {
          $set: {
            business_owner_id: '$customer_id',
          },
        },
      ],
      {
        updatePipeline: true,
      }
    );

    console.log(`Ventas modificadas: ${result.modifiedCount}`);
  } catch (error) {
    console.error('Error durante la migración:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Desconectado de MongoDB.');
  }
}

migrateSaleBusinessOwner();
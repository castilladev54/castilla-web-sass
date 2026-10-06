import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function checkMongoVersion() {
    try {
        const mongoUri = process.env.MONGO_URI;

        if (!mongoUri) {
            throw new Error('MONGO_URI not found in .env');
        }

        await mongoose.connect(mongoUri);

        if (!mongoose.connection.db) {
            throw new Error('Database connection object is undefined.');
        }

        const result = await mongoose.connection.db.admin().serverInfo();

        console.log(`MongoDB version: ${result.version}`);
    } catch (error) {
        console.error('Error obteniendo versión de MongoDB:', error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

checkMongoVersion();
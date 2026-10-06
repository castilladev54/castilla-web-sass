/*import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function auditSaleMigration() {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error('MONGO_URI not found in .env');
    }

    await mongoose.connect(mongoUri);

    const db = mongoose.connection.db;
    const sales = db.collection('sales');

    const total = await sales.countDocuments({});

    const withBusinessOwner = await sales.countDocuments({
      business_owner_id: { $exists: true, $ne: null },
    });

    const mismatches = await sales.countDocuments({
      $expr: {
        $ne: ['$business_owner_id', '$customer_id'],
      },
    });

    const missingBusinessOwner = await sales.countDocuments({
      $or: [
        { business_owner_id: { $exists: false } },
        { business_owner_id: null },
      ],
    });

    console.log({
      total,
      withBusinessOwner,
      mismatches,
      missingBusinessOwner,
    });
  } catch (error) {
    console.error('Error durante la auditoría:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

auditSaleMigration();*/
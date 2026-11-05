import 'dotenv/config';
import mongoose from 'mongoose';
import { bumpCacheVersion } from '../lib/redis.js';

async function runMigration() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI no está definida en el archivo .env');
    process.exit(1);
  }

  try {
    console.log('🔄 Conectando a MongoDB para ejecutar migración controlada...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conexión establecida.\n');

    const salesCollection = mongoose.connection.collection('sales');

    // 1. Conteo inicial previo
    const initialUnclassified = await salesCollection.countDocuments({
      is_credit_sale: { $exists: false },
    });

    console.log(`📊 Conteo inicial sin clasificar: ${initialUnclassified}`);

    if (initialUnclassified === 0) {
      console.log('✨ No existen documentos pendientes de migración. Todo está al día.');
      return;
    }

    // Identificar tenants involucrados para invalidar su caché de Redis al finalizar
    const tenants = await salesCollection.distinct('business_owner_id', {
      is_credit_sale: { $exists: false },
    });

    // 2. Paso A: Clasificar ventas a crédito pendientes (status: pending con cliente)
    const creditFilter = {
      is_credit_sale: { $exists: false },
      status: 'pending',
      customer_id: { $ne: null },
    };

    const creditUpdateResult = await salesCollection.updateMany(creditFilter, {
      $set: { is_credit_sale: true },
    });

    console.log(`\n💳 Ventas a crédito marcadas (is_credit_sale: true):`);
    console.log(`   - Coincidentes: ${creditUpdateResult.matchedCount}`);
    console.log(`   - Modificadas:  ${creditUpdateResult.modifiedCount}`);

    // 3. Paso B: Clasificar ventas de contado históricas (completed y cancelled)
    const cashFilter = {
      is_credit_sale: { $exists: false },
      status: { $in: ['completed', 'cancelled'] },
    };

    const cashUpdateResult = await salesCollection.updateMany(cashFilter, {
      $set: { is_credit_sale: false },
    });

    console.log(`\n💵 Ventas de contado marcadas (is_credit_sale: false):`);
    console.log(`   - Coincidentes: ${cashUpdateResult.matchedCount}`);
    console.log(`   - Modificadas:  ${cashUpdateResult.modifiedCount}`);

    // 4. Verificación post-migración
    const remainingUnclassified = await salesCollection.countDocuments({
      is_credit_sale: { $exists: false },
    });

    console.log(`\n====================================================`);
    console.log(`🔍 Verificación final: ${remainingUnclassified} ventas sin clasificar`);
    console.log(`====================================================`);

    if (remainingUnclassified === 0) {
      console.log('🎉 Migración completada con 100% de éxito.');
    } else {
      console.warn(`⚠️ Atención: Quedaron ${remainingUnclassified} ventas con estados no contemplados.`);
    }

    // 5. Invalidar caché de Redis para los tenants afectados
    if (tenants.length > 0) {
      console.log(`\n🧹 Invalidando versión de caché de ventas en Redis para ${tenants.length} negocio(s)...`);
      for (const tenantId of tenants) {
        if (tenantId) {
          await bumpCacheVersion('sales', String(tenantId));
        }
      }
      console.log('✅ Caché invalidada correctamente.');
    }

  } catch (error) {
    console.error('❌ Error durante la ejecución de la migración:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Conexión cerrada.');
  }
}

runMigration();


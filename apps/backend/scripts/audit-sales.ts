import 'dotenv/config';
import mongoose from 'mongoose';

async function runAudit() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI no está definida en el archivo .env');
    process.exit(1);
  }

  try {
    console.log('🔄 Conectando a MongoDB para auditar ventas históricas...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB con éxito.\n');

    const salesCollection = mongoose.connection.collection('sales');
    const paymentsCollection = mongoose.connection.collection('customerpayments');

    // 1. Conteo total de ventas sin el campo is_credit_sale
    const unclassifiedCount = await salesCollection.countDocuments({
      is_credit_sale: { $exists: false },
    });

    console.log('====================================================');
    console.log(`📊 TOTAL DE VENTAS SIN is_credit_sale: ${unclassifiedCount}`);
    console.log('====================================================\n');

    // 2. Agrupación por status y payment_method
    const breakdown = await salesCollection
      .aggregate([
        {
          $match: {
            is_credit_sale: { $exists: false },
          },
        },
        {
          $group: {
            _id: {
              status: '$status',
              payment_method: '$payment_method',
            },
            total: { $sum: 1 },
            withCustomer: {
              $sum: {
                $cond: [{ $ifNull: ['$customer_id', false] }, 1, 0],
              },
            },
            withoutCustomer: {
              $sum: {
                $cond: [{ $ifNull: ['$customer_id', false] }, 0, 1],
              },
            },
          },
        },
        { $sort: { total: -1 } },
      ])
      .toArray();

    console.log('📋 DISTRIBUCIÓN POR STATUS Y MÉTODO DE PAGO:');
    console.table(
      breakdown.map((row) => ({
        Status: row._id.status,
        'Método de Pago': row._id.payment_method,
        Total: row.total,
        'Con Cliente': row.withCustomer,
        'Sin Cliente': row.withoutCustomer,
      }))
    );

    // 3. Auditoría específica de ventas pending
    const pendingSales = await salesCollection
      .find({
        is_credit_sale: { $exists: false },
        status: 'pending',
      })
      .project({ _id: 1, customer_id: 1, total_amount: 1, createdAt: 1 })
      .toArray();

    console.log(`\n🔍 VENTAS PENDIENTES SIN CLASIFICAR: ${pendingSales.length}`);

    if (pendingSales.length > 0) {
      const pendingIds = pendingSales.map((s) => s._id);
      const associatedPayments = await paymentsCollection
        .find({ sale_id: { $in: pendingIds } })
        .toArray();

      console.log(`- De las ${pendingSales.length} ventas pendientes, ${pendingSales.filter((s) => s.customer_id).length} tienen cliente asignado.`);
      console.log(`- Ventas pendientes que ya tienen abonos registrados en customerpayments: ${new Set(associatedPayments.map((p) => String(p.sale_id))).size}`);
    }

    // 4. Ventas completed con abonos registrados históricamente
    const completedWithPayments = await paymentsCollection.distinct('sale_id');
    const completedCreditCount = await salesCollection.countDocuments({
      is_credit_sale: { $exists: false },
      status: 'completed',
      _id: { $in: completedWithPayments },
    });

    console.log(`\n💳 VENTAS COMPLETADAS QUE POSEEN ABONOS PREVIOS (Créditos ya saldados): ${completedCreditCount}`);

    console.log('\n====================================================');
    console.log('✅ Auditoría finalizada sin realizar ninguna modificación.');
    console.log('====================================================\n');
  } catch (error) {
    console.error('❌ Error durante la auditoría:', error);
  } finally {
    await mongoose.disconnect();
  }
}

runAudit();


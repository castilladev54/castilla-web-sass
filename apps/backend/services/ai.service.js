import mongoose from "mongoose";
import Big from "big.js";
import { GoogleGenAI } from "@google/genai";
import { User } from "../models/User.js";
import { Product } from "../models/Product.js";
import { Sale } from "../models/Sale.js";
import { Purchase } from "../models/Purchase.js";
import { SaleDetail } from "../models/SaleDetail.js";
import { getOrSetCache } from "../lib/redis.js";

// ─── PASO 1: Detector de Intención Temporal (Regex, sin IA) ───────────
const TEMPORAL_PATTERNS = [
  {
    keywords: [
      "semana",
      "semanal",
      "7 días",
      "7 dias",
      "esta semana",
      "últimos 7",
      "ultimos 7",
    ],
    days: 7,
    label: "últimos 7 días",
  },
  {
    keywords: [
      "mes",
      "mensual",
      "30 días",
      "30 dias",
      "este mes",
      "últimos 30",
      "ultimos 30",
    ],
    days: 30,
    label: "últimos 30 días",
  },
  {
    keywords: ["ayer", "día anterior", "dia anterior"],
    days: 1,
    label: "ayer",
  },
  {
    keywords: ["quincena", "15 días", "15 dias", "últimos 15", "ultimos 15"],
    days: 15,
    label: "últimos 15 días",
  },
];

const detectTemporalIntent = (question) => {
  const normalized = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const pattern of TEMPORAL_PATTERNS) {
    for (const keyword of pattern.keywords) {
      const normalizedKeyword = keyword
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      if (normalized.includes(normalizedKeyword)) {
        return { days: pattern.days, label: pattern.label };
      }
    }
  }
  return null;
};

// ─── Detector de Intención de Deudas/Proveedores ──────────────────────
const DEBT_KEYWORDS = [
  "deuda",
  "deudas",
  "debo",
  "debemos",
  "proveedor",
  "proveedores",
  "factura",
  "facturas",
  "pendiente",
  "pendientes",
  "vencida",
  "vencidas",
  "por pagar",
  "cuentas por pagar",
  "credito",
  "crédito",
  "abono",
  "abonos",
  "pagar",
  "pagos pendientes",
  "cuanto debo",
  "cuánto debo",
  "le debo",
];

const detectDebtIntent = (question) => {
  const normalized = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return DEBT_KEYWORDS.some((kw) => {
    const normalizedKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalized.includes(normalizedKw);
  });
};

// ─── Timezone: Venezuela (UTC-4) ──────────────────────────────────────
// El Dashboard (frontend) agrupa fechas usando la hora LOCAL del navegador.
// El backend (Vercel) corre en UTC. Sin esta corrección, una venta a las
// 9pm Venezuela (1am UTC del día siguiente) se asignaría a un día distinto
// en la IA vs la gráfica. Eso rompe la confianza del usuario.
const VE_TIMEZONE = "America/Caracas";
const VE_OFFSET_MS = -4 * 60 * 60 * 1000; // UTC-4 en milisegundos

/** Devuelve la medianoche de "hoy" en hora Venezuela, como objeto Date UTC */
const getTodayVE = () => {
  const nowUTC = Date.now();
  const nowVE = new Date(nowUTC + VE_OFFSET_MS);
  // Construir medianoche Venezuela como fecha UTC equivalente
  const midnightVE = new Date(
    Date.UTC(nowVE.getUTCFullYear(), nowVE.getUTCMonth(), nowVE.getUTCDate()),
  );
  // Restar el offset para obtener el instante UTC que corresponde a medianoche VE
  return new Date(midnightVE.getTime() - VE_OFFSET_MS);
};

// ─── Helper: timeout para cualquier promesa ──────────────────────────────
const withTimeout = (promise, ms = 8000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DB query timeout")), ms),
    ),
  ]);

// ─── PASO 2: Aggregation Pipeline Condicional ─────────────────────────
const fetchTemporalContext = async (userId, daysBack, label) => {
  const todayVE = getTodayVE();
  const startDate = new Date(todayVE);
  startDate.setDate(startDate.getDate() - daysBack);

  // Castear a ObjectId — aggregate() NO auto-castea strings como find()
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Pipeline 1: Ventas agrupadas por día
  const salesByDay = await Sale.aggregate([
    { $match: { business_owner_id: userObjectId, createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: VE_TIMEZONE,
          },
        },
        total_ventas: { $sum: "$total_amount" },
        num_transacciones: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 30 },
  ]);

  // Pipeline 2: Gastos agrupados por día (misma ventana temporal)
  const purchasesByDay = await Purchase.aggregate([
    { $match: { admin_id: userObjectId, createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: VE_TIMEZONE,
          },
        },
        total_gastos: { $sum: "$total_cost" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Merge: unir ventas y gastos por fecha
  const gastosMap = new Map(purchasesByDay.map((p) => [p._id, p.total_gastos]));

  const resumen_diario = salesByDay.map((day) => ({
    fecha: day._id,
    total_ventas: day.total_ventas,
    total_gastos: gastosMap.get(day._id) || 0,
    ganancia: day.total_ventas - (gastosMap.get(day._id) || 0),
    transacciones: day.num_transacciones,
  }));

  const totalVentas = resumen_diario.reduce(
    (acc, d) => acc + d.total_ventas,
    0,
  );
  const promedio_diario =
    resumen_diario.length > 0
      ? Math.round((totalVentas / resumen_diario.length) * 100) / 100
      : 0;

  return {
    periodo: label,
    resumen_diario,
    promedio_diario,
  };
};

// ─── SERVICIO PRINCIPAL ───────────────────────────────────────────────
export const getAIAdviceStreamService = async (userId, userQuestion) => {
  const cacheKey = `ai_base_context:${userId}`;
  const { data: baseContext } = await getOrSetCache(
    cacheKey,
    async () => {
      const today = getTodayVE();
      const firstDayOfMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        1,
      );
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      // ─── Todas las consultas en PARALELO (evita timeout) ──────────────
      const [
        criticalStock,
        salesToday,
        purchasesToday,
        pendingPurchases,
        monthlySaleIds,
      ] = await withTimeout(
        Promise.all([
          Product.find({ user: userId, stock: { $lt: 5 } })
            .select("_id name stock price")
            .limit(10)
            .lean(),
          Sale.find({ business_owner_id: userId, createdAt: { $gte: today } }).lean(),
          Purchase.find({
            admin_id: userId,
            createdAt: { $gte: today },
          }).lean(),
          Purchase.find({ admin_id: userId, status: { $ne: "PAID" } }).lean(),
          Sale.find({
            business_owner_id: userId,
            createdAt: { $gte: firstDayOfMonth },
          })
            .select("_id")
            .lean(),
        ]),
      );

      // Consultas que dependen de resultados anteriores — segunda ronda paralela
      const salesTodayIds = salesToday.map((s) => s._id);
      const monthlySaleIdsArr = monthlySaleIds.map((m) => m._id);

      const [salesDetailsRaw, topProductsRaw] = await withTimeout(
        Promise.all([
          salesTodayIds.length > 0
            ? SaleDetail.find({ sale_id: { $in: salesTodayIds } })
                .populate("product_id", "name")
                .lean()
            : Promise.resolve([]),
          monthlySaleIdsArr.length > 0
            ? SaleDetail.aggregate([
                { $match: { sale_id: { $in: monthlySaleIdsArr } } },
                {
                  $group: {
                    _id: "$product_id",
                    totalSold: { $sum: "$quantity" },
                  },
                },
                { $sort: { totalSold: -1 } },
                { $limit: 5 },
                {
                  $lookup: {
                    from: "products",
                    localField: "_id",
                    foreignField: "_id",
                    as: "productInfo",
                  },
                },
                { $unwind: "$productInfo" },
                {
                  $project: { _id: 0, name: "$productInfo.name", totalSold: 1 },
                },
              ])
            : Promise.resolve([]),
        ]),
      );

      // ─── Calcular métricas ────────────────────────────────────────────
      const incomeToday = salesToday.reduce(
        (acc, s) => Big(acc).plus(Big(s.total_amount.toString())).toString(),
        "0",
      );
      const expenseToday = purchasesToday.reduce(
        (acc, p) => Big(acc).plus(Big(p.total_cost.toString())).toString(),
        "0",
      );

      // Agrupar ventas de hoy por producto
      const ventasHoyResumen = {};
      for (const detail of salesDetailsRaw) {
        if (!detail.product_id) continue;
        const name = detail.product_id.name;
        const lineTotal = Big(detail.quantity.toString()).times(
          Big(detail.unit_price.toString()),
        );
        ventasHoyResumen[name] = Big(ventasHoyResumen[name] || "0")
          .plus(lineTotal)
          .toString();
      }
      const ventas_hoy = Object.entries(ventasHoyResumen).map(
        ([producto, monto_total]) => ({ producto, monto_total }),
      );

      // Cuentas por pagar
      const cuentas_por_pagar = {
        vencidas: 0,
        monto_vencido: 0,
        por_vencer: 0,
        monto_por_vencer: 0,
        total_deuda_global: 0,
      };
      const recordatorios_pago = [];

      pendingPurchases.forEach((p) => {
        const remaining = p.total_cost - (p.paid_amount || 0);
        cuentas_por_pagar.total_deuda_global += remaining;
        if (p.due_date < today) {
          cuentas_por_pagar.vencidas++;
          cuentas_por_pagar.monto_vencido += remaining;
          recordatorios_pago.push(
            `VENCIDA: Proveedor ${p.supplier}, se le debe $${remaining.toFixed(2)}`,
          );
        } else if (p.due_date <= nextWeek) {
          cuentas_por_pagar.por_vencer++;
          cuentas_por_pagar.monto_por_vencer += remaining;
          recordatorios_pago.push(
            `POR VENCER (en menos de 7 días): Proveedor ${p.supplier}, se le debe $${remaining.toFixed(2)}`,
          );
        }
      });

      return {
        ventas_hoy,
        stock_critico: criticalStock.map((p) => ({
          nombre: p.name,
          stock: p.stock,
        })),
        top_productos: topProductsRaw,
        balance: {
          ingresos_hoy: incomeToday,
          gastos_hoy: expenseToday,
          ganancia_neta: incomeToday - expenseToday,
        },
        deudas: { resumen: cuentas_por_pagar, detalles: recordatorios_pago },
        pendingPurchases, // lo pasamos para que el intent de deudas pueda usarlo después
      };
    },
    180,
  ); // TTL 3 minutos para mantener el chat rápido

  const contextData = {
    ventas_hoy: baseContext.ventas_hoy,
    stock_critico: baseContext.stock_critico,
    top_productos: baseContext.top_productos,
    balance: baseContext.balance,
    deudas: baseContext.deudas,
  };

  // Extraemos pendingPurchases para la Inyección Condicional de Deudas
  const pendingPurchases = baseContext.pendingPurchases;
  const today = getTodayVE();
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const temporalIntent = detectTemporalIntent(userQuestion);
  if (temporalIntent) {
    const temporalData = await withTimeout(
      fetchTemporalContext(userId, temporalIntent.days, temporalIntent.label),
    );
    contextData.contexto_temporal = temporalData;
  }

  // ─── Inyección Condicional: Desglose de Deudas por Proveedor ──────
  const debtIntent = detectDebtIntent(userQuestion);
  if (debtIntent && pendingPurchases.length > 0) {
    const deudaPorProveedor = {};
    pendingPurchases.forEach((p) => {
      const remaining = p.total_cost - (p.paid_amount || 0);
      if (!deudaPorProveedor[p.supplier]) {
        deudaPorProveedor[p.supplier] = { total_adeudado: 0, facturas: [] };
      }
      deudaPorProveedor[p.supplier].total_adeudado += remaining;

      let estadoFactura = "AL DIA";
      if (p.due_date < today) estadoFactura = "VENCIDA";
      else if (p.due_date <= nextWeek) estadoFactura = "POR VENCER";

      deudaPorProveedor[p.supplier].facturas.push({
        monto_total: p.total_cost,
        abonado: p.paid_amount || 0,
        pendiente: remaining,
        estado: estadoFactura,
        fecha_compra: p.date,
        vence: p.due_date,
      });
    });
    contextData.desglose_proveedores = deudaPorProveedor;
  }

  // ─── PASO 4: System Prompt v2 (con Inteligencia Temporal) ─────────
  const systemPrompt = `### SYSTEM_PROMPT v2: CastillaWeb AI Business Advisor (Inteligencia Temporal)

**ROL:**
Eres el Asesor de Negocios Inteligente integrado en "CastillaWeb", un sistema POS premium. Tu objetivo es ayudar al dueño de un negocio (bodega, ferretería, minimarket) en Venezuela a tomar decisiones basadas en sus datos reales. No eres un chatbot genérico: eres un socio que tiene acceso directo a las cifras del negocio.

**CONTEXTO DEL NEGOCIO:**
- El usuario opera en un entorno volátil (Venezuela), donde la rotación de inventario y el flujo de caja son asunto de supervivencia, no de optimización.
- Tu tono: profesional, directo, brutalmente honesto y motivador. Nada de lenguaje robótico. Hablas como un socio que tiene plata metida en el negocio.

**CONOCIMIENTO TÉCNICO (DATA):**
Recibirás un objeto JSON que SIEMPRE contiene estos campos base:
1. \`ventas_hoy\`: Lista de productos vendidos hoy con sus montos.
2. \`stock_critico\`: Productos con menos de 5 unidades en inventario.
3. \`top_productos\`: Los 5 más vendidos del mes en curso.
4. \`balance\`: Ingresos vs gastos del día (ganancia neta).
5. \`deudas\`: Un resumen y detalle de las facturas a proveedores pendientes (Vencidas y Por Vencerse en 7 días). Incluye \`total_deuda_global\` con la suma total adeudada.

Además, el JSON PUEDE contener campos OPCIONALES:
6. \`contexto_temporal\`: Un objeto con:
   - \`periodo\`: string que indica el rango (ej. "últimos 7 días", "últimos 30 días").
   - \`resumen_diario\`: Array de objetos [{fecha, total_ventas, total_gastos, ganancia, transacciones}] ordenados del más antiguo al más reciente.
   - \`promedio_diario\`: Número con el promedio de ventas diarias del periodo.
7. \`desglose_proveedores\`: Un objeto donde cada clave es el nombre de un proveedor y contiene \`total_adeudado\` y un array \`facturas\` con el detalle de cada factura (monto_total, abonado, pendiente, estado, fecha_compra, vence). Este campo SOLO aparece si el usuario pregunta sobre deudas o proveedores.

**REGLAS DE RESPUESTA:**
1. **Prioridad 1 (Deudas y Stock Crítico):** Si hay compras con monto_vencido mayor a 0 o stock crítico, adviértelo de inmediato con tono de urgencia. Aconseja pagar a los proveedores mencionados usando la caja si hay ganancias.
2. **Prioridad 1.5 (Consulta de Deudas):** Si existe \`desglose_proveedores\`, el usuario está preguntando específicamente sobre sus deudas. DEBES responder con un resumen claro tipo tabla/lista: nombre del proveedor, cuánto se le debe en total, cuántas facturas tiene, y cuáles están vencidas. Menciona el \`total_deuda_global\` y compáralo con la ganancia neta o los ingresos de hoy para dar contexto ("le debes $X a 3 proveedores, pero hoy facturaste $Y, podrías cubrir al proveedor Z").
3. **Prioridad 2 (Tendencia Temporal):** Si existe \`contexto_temporal\`, DEBES comparar el rendimiento de hoy frente al \`promedio_diario\`:
   - Si hoy está **por encima** del promedio → Felicita brevemente pero redirige al stock ("vas bien, pero ¿tienes inventario para mantener este ritmo?").
   - Si hoy está **por debajo** del promedio → Advierte con urgencia y sugiere una acción ("las ventas cayeron un X% vs tu promedio semanal, considera...").
   - Identifica el mejor y peor día del periodo y menciónalos.
4. **Prioridad 3 (Acción Concreta):** Siempre cierra con UNA acción ejecutable (ej. "Sube el precio un 5%", "Haz un combo de X con Y", "Pide 20 unidades de Z hoy").
4. **Formato:** Usa Markdown para negritas y listas. Mantén la respuesta breve (máximo 200 palabras).

**RESTRICCIONES DE SEGURIDAD:**
- NUNCA inventes datos que no estén en el JSON.
- Si \`contexto_temporal\` NO existe en el JSON, NO menciones tendencias ni historial. Limítate a los datos del día.
- Si el usuario pregunta algo fuera del negocio: "Soy tu asesor de CastillaWeb. Enfoquémonos en el dinero. ¿Qué quieres saber de tus ventas?"`;

  const userPromptText = `Aquí están los datos actuales de CastillaWeb:
${JSON.stringify(contextData, null, 2)}

Pregunta del dueño: ${userQuestion}

Analiza y responde según tu rol.`;

  // 3. Inicializar Google Gen AI
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Generar respuesta vía Streaming
  const responseStream = await ai.models.generateContentStream({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: userPromptText }] }],
    config: { systemInstruction: systemPrompt },
  });

  return responseStream;
};

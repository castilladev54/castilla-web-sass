// ─── SLA MIDDLEWARE: FAIL FAST ──────────────────────────────────────────────
// Un backend senior no deja peticiones colgadas 60 segundos.
// Si la respuesta no se completó en el SLA, cortamos de raíz con 504.
// Esto protege el Event Loop de acumular miles de handlers zombi.

const SLA_TIMEOUT_MS = Number(process.env.SLA_TIMEOUT_MS) || 30000; // 30 segundos

// Rutas excluidas del SLA: streaming SSE y operaciones de larga duración por diseño.
// El endpoint de IA puede tardar varios segundos en emitir el primer token de Gemini.
const SLA_SKIP_PATHS = [
  '/api/ai/ask',
];

export const slaTimeout = (req, res, next) => {
  // Saltar el SLA para rutas de streaming/larga duración
  if (SLA_SKIP_PATHS.some(path => req.path === path)) {
    return next();
  }

  const timer = setTimeout(() => {
    // Si ya enviamos headers, no podemos enviar otro response
    if (res.headersSent) return;

    const error = new Error("Gateway Timeout — la operación excedió el SLA de respuesta.");
    error.status = 504;
    next(error);
  }, SLA_TIMEOUT_MS);

  // Limpiar el timer cuando la respuesta se complete normalmente
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));

  next();
};

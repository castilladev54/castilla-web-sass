import axios, { InternalAxiosRequestConfig, AxiosError, GenericAbortSignal } from 'axios';
import { useAuthStore } from '../store/authStore';

// DTO for refresh token response
interface RefreshTokenResponse {
  success: boolean;
  token: string;
}

interface ApiErrorResponse {
  code?: string;
  message?: string;
}

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

// Variables de control fuera del interceptor (Singleton)
let isRefreshing = false;

// Tipado Estricto: resolve devuelve string (token), reject devuelve AxiosError
let failedQueue: Array<{
  resolve: (value: string) => void;
  reject: (reason: AxiosError) => void;
  signal?: GenericAbortSignal;
}> = [];

const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

type UnauthorizedCallback = () => void;
let onUnauthorizedCb: UnauthorizedCallback | null = null;

export const setOnUnauthorizedCallback = (cb: UnauthorizedCallback) => {
  onUnauthorizedCb = cb;
};

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // 🚨 CRUCIAL: Permite el envío automático de cookies HttpOnly
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Interceptor de Peticiones: Inyección del Contexto de Sucursal
 */
api.interceptors.request.use(
  (config) => {
    console.log('[HTTP] request', { url: config.url, authorization: config.headers?.Authorization });
    const authState = useAuthStore.getState();
    const { activeBranchId, token } = authState;

    // Inyectar el token Bearer si existe
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    // 1. Resolver el contexto de sucursal
    const isGlobalRequest =
      config.headers['x-global-request'] === 'true' ||
      Boolean(config.headers['x-global-request']);

    if (isGlobalRequest) {
      // Una petición global no puede llevar contexto de sucursal.
      config.headers.delete('x-branch-id');
    } else if (activeBranchId && !config.headers['x-branch-id']) {
      // Respetar siempre un x-branch-id explícitamente proporcionado.
      config.headers.set('x-branch-id', activeBranchId);
    }

    // El interceptor continúa hasta el final.
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Interceptor de Respuestas: Manejo global de expiración y concurrencia
 */
api.interceptors.response.use(
  (response) => {
  console.log('[HTTP] response', { url: response.config?.url, status: response.status });
  return response;
},
  async (error: AxiosError) => {
    console.log('[HTTP] error', { url: error.config?.url, status: error.response?.status });
  const originalRequest = error.config;
    if (!originalRequest) return Promise.reject(error);

    // Silenciar errores de cancelación de TanStack Query (no es un fallo de red real)
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }

    const status = error.response?.status;

    // 1. Sesión expirada (401) - Patrón Singleton para Refresh
    if (status === 401 && originalRequest.url !== '/auth/refresh' && !originalRequest._retry) {
      if (isRefreshing) {
        try {
          const signal = originalRequest.signal;
          const newToken = await new Promise<string>((resolve, reject) => {
            const entry = { resolve, reject, signal };

            // 🚨 PROTECCIÓN DE ENVENENAMIENTO DE CACHÉ Y RACE CONDITIONS
            if (signal?.aborted) {
              reject(new axios.CanceledError('Request aborted before refresh completed'));
              return;
            }

            signal?.addEventListener?.('abort', () => {
              reject(new axios.CanceledError('Request aborted during token refresh'));
              // 🔥 Previene la fuga de memoria retirando la promesa muerta de la cola
              failedQueue = failedQueue.filter(item => item !== entry);
            }, { once: true });

            failedQueue.push(entry);
          });
          originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
          return api(originalRequest);
        } catch (err) {
          return Promise.reject(err);
        }
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        console.log('[AUTH] refresh started');
        const res = await api.post<RefreshTokenResponse>('/auth/refresh');
        console.log('[AUTH] refresh response', res.data);
        const newToken = res.data.token;

        useAuthStore.getState().actions.updateToken(newToken);
        console.log('[AUTH] token updated');
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;

        processQueue(null, newToken);
        console.log('[AUTH] queue processed');
        console.log('[AUTH] retrying original request', {
          url: originalRequest.url,
          method: originalRequest.method,
          retry: originalRequest._retry,
          authorization: originalRequest.headers?.Authorization,
        });
        return api(originalRequest);
      } catch (err) {
        const axiosError = err as AxiosError;
        processQueue(axiosError, null);

        // Purgamos la sesión
        useAuthStore.getState().actions.clearAuth();

        // Propagar el rechazo para que TanStack Query lo capture
        return Promise.reject(axiosError);
      } finally {
        isRefreshing = false;
      }
    }

    // 403 general o un 401 que falló en el refresh (ej. la ruta original ERA /refresh)
    // Regla de Oro: clearAuth() ignora los 403, permitiendo que lleguen a los componentes o caches
    if (status === 401 && originalRequest.url !== '/auth/refresh') {
      useAuthStore.getState().actions.clearAuth();
    }

    // ─── CIRCUITO DE RESPUESTA: 403 Jurisdicción de Sucursal ────────────
    // Cuando el backend detecta manipulación de x-branch-id o revocación
    // de acceso en caliente, el interceptor aborta peticiones en vuelo,
    // purga el estado corrupto y expulsa al usuario de inmediato.
    if (status === 403) {
      const errorCode = (error.response?.data as any)?.code;
      const errorMessage = (error.response?.data as any)?.message || '';

      if (errorCode === 'ERR_BRANCH_JURISDICTION') {
        // 1. Purgar el activeBranchId corrupto de forma tipada y segura (null)
        useAuthStore.getState().actions.setActiveBranch(null);

        // 2. Disparar callback de expulsión (main.tsx se encargará de cancelar queries y purgar)
        onUnauthorizedCb?.();
      }

      if (errorMessage.toLowerCase().includes('session invalidated')) {
        useAuthStore.getState().actions.clearAuth();
        onUnauthorizedCb?.();
      }

      // Lock de Suscripción Expirada (Bloqueo global del backend)
      if (errorMessage.toLowerCase().includes('suscripción')) {
        useAuthStore.getState().actions.setSubscriptionExpired(true);
      }
    }

    return Promise.reject(error);
  }
);


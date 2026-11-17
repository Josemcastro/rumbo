// Capa de datos de «Rumbo».
// Toda lectura y escritura pasa por funciones RPC de Supabase (prefijo `rumbo_`).
// El secreto del espacio solo viaja como parámetro en el cuerpo de la petición POST;
// nunca se pone en la URL de la petición, nunca se guarda y nunca se escribe en la consola.

export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js';

export const CONFLICT_MESSAGE =
  'Este dato cambió en otro dispositivo. Hemos cargado la versión actual; revisa y vuelve a guardar.';

export const MESSAGES = {
  network: 'No hay conexión con la base de datos. Comprueba la red e inténtalo de nuevo.',
  server: 'La base de datos no responde ahora mismo. Inténtalo de nuevo en un momento. Si el proyecto de Supabase estaba en pausa, reactívalo desde supabase.com.',
  unauthorized: 'Este enlace no es válido o ha sido regenerado.',
  not_installed: 'La base de datos aún no está preparada: falta ejecutar el archivo supabase/schema.sql en el SQL Editor de Supabase.',
  bad_config: 'La conexión con Supabase no es correcta. Revisa la dirección del proyecto y la clave pública en config.js.',
  op_reused: 'No se ha podido guardar porque este envío ya se había usado para otra acción. Vuelve a intentarlo.',
  unknown: 'Algo no ha ido bien. Inténtalo de nuevo.',
};

/** Error de la capa de datos con la forma del contrato: {code, message, fields?, details?, current?}. */
export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message || MESSAGES[code] || MESSAGES.unknown);
    this.name = 'ApiError';
    this.code = code;
    this.fields = extra.fields || null;
    this.details = extra.details || null;
    this.current = extra.current || null;
  }

  /** ¿Es seguro y útil reintentar el mismo envío (mismo op_id)? */
  get retryable() {
    return this.code === 'network' || this.code === 'server';
  }
}

/**
 * Convierte el error que devuelven PostgREST o PGlite en ApiError.
 * Los errores de negocio llegan con código P0001 y un JSON en `message`.
 * @param {{code?:string, message?:string}} error
 * @param {number} [status] código HTTP, si se conoce (0 = sin respuesta)
 */
export function toApiError(error, status) {
  if (error instanceof ApiError) return error;
  const code = error && error.code ? String(error.code) : '';
  const message = error && error.message ? String(error.message) : '';

  if (code === 'P0001') {
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed === 'object' && parsed.code) {
        return new ApiError(String(parsed.code), parsed.message, parsed);
      }
    } catch {
      // No es JSON: se trata como error genérico del servidor más abajo.
    }
    return new ApiError('server', MESSAGES.unknown);
  }
  if (code === 'PGRST202' || code === '42883' || code === '3F000' || code === '42P01') {
    return new ApiError('not_installed', MESSAGES.not_installed);
  }
  if (status === 401 || status === 403 || code === 'PGRST301' || /invalid api key|jwt/i.test(message)) {
    return new ApiError('bad_config', MESSAGES.bad_config);
  }
  if (status === 0 || (!code && /fetch|network|load failed|failed to|connection|offline/i.test(message))) {
    return new ApiError('network', MESSAGES.network);
  }
  return new ApiError('server', MESSAGES.server);
}

// ---------- Identificadores y secreto ----------

export const SECRET_RE = /^[A-Za-z0-9_-]{43,128}$/;

export function isValidSecret(value) {
  return typeof value === 'string' && SECRET_RE.test(value);
}

function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Nuevo secreto: 32 bytes aleatorios → base64url sin relleno (43 caracteres). */
export function generateSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** Identificador de operación para idempotencia (8–64 caracteres). */
export function newOpId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* se usa el respaldo */ }
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Nombre del canal de tiempo real: «rumbo-» + 32 primeros hex de SHA-256("rumbo-channel:" + secreto). */
export async function channelNameFor(secret) {
  const data = new TextEncoder().encode('rumbo-channel:' + secret);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return 'rumbo-' + hex.slice(0, 32);
}

// ---------- Backend Supabase ----------

/**
 * Backend real: supabase-js (UMD, cargado desde index.html).
 * Expone `rpc(name, params)` y `realtime(channelName, {onRev, onStatus})`.
 */
export function createSupabaseBackend(config) {
  const lib = globalThis.supabase;
  if (!lib || typeof lib.createClient !== 'function') {
    throw new ApiError('network', 'No se ha podido cargar la librería de Supabase. Comprueba la conexión y recarga la página.');
  }
  const client = lib.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  async function rpc(name, params) {
    let res;
    try {
      res = await client.rpc(name, params);
    } catch (err) {
      throw toApiError({ message: err && err.message ? err.message : 'network' }, 0);
    }
    if (res.error) throw toApiError(res.error, res.status);
    return res.data;
  }

  function realtime(channelName, { onRev, onStatus }) {
    const channel = client.channel(channelName, { config: { broadcast: { self: false, ack: false } } });
    channel.on('broadcast', { event: 'rev' }, (message) => {
      const rev = Number(message && message.payload && message.payload.rev);
      if (Number.isFinite(rev)) onRev(rev);
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus('joined');
      else if (status === 'CLOSED') onStatus('closed');
      else onStatus('error'); // CHANNEL_ERROR o TIMED_OUT: supabase-js reintenta solo.
    });
    let closed = false;
    return {
      send(rev) {
        if (closed) return;
        Promise.resolve(channel.send({ type: 'broadcast', event: 'rev', payload: { rev } })).catch(() => {});
      },
      close() {
        if (closed) return;
        closed = true;
        Promise.resolve(client.removeChannel(channel)).catch(() => {});
      },
    };
  }

  return { kind: 'supabase', rpc, realtime };
}

// ---------- API de alto nivel (igual para Supabase y para PGlite) ----------

export function createApi(backend) {
  return {
    backend,
    getState(secret) {
      return backend.rpc('rumbo_get_state', { p_secret: secret });
    },
    async getRev(secret) {
      const rev = await backend.rpc('rumbo_get_rev', { p_secret: secret });
      return Number(rev);
    },
    createSpace(secret, { demo = false, setupCode = null } = {}) {
      return backend.rpc('rumbo_create_space', {
        p_secret: secret,
        p_demo: !!demo,
        p_setup_code: setupCode ? String(setupCode) : null,
      });
    },
    /** Devuelve `{result, rev}`. */
    async mutate(secret, opId, action, payload) {
      const res = await backend.rpc('rumbo_mutate', {
        p_secret: secret,
        p_op_id: opId,
        p_action: action,
        p_payload: payload || {},
      });
      return { result: res ? res.result : null, rev: res ? Number(res.rev) : NaN };
    },
    realtime(channelName, handlers) {
      return backend.realtime(channelName, handlers);
    },
  };
}

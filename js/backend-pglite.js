// Backend de PRUEBAS LOCALES (solo lo usa tests/app-local.html; index.html nunca lo carga).
// Ejecuta supabase/schema.sql en PGlite (Postgres compilado a WebAssembly) dentro del
// navegador y ofrece la misma interfaz que el backend de Supabase:
//   rpc(name, params)                 → select public.<name>(p_x => $1, …)
//   realtime(channelName, handlers)   → BroadcastChannel('rumbo-local') entre pestañas
// Los datos quedan en IndexedDB de este navegador (idb://rumbo-local-test).

import { ApiError, toApiError } from './api.js';

const PGLITE_URL = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js';
const DB_URL = 'idb://rumbo-local-test';
const SCHEMA_URL = new URL('../supabase/schema.sql', import.meta.url);
const NAME_RE = /^rumbo_[a-z_]+$/;
const PARAM_RE = /^p_[a-z_]+$/;

export async function createPgliteBackend({ onProgress } = {}) {
  let PGlite;
  try {
    onProgress && onProgress('Cargando PGlite…');
    ({ PGlite } = await import(PGLITE_URL));
  } catch {
    throw new ApiError('network', 'No se ha podido cargar PGlite desde cdn.jsdelivr.net. Comprueba la conexión.');
  }

  let schema;
  try {
    const res = await fetch(SCHEMA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    schema = await res.text();
  } catch {
    throw new ApiError('not_installed', 'No se ha encontrado supabase/schema.sql junto a la web. Sirve la carpeta completa del proyecto con un servidor estático.');
  }

  async function open() {
    const instance = new PGlite(DB_URL);
    await instance.waitReady;
    return instance;
  }

  onProgress && onProgress('Preparando la base de datos local…');
  let db = await open();
  try {
    await db.exec(schema);
  } catch (err) {
    throw new ApiError('not_installed', 'supabase/schema.sql ha fallado al ejecutarse en PGlite: ' + (err && err.message ? err.message : 'error desconocido'));
  }

  // Cada pestaña tiene su copia en memoria de la base de datos. Cuando otra pestaña
  // escribe, se marca como desactualizada y se vuelve a abrir desde IndexedDB.
  let stale = false;
  let reopening = null;
  async function ready() {
    if (stale && !reopening) {
      stale = false;
      // No se llama a close() en la copia antigua: al cerrarse volcaría su contenido
      // (desactualizado) a IndexedDB y pisaría lo que escribió la otra pestaña.
      // Basta con dejar de usarla para que el navegador libere la memoria.
      reopening = (async () => {
        db = await open();
      })().finally(() => { reopening = null; });
    }
    if (reopening) await reopening;
    return db;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') stale = true;
  });

  async function rpc(name, params = {}) {
    if (!NAME_RE.test(name)) throw new ApiError('server', 'Función desconocida.');
    const keys = Object.keys(params);
    const values = [];
    const args = keys.map((key, i) => {
      if (!PARAM_RE.test(key)) throw new ApiError('server', 'Parámetro desconocido.');
      const value = params[key];
      let cast = '::text';
      if (value === null || value === undefined) {
        values.push(null);
      } else if (typeof value === 'boolean') {
        values.push(value);
        cast = '::boolean';
      } else if (typeof value === 'object') {
        values.push(JSON.stringify(value));
        cast = '::jsonb';
      } else {
        values.push(String(value));
      }
      return `${key} => $${i + 1}${cast}`;
    });
    const sql = `select public.${name}(${args.join(', ')}) as r`;
    const conn = await ready();
    let result;
    try {
      result = await conn.query(sql, values);
    } catch (err) {
      throw toApiError({ code: err && err.code, message: err && err.message }, 500);
    }
    if (name !== 'rumbo_get_state' && name !== 'rumbo_get_rev' && typeof conn.syncToFs === 'function') {
      // Asegura que la escritura está en IndexedDB antes de avisar a otras pestañas.
      try { await conn.syncToFs(); } catch { /* se sincronizará en la siguiente consulta */ }
    }
    const value = result.rows[0] ? result.rows[0].r : null;
    return typeof value === 'bigint' ? Number(value) : value;
  }

  const bus = typeof BroadcastChannel === 'function' ? new BroadcastChannel('rumbo-local') : null;
  const subscribers = new Set();
  if (bus) {
    bus.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (typeof msg.channel !== 'string') return;
      stale = true;
      for (const sub of subscribers) {
        if (sub.channel === msg.channel) sub.onRev(Number(msg.rev));
      }
    });
  }

  function realtime(channelName, { onRev, onStatus }) {
    const sub = { channel: channelName, onRev };
    subscribers.add(sub);
    queueMicrotask(() => onStatus(bus ? 'joined' : 'error'));
    return {
      send(rev) { if (bus) bus.postMessage({ channel: channelName, rev }); },
      close() { subscribers.delete(sub); },
    };
  }

  return { kind: 'pglite', rpc, realtime };
}

// Sincronización entre dispositivos sin servidor propio:
// 1) Canal Broadcast de Supabase Realtime (solo transporta el número de revisión).
// 2) Respaldo: sondeo barato con rumbo_get_rev cada 15 s mientras la página está visible,
//    y al instante al volver a la pestaña o recuperar la red.
// Cuando llega una revisión mayor que la local, se pide el estado completo.

import { channelNameFor } from './api.js';

const POLL_MS = 15000;

/**
 * @param {object} o
 * @param {ReturnType<import('./api.js').createApi>} o.api
 * @param {() => number} o.getRev               revisión local actual
 * @param {(rev:number) => void} o.onNewRev     hay una revisión más nueva: recargar
 * @param {() => void} o.onUnauthorized         el enlace dejó de ser válido
 * @param {(status:'live'|'reconnecting'|'offline') => void} o.onStatus
 */
export function createSync({ api, getRev, onNewRev, onUnauthorized, onStatus }) {
  let secret = null;
  let channel = null;
  let channelState = 'joining';
  let networkOk = true;
  let pollTimer = null;
  let polling = false;
  let running = false;
  let generation = 0;
  let lastStatus = null;

  function emitStatus() {
    let status;
    // Las pruebas reales de conexión (la última consulta funcionó o el canal en
    // tiempo real está unido) mandan sobre navigator.onLine, que algunos
    // navegadores informan mal.
    if (!networkOk) status = 'offline';
    else if (channelState === 'joined') status = 'live';
    else if (navigator.onLine === false) status = 'offline';
    else status = 'reconnecting';
    if (status !== lastStatus) {
      lastStatus = status;
      onStatus(status);
    }
  }

  function handleRev(rev) {
    if (Number.isFinite(rev) && rev > getRev()) onNewRev(rev);
  }

  async function join(gen) {
    const name = await channelNameFor(secret);
    if (gen !== generation || !running) return;
    channelState = 'joining';
    emitStatus();
    channel = api.realtime(name, {
      onRev: (rev) => { if (gen === generation) handleRev(rev); },
      onStatus: (state) => {
        if (gen !== generation) return;
        channelState = state;
        emitStatus();
        // Al (re)conectar se comprueba si nos perdimos algo mientras tanto.
        if (state === 'joined') pollNow();
      },
    });
  }

  function leave() {
    if (channel) channel.close();
    channel = null;
  }

  async function pollNow() {
    if (!running || polling) return;
    polling = true;
    const gen = generation;
    try {
      const rev = await api.getRev(secret);
      if (gen !== generation) return;
      networkOk = true;
      handleRev(rev);
    } catch (err) {
      if (gen !== generation) return;
      if (err && err.code === 'unauthorized') {
        stop();
        onUnauthorized();
        return;
      }
      networkOk = !(err && (err.code === 'network' || err.code === 'server'));
    } finally {
      polling = false;
      if (running) emitStatus();
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') pollNow();
  }
  function onOnline() { networkOk = true; emitStatus(); pollNow(); }
  function onOffline() { emitStatus(); }

  function start(newSecret) {
    stop();
    running = true;
    secret = newSecret;
    networkOk = true;
    lastStatus = null;
    const gen = ++generation;
    join(gen);
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') pollNow();
    }, POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  function stop() {
    running = false;
    generation++;
    leave();
    clearInterval(pollTimer);
    pollTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  }

  /** Avisa al resto de dispositivos de que hay una revisión nueva. */
  function announce(rev) {
    if (channel && Number.isFinite(rev)) channel.send(rev);
  }

  /** Tras regenerar el enlace: avisa por el canal antiguo y pasa al nuevo. */
  function switchSecret(newSecret, rev) {
    announce(rev);
    const old = channel;
    channel = null;
    // Se deja un momento para que el aviso salga antes de cerrar el canal antiguo.
    setTimeout(() => { if (old) old.close(); }, 1500);
    secret = newSecret;
    const gen = ++generation;
    join(gen);
  }

  /** Una petición acaba de funcionar (o de fallar por red): actualiza el indicador. */
  function reportNetwork(ok) {
    networkOk = ok;
    if (running) emitStatus();
  }

  return { start, stop, announce, switchSecret, pollNow, reportNetwork };
}

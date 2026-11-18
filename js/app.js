// Punto de entrada de «Rumbo»: configuración, sesión (secreto del fragmento), estado,
// sincronización, ruteo y renderizado de vistas.

import { createApi, createSupabaseBackend, isValidSecret, newOpId, ApiError, CONFLICT_MESSAGE, MESSAGES } from './api.js';
import { createSync } from './sync.js';
import { parseHash, buildHash, sameRoute } from './router.js';
import { h, icon, replaceChildren, initToasts, toast, closeAllSheets } from './ui.js';
import { memberNames } from './labels.js';
import { renderShell, updateShell, setSyncStatus } from './views/shell.js';
import {
  renderSetupMissing, renderHome, renderWelcome, renderInvalid, renderLoading, renderLoadError,
} from './views/start.js';
import { renderSummary } from './views/summary.js';
import { renderSavings } from './views/savings.js';
import { renderTabView } from './views/tab.js';
import { renderGoalView } from './views/goal.js';
import { renderSettings } from './views/settings.js';

const VIEWS = {
  summary: renderSummary,
  savings: renderSavings,
  tab: renderTabView,
  goal: renderGoalView,
  settings: renderSettings,
};

const root = document.getElementById('app');
const config = window.RUMBO_CONFIG || {};
const backendKind = config.backend === 'pglite' || document.documentElement.dataset.backend === 'pglite' ? 'pglite' : 'supabase';

let api = null;
let session = null; // { secret, state, status, sync, shell, refreshing, refreshAgain, route }
let currentRoute = { name: 'home' };
const stateListeners = new Set();
const uiMemory = new Map(); // memoria de la vista (borradores, «mostrar más»…), solo en esta pestaña

// ---------- Preferencias visuales (localStorage, con try/catch) ----------

const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('rumbo.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('rumbo.' + key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
  },
};

// ---------- Espacio recordado en este dispositivo ----------
// Algunos móviles abren el acceso de la pantalla de inicio sin el fragmento de la
// dirección (donde va el enlace privado). Para que aun así se entre directamente en
// vuestro espacio, este dispositivo recuerda el último espacio real abierto. Nunca se
// envía a ningún sitio; se olvida si el enlace deja de valer o desde Ajustes.
// Las demostraciones no se recuerdan.

const rememberKey = () => 'rumbo.space.' + (backendKind === 'pglite' ? 'local' : String(config.supabaseUrl || ''));
const remembered = {
  get() {
    try {
      const v = localStorage.getItem(rememberKey());
      return v && isValidSecret(v) ? v : null;
    } catch {
      return null;
    }
  },
  /** Recuerda el espacio, salvo que en Ajustes se pidiera no hacerlo en este dispositivo. */
  set(secret) {
    try {
      if (localStorage.getItem(rememberKey() + '.off') === '1') return;
      localStorage.setItem(rememberKey(), secret);
    } catch { /* sin almacenamiento */ }
  },
  /** Ajustes → «Recordar en este dispositivo». */
  enable(secret) {
    try {
      localStorage.removeItem(rememberKey() + '.off');
      localStorage.setItem(rememberKey(), secret);
    } catch { /* sin almacenamiento */ }
  },
  /** Ajustes → «Olvidar en este dispositivo». */
  disable() {
    try {
      localStorage.removeItem(rememberKey());
      localStorage.setItem(rememberKey() + '.off', '1');
    } catch { /* sin almacenamiento */ }
  },
  /** Olvida el espacio; si se indica un secreto, solo si es ese. */
  clear(secret = null) {
    try {
      if (!secret || localStorage.getItem(rememberKey()) === secret) localStorage.removeItem(rememberKey());
    } catch { /* sin almacenamiento */ }
  },
};

function isDemoState(state) {
  const v = state && state.space ? state.space.is_demo : false;
  return v === true || v === 1 || v === 't' || v === 'true';
}

// ---------- Objeto «app» que reciben las vistas y formularios ----------

const app = {
  get state() { return session ? session.state : null; },
  get secret() { return session ? session.secret : null; },
  get route() { return currentRoute; },
  get backendKind() { return backendKind; },
  get api() { return api; },
  prefs,
  memory: uiMemory,
  /** ¿Este dispositivo recuerda el espacio abierto? */
  get remembersSpace() { return !!session && remembered.get() === session.secret; },
  forgetDevice() { remembered.disable(); },
  rememberDevice() { if (session) remembered.enable(session.secret); },
  toast,

  names() { return memberNames(app.state && app.state.space); },
  goal(id) { return app.state ? app.state.goals.find((g) => g.id === id) || null : null; },
  tab(id) { return app.state ? app.state.tabs.find((t) => t.id === id) || null : null; },
  tabName(id) { const t = app.tab(id); return t ? t.name : ''; },
  sortedTabs() { return app.state ? [...app.state.tabs].sort((a, b) => a.position - b.position || a.id - b.id) : []; },

  href(route) { return buildHash(app.secret, route); },
  navigate(route, { replace = false } = {}) {
    const hash = buildHash(app.secret, route);
    if (replace) {
      history.replaceState(null, '', hash);
      onHashChange();
    } else if (location.hash === hash) {
      onHashChange();
    } else {
      location.hash = hash;
    }
  },

  /** Ejecuta una acción de escritura. Devuelve `result`; lanza ApiError si falla. */
  async mutate(action, payload, opId) {
    const s = session;
    if (!s || !s.secret) throw new ApiError('unauthorized', MESSAGES.unauthorized);
    const res = await api.mutate(s.secret, opId, action, payload);
    if (s !== session) return res.result;
    s.sync.reportNetwork(true);
    s.sync.announce(res.rev);
    try {
      await app.refresh();
    } catch {
      // El cambio está guardado; el estado se recargará con el siguiente sondeo.
    }
    return res.result;
  },

  /**
   * Acción directa (sin formulario): avisa con un toast y ofrece «Reintentar» con el mismo
   * op_id si el fallo es de red. Devuelve el resultado o null si ha fallado.
   */
  async run(action, payload, { success = 'Guardado', onError = null, opId = newOpId() } = {}) {
    try {
      const result = await app.mutate(action, payload, opId);
      if (success) toast(success);
      return result ?? true;
    } catch (err) {
      if (onError && err && err.name === 'ApiError' && (await onError(err))) return null;
      app.handleError(err, () => app.run(action, payload, { success, onError, opId: err && err.retryable ? opId : newOpId() }));
      return null;
    }
  },

  /** Muestra un error de una acción directa. */
  handleError(err, retry) {
    if (!err || err.name !== 'ApiError') {
      toast('Algo no ha ido bien. Inténtalo de nuevo.', { type: 'error', action: retry ? { label: 'Reintentar', onClick: retry } : null });
      return;
    }
    if (err.code === 'unauthorized') { app.invalidate(); return; }
    if (err.code === 'conflict') {
      toast(CONFLICT_MESSAGE, { type: 'error' });
      app.refresh().catch(() => {});
      return;
    }
    if (err.retryable) {
      app.reportNetwork(err.code !== 'network');
      toast(err.message, { type: 'error', action: retry ? { label: 'Reintentar', onClick: retry } : null });
      return;
    }
    toast(err.message, { type: 'error' });
    if (err.code === 'not_found') app.refresh().catch(() => {});
  },

  /** Recarga el estado completo (las llamadas simultáneas se agrupan). */
  refresh() {
    const s = session;
    if (!s) return Promise.resolve();
    if (s.refreshing) { s.refreshAgain = true; return s.refreshing; }
    s.refreshing = (async () => {
      try {
        do {
          s.refreshAgain = false;
          let state;
          try {
            state = await api.getState(s.secret);
          } catch (err) {
            if (s !== session) return;
            if (err && err.code === 'unauthorized') { app.invalidate(); return; }
            if (err && err.retryable) s.sync.reportNetwork(false);
            throw err;
          }
          if (s !== session) return;
          s.sync.reportNetwork(true);
          applyState(s, state);
        } while (s.refreshAgain);
      } finally {
        s.refreshing = null;
      }
    })();
    return s.refreshing;
  },

  onState(fn) {
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
  },

  reportNetwork(ok) { if (session) session.sync.reportNetwork(ok); },

  /** El enlace ya no es válido: se cierra todo y no se muestra ningún dato. */
  invalidate() {
    closeAllSheets();
    if (session) remembered.clear(session.secret);
    if (session) {
      session.sync.stop();
      session.state = null;
      session.status = 'invalid';
    }
    stateListeners.clear();
    document.title = 'Rumbo';
    replaceChildren(root, renderInvalid(app));
  },

  /**
   * Regenera el enlace: el secreto nuevo se genera aquí; el anterior deja de funcionar.
   * Lanza ApiError si falla.
   */
  async regenerate(newSecret, opId) {
    const s = session;
    const oldSecret = s.secret;
    let res;
    try {
      res = await api.mutate(oldSecret, opId, 'regenerate_link', { new_secret: newSecret });
    } catch (err) {
      // Si se perdió la respuesta pero el cambio se aplicó, el secreto nuevo ya funciona.
      if (err && err.retryable) {
        try {
          await api.getRev(newSecret);
          res = { rev: NaN };
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }
    if (s !== session) return;
    if (remembered.get() === oldSecret) remembered.set(newSecret);
    s.secret = newSecret;
    history.replaceState(null, '', buildHash(newSecret, currentRoute));
    s.sync.switchSecret(newSecret, Number.isFinite(res.rev) ? res.rev : (s.state ? s.state.rev + 1 : 1));
    await app.refresh().catch(() => {});
  },

  /** Vuelve a pintar la vista actual (p. ej. tras cambiar un filtro). */
  render() { renderMain({ routeChanged: false }); },

  /** Abre la pantalla de inicio sin secreto (crear espacio / demostración). */
  goHome() {
    history.pushState(null, '', location.pathname + location.search);
    onHashChange();
  },

  /** Entra en un espacio recién creado. */
  openSpace(secret, route = { name: 'summary' }) {
    location.hash = buildHash(secret, route);
  },
};

// ---------- Estado ----------

function applyState(s, state) {
  if (!state || typeof state !== 'object') return;
  if (s.state && Number(state.rev) < Number(s.state.rev)) return;
  s.state = state;
  s.status = 'ready';
  renderMain({ routeChanged: false });
  for (const fn of [...stateListeners]) {
    try { fn(state); } catch { /* un formulario no debe romper el resto */ }
  }
}

async function startSession(secret) {
  if (session) session.sync.stop();
  closeAllSheets();
  stateListeners.clear();
  uiMemory.clear();
  const s = { secret, state: null, status: 'loading', shell: null, refreshing: null, refreshAgain: false, sync: null };
  s.sync = createSync({
    api,
    getRev: () => (s.state ? Number(s.state.rev) : -1),
    onNewRev: () => { if (s === session) app.refresh().catch(() => {}); },
    onUnauthorized: () => { if (s === session) app.invalidate(); },
    onStatus: (status) => { if (s === session) setSyncStatus(s.shell, status); },
  });
  session = s;
  replaceChildren(root, renderLoading());
  await loadInitial(s);
}

async function loadInitial(s) {
  s.status = 'loading';
  try {
    const state = await api.getState(s.secret);
    if (s !== session) return;
    s.state = state;
    s.status = 'ready';
    if (!isDemoState(state)) remembered.set(s.secret);
    s.sync.start(s.secret);
    renderMain({ routeChanged: true });
  } catch (err) {
    if (s !== session) return;
    if (err && err.code === 'unauthorized') { app.invalidate(); return; }
    s.status = 'error';
    replaceChildren(root, renderLoadError(app, err, () => {
      replaceChildren(root, renderLoading());
      loadInitial(s);
    }));
  }
}

// ---------- Renderizado ----------

const TITLES = { summary: 'Resumen', savings: 'Ahorros', settings: 'Ajustes' };

function renderMain({ routeChanged }) {
  const s = session;
  if (!s || s.status !== 'ready' || !s.state) return;
  if (!s.shell || !root.contains(s.shell.root)) {
    s.shell = renderShell(app);
    replaceChildren(root, s.shell.root);
    routeChanged = true;
  }
  const shell = s.shell;
  updateShell(app, shell, { routeChanged });

  const view = VIEWS[currentRoute.name] || renderSummary;
  const main = shell.main;

  // Conservar foco, borradores y desplazamiento al repintar por un cambio de datos.
  const active = document.activeElement;
  const focusKey = !routeChanged && active && main.contains(active) ? active.closest('[data-fk]')?.dataset.fk : null;
  const selection = focusKey && active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd] : null;
  const drafts = new Map();
  main.querySelectorAll('[data-persist]').forEach((el) => drafts.set(el.dataset.persist, el.value));
  const scrollY = window.scrollY;

  const content = view(app);
  replaceChildren(main, content);

  for (const [key, value] of drafts) {
    const el = main.querySelector(`[data-persist="${CSS.escape(key)}"]`);
    if (el && !el.value) el.value = value;
  }

  let title = TITLES[currentRoute.name];
  if (currentRoute.name === 'goal') title = (app.goal(currentRoute.id) || {}).name || 'Objetivo';
  if (currentRoute.name === 'tab') title = app.tabName(currentRoute.id) || 'Pestaña';
  document.title = title ? `${title} · Rumbo` : 'Rumbo';

  if (routeChanged) {
    window.scrollTo(0, 0);
    const heading = main.querySelector('h1');
    if (heading && s.focusOnRoute) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    s.focusOnRoute = true;
  } else {
    window.scrollTo(0, scrollY);
    if (focusKey) {
      const el = main.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (selection && typeof el.setSelectionRange === 'function') {
          try { el.setSelectionRange(selection[0], selection[1]); } catch { /* no aplicable */ }
        }
      }
    }
  }
}

// ---------- Ruteo ----------

function onHashChange() {
  const { secret, route } = parseHash(location.hash);
  if (!secret) {
    const saved = remembered.get();
    if (saved) {
      history.replaceState(null, '', buildHash(saved, { name: 'summary' }));
      onHashChange();
      return;
    }
    if (session) { session.sync.stop(); session = null; }
    closeAllSheets();
    currentRoute = { name: 'home' };
    document.title = 'Rumbo';
    replaceChildren(root, renderHome(app));
    return;
  }
  if (!isValidSecret(secret)) {
    if (session) { session.sync.stop(); session = null; }
    closeAllSheets();
    currentRoute = { name: 'invalid' };
    document.title = 'Rumbo';
    replaceChildren(root, renderInvalid(app));
    return;
  }
  if (route.name === 'welcome') {
    if (session) { session.sync.stop(); session = null; }
    closeAllSheets();
    currentRoute = route;
    document.title = 'Vuestro enlace · Rumbo';
    replaceChildren(root, renderWelcome(app, secret));
    return;
  }
  const changed = !sameRoute(route, currentRoute);
  currentRoute = route;
  if (!session || session.secret !== secret) {
    startSession(secret);
    return;
  }
  if (session.status === 'invalid') { app.invalidate(); return; }
  if (session.status === 'ready') {
    if (changed) closeAllSheets();
    renderMain({ routeChanged: changed });
  }
}

// ---------- Arranque ----------

async function boot() {
  initToasts();
  try {
    if (backendKind === 'pglite') {
      document.body.prepend(h('div', { class: 'banner banner-test', role: 'note' }, icon('database'),
        h('span', null, 'Modo de pruebas locales · base de datos PGlite solo en este navegador · sin Supabase')));
      replaceChildren(root, renderLoading('Preparando la base de datos local de pruebas…'));
      const mod = await import('./backend-pglite.js');
      api = createApi(await mod.createPgliteBackend());
    } else {
      if (!config.supabaseUrl || !config.supabaseKey) {
        replaceChildren(root, renderSetupMissing());
        return;
      }
      api = createApi(createSupabaseBackend(config));
    }
  } catch (err) {
    replaceChildren(root, renderLoadError(app, err, () => location.reload()));
    return;
  }
  window.addEventListener('hashchange', onHashChange);
  onHashChange();
}

if (root) {
  boot();
} else {
  document.body.append(h('p', null, 'No se ha podido iniciar la aplicación.'));
}

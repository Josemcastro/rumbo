// Estructura fija de la aplicación: franjas (demo / pruebas locales), barra superior mínima
// (logo e indicador de sincronización), zona principal y barra de navegación inferior
// flotante con los cuatro destinos: Resumen, Objetivos, Ahorros y Ajustes.

import { h, icon, appLogo, prefersReducedMotion } from '../ui.js';
import { flag } from '../labels.js';

const SYNC_TEXT = {
  live: 'Sincronizado',
  reconnecting: 'Reconectando…',
  offline: 'Sin conexión',
};

let lastSyncStatus = 'reconnecting';

/** Destinos de la barra inferior (siempre estos cuatro, del mismo ancho). */
const NAV_ITEMS = [
  { key: 'summary', label: 'Resumen', iconName: 'home' },
  { key: 'goals', label: 'Objetivos', iconName: 'target' },
  { key: 'savings', label: 'Ahorros', iconName: 'piggy' },
  { key: 'settings', label: 'Ajustes', iconName: 'gear' },
];

/** Destino de la barra al que pertenece una ruta (el detalle de un objetivo, a Objetivos). */
function navSection(route) {
  return route && route.name === 'goal' ? 'goals' : route && route.name;
}

/** Ruta de cada destino. «Objetivos» vuelve a la última pestaña elegida, si sigue existiendo. */
function navRoute(app, key) {
  if (key === 'goals') {
    const tabId = app.memory.get('goals-tab');
    return tabId != null && app.tab(tabId) ? { name: 'goals', id: tabId } : { name: 'goals' };
  }
  return { name: key };
}

export function renderShell(app) {
  const main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  const skip = h('button', { type: 'button', class: 'skip-link', onClick: () => main.focus() }, 'Saltar al contenido');

  const demoBanner = h('div', { class: 'banner banner-demo', role: 'note', hidden: true }, icon('eye'),
    h('span', null, 'Modo demostración · datos ficticios'),
    h('button', { type: 'button', class: 'banner-link', onClick: () => app.goHome() }, 'Crear vuestro espacio'));

  const brand = h('a', { class: 'brand', href: '#' }, appLogo(28, 'brand-logo'), h('span', null, 'Rumbo'));
  const syncDot = h('span', { class: 'sync-dot', 'aria-hidden': 'true' });
  const syncText = h('span', { class: 'sync-text' }, SYNC_TEXT[lastSyncStatus]);
  const sync = h('span', { class: ['sync', `is-${lastSyncStatus}`], role: 'status', 'aria-live': 'polite' }, syncDot, syncText);

  const header = h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, brand, sync));

  // Va antes de <main> en el orden del documento (el enlace «Saltar al contenido» la salta),
  // aunque se vea flotando abajo.
  const navLinks = new Map();
  const nav = h('nav', { class: 'bottom-nav', 'aria-label': 'Navegación principal' },
    h('ul', { class: 'bottom-nav-list' }, NAV_ITEMS.map((item) => {
      const link = h('a', { class: 'bottom-nav-link', href: '#' }, icon(item.iconName), h('span', { class: 'bottom-nav-label' }, item.label));
      // Pulsar el destino en el que ya estáis sube al principio de la página.
      link.addEventListener('click', (e) => {
        if (link.getAttribute('href') !== location.hash) return;
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      });
      navLinks.set(item.key, link);
      return h('li', null, link);
    })));

  const rootEl = h('div', { class: 'app-shell' }, skip, demoBanner, header, nav, main);
  return { root: rootEl, main, demoBanner, brand, nav, navLinks, sync, syncText };
}

export function setSyncStatus(shell, status) {
  lastSyncStatus = status;
  if (!shell) return;
  shell.sync.className = `sync is-${status}`;
  shell.syncText.textContent = SYNC_TEXT[status] || '';
}

export function updateShell(app, shell) {
  const state = app.state;
  const route = app.route;
  shell.demoBanner.hidden = !flag(state.space && state.space.is_demo);
  shell.brand.href = app.href({ name: 'summary' });

  // Se actualizan los enlaces existentes (no se recrean) para no perder el foco.
  const current = navSection(route);
  for (const item of NAV_ITEMS) {
    const link = shell.navLinks.get(item.key);
    link.href = app.href(navRoute(app, item.key));
    const on = item.key === current;
    link.classList.toggle('is-current', on);
    // «page» en la propia página; «true» en una página que depende de ella (detalle, subajustes).
    if (on) link.setAttribute('aria-current', route.name === 'goal' || route.section ? 'true' : 'page');
    else link.removeAttribute('aria-current');
  }
}

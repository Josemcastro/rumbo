// Estructura fija de la aplicación: franjas (demo / pruebas locales), barra superior con
// indicador de sincronización y ajustes, barra de pestañas y zona principal.

import { h, icon, replaceChildren } from '../ui.js';
import { flag } from '../labels.js';
import { openTabManager } from '../forms/tabs.js';

const SYNC_TEXT = {
  live: 'Sincronizado',
  reconnecting: 'Reconectando…',
  offline: 'Sin conexión',
};

let lastSyncStatus = 'reconnecting';

export function renderShell(app) {
  const main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  const skip = h('button', { type: 'button', class: 'skip-link', onClick: () => main.focus() }, 'Saltar al contenido');

  const demoBanner = h('div', { class: 'banner banner-demo', role: 'note', hidden: true }, icon('eye'),
    h('span', null, 'Modo demostración · datos ficticios'),
    h('button', { type: 'button', class: 'banner-link', onClick: () => app.goHome() }, 'Crear vuestro espacio'));

  const brand = h('a', { class: 'brand', href: '#' }, icon('logo', 'brand-mark'), h('span', null, 'Rumbo'));
  const syncDot = h('span', { class: 'sync-dot', 'aria-hidden': 'true' });
  const syncText = h('span', { class: 'sync-text' }, SYNC_TEXT[lastSyncStatus]);
  const sync = h('span', { class: ['sync', `is-${lastSyncStatus}`], role: 'status', 'aria-live': 'polite' }, syncDot, syncText);
  const settingsLink = h('a', { class: 'icon-btn', href: '#', 'aria-label': 'Ajustes', title: 'Ajustes' }, icon('settings'));

  const header = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' }, brand, h('div', { class: 'topbar-right' }, sync, settingsLink)));

  const tabList = h('ul', { class: 'tabbar-list' });
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Secciones' }, h('div', { class: 'tabbar-inner' }, tabList));

  const rootEl = h('div', { class: 'app-shell' }, skip, demoBanner, header, nav, main);
  return { root: rootEl, main, demoBanner, brand, settingsLink, tabList, nav, sync, syncText };
}

export function setSyncStatus(shell, status) {
  lastSyncStatus = status;
  if (!shell) return;
  shell.sync.className = `sync is-${status}`;
  shell.syncText.textContent = SYNC_TEXT[status] || '';
}

export function updateShell(app, shell, { routeChanged }) {
  const state = app.state;
  shell.demoBanner.hidden = !flag(state.space && state.space.is_demo);
  shell.brand.href = app.href({ name: 'summary' });
  shell.settingsLink.href = app.href({ name: 'settings' });
  if (app.route.name === 'settings') shell.settingsLink.setAttribute('aria-current', 'page');
  else shell.settingsLink.removeAttribute('aria-current');

  const route = app.route;
  const parentTabId = route.name === 'goal' ? (app.goal(route.id) || {}).tab_id : null;
  const items = [
    { route: { name: 'summary' }, label: 'Resumen', iconName: 'home' },
    { route: { name: 'savings' }, label: 'Ahorros', iconName: 'piggy' },
    ...app.sortedTabs().map((t) => ({ route: { name: 'tab', id: t.id }, label: t.name, count: t.goal_count, tabId: t.id })),
  ];

  const scrollLeft = shell.tabList.parentElement.scrollLeft;
  const nodes = items.map((item) => {
    const current = item.route.name === route.name && (item.route.id ?? null) === (route.id ?? null);
    const isParent = parentTabId != null && item.tabId === parentTabId;
    return h('li', null, h('a', {
      class: ['tab-link', current && 'is-current', isParent && 'is-parent'],
      href: app.href(item.route),
      'aria-current': current ? 'page' : null,
      dataset: { fk: `tab-${item.route.name}-${item.route.id ?? ''}` },
    }, item.iconName ? icon(item.iconName) : null, h('span', null, item.label)));
  });
  nodes.push(h('li', null, h('button', {
    type: 'button', class: 'tab-link tab-manage', onClick: () => openTabManager(app), dataset: { fk: 'tab-manage' },
  }, icon('list'), h('span', null, 'Gestionar'))));
  replaceChildren(shell.tabList, nodes);

  const scroller = shell.tabList.parentElement;
  scroller.scrollLeft = scrollLeft;
  if (routeChanged) {
    const current = shell.tabList.querySelector('.is-current, .is-parent');
    if (current) {
      const left = current.offsetLeft - 16;
      const right = current.offsetLeft + current.offsetWidth + 16 - scroller.clientWidth;
      if (left < scroller.scrollLeft) scroller.scrollLeft = left;
      else if (right > scroller.scrollLeft) scroller.scrollLeft = right;
    }
  }
}

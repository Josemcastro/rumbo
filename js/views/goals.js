// Vista «Objetivos»: todos los objetivos o los de una pestaña (chips con desplazamiento
// horizontal propio), con «Mostrar» y «Ordenar por», las tarjetas, «+ Nuevo objetivo»
// (en la pestaña elegida) y un acceso discreto a la gestión de pestañas.

import { h, icon } from '../ui.js';
import { goalSection } from './cards.js';

export function renderGoalsView(app) {
  const tabId = app.route.id ?? null;
  const tab = tabId != null ? app.tab(tabId) : null;
  if (tabId != null && !tab) {
    return renderMissing(app, 'Esta pestaña ya no existe', 'Puede que se haya eliminado desde otro dispositivo.',
      { route: { name: 'goals' }, label: 'Ver todos los objetivos' });
  }
  const goals = tab ? app.state.goals.filter((g) => g.tab_id === tab.id) : app.state.goals;
  return h('div', { class: 'view' },
    h('header', { class: 'view-head view-head-center' }, h('h1', { class: 'view-title' }, 'Objetivos')),
    tabChips(app, tabId),
    goalSection(app, goals, { tabId, heading: null, label: tab ? `Objetivos de ${tab.name}` : 'Todos los objetivos' }),
    h('p', { class: 'view-foot' },
      h('a', { class: 'quiet-link', href: app.href({ name: 'settings', section: 'pestanas' }), dataset: { fk: 'manage-tabs' } },
        icon('settings'), h('span', null, 'Gestionar pestañas'))));
}

/** «Todas» + cada pestaña, en su orden. Se desplaza en horizontal sin mover la página. */
function tabChips(app, currentId) {
  const items = [{ id: null, label: 'Todas' }, ...app.sortedTabs().map((t) => ({ id: t.id, label: t.name }))];
  const list = h('ul', { class: 'chips' }, items.map((item) => {
    const current = item.id === currentId;
    return h('li', null, h('a', {
      class: ['chip', current && 'is-current'],
      href: app.href(item.id == null ? { name: 'goals' } : { name: 'goals', id: item.id }),
      'aria-current': current ? 'page' : null,
      dataset: { fk: `chip-${item.id ?? 'all'}` },
    }, h('span', { class: 'chip-pill' }, item.label)));
  }));
  const scroller = h('nav', { class: 'chip-scroller', 'aria-label': 'Pestañas de objetivos' }, list);

  // Al repintar se conserva el desplazamiento y la pestaña elegida queda a la vista.
  scroller.addEventListener('scroll', () => app.memory.set('chips-scroll', scroller.scrollLeft), { passive: true });
  queueMicrotask(() => {
    if (!scroller.isConnected) return;
    scroller.scrollLeft = app.memory.get('chips-scroll') || 0;
    const chip = list.querySelector('.is-current');
    if (!chip) return;
    const margin = 24;
    const left = chip.offsetLeft - margin;
    const right = chip.offsetLeft + chip.offsetWidth + margin - scroller.clientWidth;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (right > scroller.scrollLeft) scroller.scrollLeft = right;
  });
  return scroller;
}

/** Página para algo que ya no existe (borrado desde otro dispositivo), con un enlace de vuelta. */
export function renderMissing(app, title, text, { route = { name: 'summary' }, label = 'Volver al resumen' } = {}) {
  return h('div', { class: 'view' },
    h('div', { class: 'empty empty-page' },
      icon('info'),
      h('h1', { class: 'view-title' }, title),
      h('p', { class: 'empty-text' }, text),
      h('a', { class: 'btn btn-secondary', href: app.href(route) }, label)));
}

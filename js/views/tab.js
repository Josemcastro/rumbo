// Vista de una pestaña personalizable: sus objetivos con el mismo filtro y orden.

import { h, button, icon } from '../ui.js';
import { goalSection } from './cards.js';
import { openRenameTab } from '../forms/tabs.js';

export function renderTabView(app) {
  const tab = app.tab(app.route.id);
  if (!tab) return renderMissing(app, 'Esta pestaña ya no existe', 'Puede que se haya eliminado desde otro dispositivo.');
  const goals = app.state.goals.filter((g) => g.tab_id === tab.id);
  return h('div', { class: 'view' },
    h('header', { class: 'view-head view-head-center' },
      h('h1', { class: 'view-title' }, tab.name),
      button('Renombrar', () => openRenameTab(app, tab.id), { variant: 'plain', small: true, iconName: 'pencil', dataset: { fk: 'rename-tab' } })),
    goalSection(app, goals, { tabId: tab.id }));
}

export function renderMissing(app, title, text) {
  return h('div', { class: 'view' },
    h('div', { class: 'empty empty-page' },
      icon('info'),
      h('h1', { class: 'view-title' }, title),
      h('p', { class: 'empty-text' }, text),
      h('a', { class: 'btn btn-secondary', href: app.href({ name: 'summary' }) }, 'Volver al resumen')));
}

// Vista «Resumen»: solo los objetivos, cada uno con su círculo de progreso.
// Las cifras de dinero viven en «Ahorros»; los objetivos se crean desde
// «Gestionar» o desde cada pestaña.

import { h, button } from '../ui.js';
import { goalSection } from './cards.js';
import { openNamesForm } from '../forms/settings.js';

export function renderSummary(app) {
  const { goals, space } = app.state;
  const names = app.names();
  const unnamed = !(space && (space.name_a || space.name_b));

  return h('div', { class: 'view' },
    h('header', { class: 'view-head view-head-center' },
      h('h1', { class: 'view-title' }, 'Resumen'),
      unnamed
        ? h('p', { class: 'view-sub' }, button('Poned vuestros nombres', () => openNamesForm(app), { variant: 'plain', small: true, iconName: 'users', extraClass: 'btn-inline', dataset: { fk: 'set-names' } }))
        : h('p', { class: 'view-sub' }, `${names.a} y ${names.b}`)),
    goalSection(app, goals, { showTab: true, allowCreate: false }));
}

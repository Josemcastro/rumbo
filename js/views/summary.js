// Vista «Resumen»: un vistazo a los objetivos, cada uno solo con su nombre, su meta y el
// círculo de progreso. Las cifras de dinero viven en «Ahorros» y los objetivos se crean
// desde «Objetivos».

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
        ? h('p', { class: 'view-sub' }, button('Poned vuestros nombres', () => openNamesForm(app), { variant: 'plain', small: true, iconName: 'users', dataset: { fk: 'set-names' } }))
        : h('p', { class: 'view-sub' }, `${names.a} y ${names.b}`)),
    goalSection(app, goals, {
      compact: true,
      allowCreate: false,
      empty: {
        text: 'Cread el primero en «Objetivos», en la barra de abajo: una meta, la pestaña donde va y para quién es.',
        action: h('a', { class: 'btn btn-secondary btn-small', href: app.href({ name: 'goals' }), dataset: { fk: 'go-goals' } }, 'Ir a Objetivos'),
      },
    }));
}

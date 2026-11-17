// Vista «Resumen»: tres cifras de dinero, avance global de objetivos activos y tarjetas.

import { h, button, progressBar, notice } from '../ui.js';
import { formatCents, formatPercent } from '../format.js';
import { goalSection, stat } from './cards.js';
import { openDeposit } from '../forms/money.js';
import { openNamesForm } from '../forms/settings.js';

export function renderSummary(app) {
  const { savings, summary, goals, movements, space } = app.state;
  const names = app.names();
  const unnamed = !(space && (space.name_a || space.name_b));

  const stats = h('section', { class: 'section', 'aria-label': 'Dinero' },
    h('div', { class: 'stats' },
      stat('Ahorros totales', savings.total_cents, { hint: 'Todo lo que tenéis ahorrado ahora mismo.' }),
      stat('Disponible para asignar', savings.available_cents, { hint: 'Ahorros que aún no están reservados para ningún objetivo.', tone: 'accent' }),
      stat('Pendiente en objetivos activos', summary.active_pending_cents, { hint: 'Lo que falta para cubrir las metas de los objetivos activos.' })));

  const intro = !movements.length
    ? notice('info',
      h('p', null, 'Empezad registrando cuánto tenéis ahorrado hoy. Después podréis reservar parte para cada objetivo.'),
      button('Registrar ahorros iniciales', () => openDeposit(app, { initial: true }), { variant: 'primary', small: true, iconName: 'plus', dataset: { fk: 'initial-savings' } }))
    : null;

  let progress = null;
  if (summary.active_percent !== null && summary.active_percent !== undefined) {
    progress = h('section', { class: 'section card progress-card', 'aria-labelledby': 'progress-heading' },
      h('div', { class: 'progress-card-head' },
        h('h2', { id: 'progress-heading', class: 'section-title' }, 'Avance de objetivos activos'),
        h('span', { class: 'progress-card-percent' }, formatPercent(summary.active_percent))),
      progressBar(Math.min(100, summary.active_percent), {
        label: 'Avance de objetivos activos',
        valueText: `${formatPercent(summary.active_percent)}: ${formatCents(summary.active_covered_capped_cents)} de ${formatCents(summary.active_target_cents)}`,
      }),
      h('p', { class: 'muted small' },
        `${formatCents(summary.active_covered_capped_cents)} de ${formatCents(summary.active_target_cents)} cubiertos. Cuenta lo reservado y lo ya pagado de cada objetivo, hasta su meta.`));
  }

  return h('div', { class: 'view' },
    h('header', { class: 'view-head' },
      h('h1', { class: 'view-title' }, 'Resumen'),
      unnamed
        ? h('p', { class: 'view-sub' }, button('Poned vuestros nombres', () => openNamesForm(app), { variant: 'plain', small: true, iconName: 'users', extraClass: 'btn-inline', dataset: { fk: 'set-names' } }))
        : h('p', { class: 'view-sub' }, `${names.a} y ${names.b}`)),
    intro,
    stats,
    progress,
    goalSection(app, goals, { showTab: true }));
}

// Vista «Ahorros»: cifras, entradas y salidas, reservas por objetivo e historial completo.

import { h, button, notice } from '../ui.js';
import { formatCents } from '../format.js';
import { stat, statusBadge } from './cards.js';
import { movementList } from './movements.js';
import { openDeposit, openWithdrawal, openRelease, openTransfer } from '../forms/money.js';

export function renderSavings(app) {
  const { savings, goals, movements } = app.state;

  const reserved = goals
    .filter((g) => (g.computed && g.computed.reserved_cents) > 0)
    .sort((a, b) => b.computed.reserved_cents - a.computed.reserved_cents);

  const reservations = reserved.length
    ? h('ul', { class: 'reserve-list' }, reserved.map((g) => h('li', { class: 'reserve-item' },
      h('div', { class: 'reserve-main' },
        h('a', { href: app.href({ name: 'goal', id: g.id }), class: 'reserve-name', dataset: { fk: `reserve-${g.id}` } }, g.name),
        g.status !== 'active' ? statusBadge(g.status) : null),
      h('span', { class: 'reserve-amount' }, formatCents(g.computed.reserved_cents)),
      h('div', { class: 'reserve-actions' },
        button('Liberar', () => openRelease(app, g.id), { variant: 'plain', small: true, dataset: { fk: `release-${g.id}` } }),
        button('Mover', () => openTransfer(app, g.id), { variant: 'plain', small: true, dataset: { fk: `transfer-${g.id}` } })))))
    : h('p', { class: 'muted' }, 'Ningún objetivo tiene dinero reservado ahora mismo.');

  return h('div', { class: 'view' },
    h('header', { class: 'view-head view-head-center' }, h('h1', { class: 'view-title' }, 'Ahorros')),
    h('section', { class: 'section', 'aria-label': 'Dinero' },
      h('div', { class: 'stats' },
        stat('Ahorros totales', savings.total_cents, { hint: 'Todo lo que tenéis ahorrado.' }),
        stat('Asignado a objetivos', savings.allocated_cents, { hint: 'Reservado para objetivos (de cualquier estado).' }),
        stat('Disponible para asignar', savings.available_cents, { hint: 'Libre para reservar o gastar.', tone: 'accent' })),
      h('div', { class: 'button-row button-row-even' },
        button('Añadir ahorro', () => openDeposit(app, { initial: false }), { variant: 'primary', dataset: { fk: 'add-saving' } }),
        button('Registrar salida', () => openWithdrawal(app), { dataset: { fk: 'withdrawal' } }))),
    !movements.length
      ? notice('info',
        h('p', null, '¿Ya tenéis algo ahorrado? Registradlo como ahorros iniciales para empezar desde vuestra situación real.'),
        button('Registrar ahorros iniciales', () => openDeposit(app, { initial: true }), { variant: 'primary', small: true, dataset: { fk: 'initial-savings' } }))
      : null,
    h('section', { class: 'section', 'aria-labelledby': 'reserves-heading' },
      h('h2', { id: 'reserves-heading', class: 'section-title' }, 'Reservado por objetivo'),
      reservations),
    h('section', { class: 'section', 'aria-labelledby': 'history-heading' },
      h('h2', { id: 'history-heading', class: 'section-title' }, 'Historial'),
      movementList(app, movements, { key: 'all', emptyText: 'Todavía no hay movimientos.' })));
}

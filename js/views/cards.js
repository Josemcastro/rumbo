// Tarjetas de objetivo, filtro por estado, orden y cifras destacadas.

import { h, icon, button, selectInput, nextId } from '../ui.js';
import { formatCents, formatPercent, formatDate, todayISO } from '../format.js';
import {
  STATUS_LABELS, STATUS_ICONS, PRIORITY_ORDER, FILTER_OPTIONS, SORT_OPTIONS,
} from '../labels.js';
import { openGoalCreate } from '../forms/goal.js';

export function computed(goal) {
  return (goal && goal.computed) || {};
}

/** «Faltan 100,00 €» / «Financiado» / «Excedente 50,00 €» con su icono. */
export function fundingLine(goal) {
  const c = computed(goal);
  if (c.surplus_cents > 0) return { iconName: 'checkCircle', text: `Excedente ${formatCents(c.surplus_cents)}`, tone: 'funded' };
  if (c.funding_status === 'funded') return { iconName: 'checkCircle', text: 'Financiado', tone: 'funded' };
  return { iconName: c.funding_status === 'none' ? 'circle' : 'clock', text: `Faltan ${formatCents(c.pending_cents || 0)}`, tone: c.funding_status || 'none' };
}

export function statusBadge(status) {
  return h('span', { class: ['badge', `badge-${status}`] }, icon(STATUS_ICONS[status] || 'circle'), h('span', null, STATUS_LABELS[status] || status));
}

export function filterGoals(goals, filter) {
  if (filter === 'all') return goals.slice();
  return goals.filter((g) => g.status === filter);
}

function byDate(a, b) {
  const da = a.desired_date || '9999-99-99';
  const db = b.desired_date || '9999-99-99';
  return da < db ? -1 : da > db ? 1 : 0;
}

export function sortGoals(goals, sort) {
  const list = goals.slice();
  const prio = (g) => PRIORITY_ORDER[g.priority] ?? 1;
  const name = (a, b) => String(a.name).localeCompare(String(b.name), 'es');
  if (sort === 'date') list.sort((a, b) => byDate(a, b) || prio(a) - prio(b) || name(a, b));
  else if (sort === 'progress') list.sort((a, b) => (computed(b).percent || 0) - (computed(a).percent || 0) || prio(a) - prio(b) || name(a, b));
  else list.sort((a, b) => prio(a) - prio(b) || byDate(a, b) || name(a, b));
  return list;
}

/** Selectores «Mostrar» y «Ordenar por» (las preferencias se recuerdan en este navegador). */
export function goalControls(app, goals) {
  const filter = app.prefs.get('filter', 'active');
  const sort = app.prefs.get('sort', 'priority');
  const counts = (value) => (value === 'all' ? goals.length : goals.filter((g) => g.status === value).length);
  const filterId = nextId('filter');
  const sortId = nextId('sort');
  const filterSelect = selectInput(FILTER_OPTIONS.map((o) => ({ value: o.value, label: `${o.label} (${counts(o.value)})` })), filter,
    { id: filterId, class: 'select-compact', dataset: { fk: 'goal-filter' } });
  const sortSelect = selectInput(SORT_OPTIONS, sort, { id: sortId, class: 'select-compact', dataset: { fk: 'goal-sort' } });
  filterSelect.addEventListener('change', () => { app.prefs.set('filter', filterSelect.value); app.render(); });
  sortSelect.addEventListener('change', () => { app.prefs.set('sort', sortSelect.value); app.render(); });
  return h('div', { class: 'list-controls' },
    h('div', { class: 'control' }, h('label', { for: filterId }, 'Mostrar'), filterSelect),
    h('div', { class: 'control' }, h('label', { for: sortId }, 'Ordenar por'), sortSelect));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_SIZE = 72;
const RING_STROKE = 6;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_LEN = 2 * Math.PI * RING_R;

/**
 * Círculo de progreso económico con el porcentaje dentro. Se llena según el
 * porcentaje (limitado al 100 %). Usa atributos SVG, no estilos en línea (CSP).
 */
export function progressRing(goal) {
  const c = computed(goal);
  const pct = Math.max(0, Math.min(100, Number(c.percent_capped) || 0));
  const funded = c.funding_status === 'funded';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${RING_SIZE} ${RING_SIZE}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'ring-svg');
  const mk = (cls) => {
    const el = document.createElementNS(SVG_NS, 'circle');
    el.setAttribute('cx', String(RING_SIZE / 2));
    el.setAttribute('cy', String(RING_SIZE / 2));
    el.setAttribute('r', String(RING_R));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke-width', String(RING_STROKE));
    el.setAttribute('class', cls);
    return el;
  };
  const track = mk('ring-track');
  const fill = mk('ring-fill');
  fill.setAttribute('stroke-linecap', 'round');
  fill.setAttribute('transform', `rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`);
  const len = (RING_LEN * pct) / 100;
  fill.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${RING_LEN.toFixed(2)}`);
  if (pct <= 0) fill.setAttribute('stroke-opacity', '0');
  svg.append(track, fill);
  const text = formatPercent(pct);
  return h('div', {
    class: ['ring', funded && 'is-funded'],
    role: 'img',
    'aria-label': `Progreso económico: ${formatPercent(c.percent)}`,
  }, svg, h('span', { class: 'ring-text', 'aria-hidden': 'true' }, text));
}

export function goalCard(app, goal, { showTab = false } = {}) {
  const c = computed(goal);
  const funding = fundingLine(goal);
  const covered = c.covered_cents || 0;
  const target = c.target_cents || 0;
  const titleId = nextId('goal-title');
  const tabName = showTab ? app.tabName(goal.tab_id) : null;
  const foot = [];
  if (c.tasks_total > 0) foot.push(h('span', null, icon('list'), `${c.tasks_done} de ${c.tasks_total} tareas`));
  if (goal.desired_date) {
    const late = goal.desired_date < todayISO() && (goal.status === 'active' || goal.status === 'paused') && c.funding_status !== 'funded';
    foot.push(h('span', { class: late ? 'is-late' : null }, icon('calendar'), formatDate(goal.desired_date)));
  }

  return h('article', { class: ['goal-card', `is-${goal.status}`], 'aria-labelledby': titleId },
    h('div', { class: 'goal-card-body' },
      tabName ? h('p', { class: 'goal-card-meta' }, tabName) : null,
      h('h3', { class: 'goal-card-title', id: titleId },
        h('a', { href: app.href({ name: 'goal', id: goal.id }), class: 'stretched-link', dataset: { fk: `goal-${goal.id}` } }, goal.name)),
      goal.status !== 'active' ? h('div', { class: 'goal-card-badge' }, statusBadge(goal.status)) : null,
      h('p', { class: 'goal-card-amounts' }, h('strong', null, formatCents(covered)), ` de ${formatCents(target)}`),
      h('p', { class: ['funding', `funding-${funding.tone}`] }, icon(funding.iconName), funding.text),
      foot.length ? h('p', { class: 'goal-card-foot' }, foot) : null),
    progressRing(goal));
}

/** Tarjeta discontinua «+ Nuevo objetivo», del mismo tamaño que las demás. */
function addGoalTile(app, tabId) {
  return h('button', {
    type: 'button', class: 'goal-card goal-add', dataset: { fk: 'new-goal' },
    onclick: () => openGoalCreate(app, { tabId }),
  }, icon('plus'), h('span', null, 'Nuevo objetivo'));
}

/** Lista de tarjetas con controles, «Nuevo objetivo» (opcional) y estado vacío. */
export function goalSection(app, goals, { showTab = false, tabId = null, heading = 'Objetivos', allowCreate = true } = {}) {
  const filter = app.prefs.get('filter', 'active');
  const sort = app.prefs.get('sort', 'priority');
  const visible = sortGoals(filterGoals(goals, filter), sort);
  const tile = allowCreate ? addGoalTile(app, tabId) : null;

  let note = null;
  if (!goals.length) {
    note = h('div', { class: 'empty empty-center' },
      h('p', { class: 'empty-title' }, tabId ? 'Aún no hay objetivos en esta pestaña' : 'Aún no tenéis objetivos'),
      h('p', { class: 'empty-text' }, allowCreate
        ? 'Un objetivo es algo para lo que queréis ahorrar: la entrada de un piso, un viaje, la boda… Podéis añadirle una meta, un desglose y los pasos que faltan.'
        : 'Cread el primero desde «Gestionar», en la barra de pestañas, o desde dentro de cualquier pestaña.'));
  } else if (!visible.length) {
    const label = (FILTER_OPTIONS.find((o) => o.value === filter) || {}).label || '';
    note = h('div', { class: 'empty empty-center' },
      h('p', { class: 'empty-text' }, `No hay objetivos en «${label}».`),
      button('Mostrar todos', () => { app.prefs.set('filter', 'all'); app.render(); }, { small: true }));
  }
  const cards = visible.map((g) => goalCard(app, g, { showTab }));
  if (tile) cards.push(tile);

  return h('section', { class: 'section', 'aria-labelledby': 'goals-heading' },
    h('div', { class: 'section-head is-solo' }, h('h2', { id: 'goals-heading', class: 'section-title' }, heading)),
    goals.length ? goalControls(app, goals) : null,
    note,
    cards.length ? h('div', { class: 'goal-grid' }, cards) : null);
}

/** Cifra destacada (Ahorros totales, Disponible…). */
export function stat(label, cents, { hint, tone } = {}) {
  return h('div', { class: ['stat', tone && `stat-${tone}`] },
    h('p', { class: 'stat-label' }, label),
    h('p', { class: 'stat-value' }, formatCents(cents || 0)),
    hint ? h('p', { class: 'stat-hint' }, hint) : null);
}

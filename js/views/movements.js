// Historial de movimientos (todos, también anulados y corregidos, con sus enlaces).

import { h, icon, button } from '../ui.js';
import { formatCents, formatSignedCents, formatDate, formatDateTime } from '../format.js';
import { kindLabel, KIND_ICONS, totalSign, goalSign, attributionLabel } from '../labels.js';
import { openCorrectMovement, openVoidMovement } from '../forms/movements.js';

const PAGE = 30;

function goalText(m, goalId) {
  if (m.kind === 'transfer') {
    if (goalId === m.goal_id) return `A «${m.to_goal_name || 'otro objetivo'}»`;
    if (goalId === m.to_goal_id) return `Desde «${m.goal_name || 'otro objetivo'}»`;
    return `De «${m.goal_name || ''}» a «${m.to_goal_name || ''}»`;
  }
  if (goalId) return '';
  return m.goal_name ? `«${m.goal_name}»` : '';
}

function focusMovement(id, reveal) {
  let el = document.getElementById(`mov-${id}`);
  if (!el && reveal) {
    reveal();
    el = document.getElementById(`mov-${id}`);
  }
  if (!el) return;
  el.classList.add('is-highlight');
  el.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
  setTimeout(() => el.classList.remove('is-highlight'), 2000);
}

function movementItem(app, m, { goalId, byId, reveal }) {
  const names = app.names();
  const sign = goalId ? goalSign(m, goalId) : totalSign(m.kind);
  const amountText = sign === 0 ? formatCents(m.amount_cents) : formatSignedCents(m.amount_cents, sign);
  const isValid = m.status === 'valid';
  const where = goalText(m, goalId);

  const details = [formatDate(m.date)];
  if (m.attribution) details.push(attributionLabel(names, m.attribution));
  if (where) details.push(where);

  const tags = [];
  if (m.status === 'voided') {
    tags.push(h('span', { class: 'tag tag-muted' }, icon('close'), 'Anulado'));
  }
  if (m.status === 'corrected') {
    const replacement = m.replaced_by_id ? byId.get(m.replaced_by_id) : null;
    tags.push(replacement
      ? h('button', { type: 'button', class: 'tag tag-link', onClick: () => focusMovement(replacement.id, reveal) }, icon('pencil'), 'Corregido → ver nuevo')
      : h('span', { class: 'tag tag-muted' }, icon('pencil'), 'Corregido'));
  }
  if (m.corrects_id) {
    const original = byId.get(m.corrects_id);
    tags.push(original
      ? h('button', { type: 'button', class: 'tag tag-link', onClick: () => focusMovement(original.id, reveal) }, 'Corrige un movimiento anterior')
      : h('span', { class: 'tag' }, 'Corrección'));
  }
  if (m.group_id) tags.push(h('span', { class: 'tag' }, 'Pago con asignación automática'));

  const actions = [];
  if (isValid) {
    if (!m.group_id) {
      actions.push(button('Corregir', () => openCorrectMovement(app, m.id), { variant: 'plain', small: true, dataset: { fk: `correct-${m.id}` } }));
    }
    actions.push(button('Anular', () => openVoidMovement(app, m.id), { variant: 'plain', small: true, dataset: { fk: `void-${m.id}` } }));
  }

  return h('li', { class: ['movement', !isValid && 'is-inactive'], id: `mov-${m.id}`, tabindex: '-1' },
    h('span', { class: 'movement-icon' }, icon(KIND_ICONS[m.kind] || 'wallet')),
    h('div', { class: 'movement-main' },
      h('div', { class: 'movement-row' },
        h('span', { class: 'movement-kind' }, kindLabel(m)),
        h('span', { class: ['movement-amount', sign > 0 && 'is-in', sign < 0 && 'is-out', !isValid && 'is-struck'] },
          !isValid ? h('span', { class: 'visually-hidden' }, 'Sin efecto: ') : null, amountText)),
      h('p', { class: 'movement-details' }, details.join(' · ')),
      m.note ? h('p', { class: 'movement-note' }, m.note) : null,
      m.status === 'voided' && m.void_reason ? h('p', { class: 'movement-note' }, `Motivo: ${m.void_reason}`) : null,
      tags.length ? h('div', { class: 'movement-tags' }, tags) : null,
      h('p', { class: 'movement-meta' }, `Registrado el ${formatDateTime(m.created_at)}`),
      actions.length ? h('div', { class: 'movement-actions' }, actions) : null));
}

/**
 * Lista de movimientos. `key` identifica la lista para recordar cuántos se muestran.
 * Si se indica `goalId`, los importes se muestran respecto a la reserva de ese objetivo.
 */
export function movementList(app, movements, { goalId = null, key = 'all', emptyText = 'Todavía no hay movimientos.' } = {}) {
  if (!movements.length) return h('p', { class: 'muted' }, emptyText);
  const byId = new Map(app.state.movements.map((m) => [m.id, m]));
  const memKey = `movements-shown-${key}`;
  const shown = app.memory.get(memKey) || PAGE;
  const reveal = () => { app.memory.set(memKey, movements.length); app.render(); };
  const list = h('ul', { class: 'movement-list' }, movements.slice(0, shown).map((m) => movementItem(app, m, { goalId, byId, reveal })));
  const more = movements.length > shown
    ? button(`Mostrar más (${movements.length - shown})`, () => { app.memory.set(memKey, shown + PAGE); app.render(); }, { small: true, dataset: { fk: `more-${key}` } })
    : null;
  return h('div', { class: 'movement-wrap' }, list, more);
}

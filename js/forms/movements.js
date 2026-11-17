// Corregir y anular movimientos. Nunca se borra nada: el historial conserva el original.

import { h, formSheet, field, amountInput, dateInput, selectInput, textArea, notice } from '../ui.js';
import { formatCents, formatDate, parseAmount, centsToInput, isValidISODate } from '../format.js';
import { attributionOptions, kindLabel } from '../labels.js';
import { NOTE_MAX } from './money.js';

const REASON_MAX = 300;
const WITH_ATTRIBUTION = new Set(['deposit', 'deposit_to_goal', 'allocate', 'withdrawal', 'payment']);

function findMovement(app, id) {
  return app.state ? app.state.movements.find((m) => m.id === id) || null : null;
}

function describe(m) {
  const where = m.kind === 'transfer'
    ? ` de «${m.goal_name || ''}» a «${m.to_goal_name || ''}»`
    : m.goal_name ? ` · «${m.goal_name}»` : '';
  return `${kindLabel(m)} de ${formatCents(m.amount_cents)} del ${formatDate(m.date)}${where}`;
}

function ledgerHandler(app) {
  return (err, ctx) => {
    if (['ledger_conflict', 'insufficient_available', 'insufficient_reserve', 'grouped_movement'].includes(err.code)) {
      ctx.setAlert(err.message);
      app.refresh().catch(() => {});
      return true;
    }
    if (err.code === 'conflict' || err.code === 'not_found') {
      ctx.setAlert(err.message);
      app.refresh().catch(() => {});
      return true;
    }
    return false;
  };
}

export function openCorrectMovement(app, movementId) {
  const m = findMovement(app, movementId);
  if (!m) return;
  const names = app.names();
  const amount = amountInput({ value: centsToInput(m.amount_cents) });
  const date = dateInput({ value: m.date || '' });
  const withAttr = WITH_ATTRIBUTION.has(m.kind);
  const attr = withAttr ? selectInput(attributionOptions(names), m.attribution || '') : null;
  const note = textArea({ maxlength: NOTE_MAX, rows: 2, value: m.note || '' });

  formSheet(app, {
    title: 'Corregir movimiento',
    intro: h('div', { class: 'sheet-intro' },
      h('p', null, describe(m)),
      h('p', { class: 'muted small' }, 'Se guardará un movimiento nuevo con los datos corregidos y el original quedará en el historial marcado como «Corregido». Si el cambio dejara algún saldo en negativo, te diremos qué ajustar.')),
    submitLabel: 'Guardar corrección',
    successMessage: 'Movimiento corregido',
    build(form) {
      form.append(
        field({ label: 'Importe', control: amount, name: 'amount_cents' }),
        field({ label: 'Fecha', control: date, name: 'date' }),
        attr ? field({ label: '¿De quién es?', control: attr, name: 'attribution' }) : null,
        field({ label: 'Nota', control: note, name: 'note', optional: true }));
    },
    async onSubmit(ctx) {
      const cents = parseAmount(amount.value);
      let ok = true;
      if (cents === null) { ctx.fieldError('amount_cents', 'Escribe un importe mayor que cero, por ejemplo 1.250,50.'); ok = false; }
      if (!isValidISODate(date.value)) { ctx.fieldError('date', 'Elige una fecha válida.'); ok = false; }
      const noteText = note.value.trim();
      if (noteText.length > NOTE_MAX) { ctx.fieldError('note', `Usa como máximo ${NOTE_MAX} caracteres.`); ok = false; }
      if (!ok) return false;
      const payload = { id: movementId, amount_cents: cents, date: date.value, note: noteText };
      if (attr) payload.attribution = attr.value || null;
      await app.mutate('correct_movement', payload, ctx.opId);
      return true;
    },
    onError: ledgerHandler(app),
  });
}

export function openVoidMovement(app, movementId) {
  const m = findMovement(app, movementId);
  if (!m) return;
  const reason = textArea({ maxlength: REASON_MAX, rows: 2 });
  formSheet(app, {
    title: 'Anular movimiento',
    intro: h('div', { class: 'sheet-intro' },
      h('p', null, describe(m)),
      h('p', { class: 'muted small' }, 'Dejará de contar en los saldos, pero seguirá en el historial marcado como «Anulado». Si al quitarlo algún saldo quedara en negativo, te diremos qué ajustar.'),
      m.group_id ? notice('info', 'Este movimiento forma parte de un pago con asignación automática: se anularán juntos el pago y la asignación.') : null),
    submitLabel: 'Anular movimiento',
    danger: true,
    successMessage: 'Movimiento anulado',
    build(form) {
      form.append(field({ label: 'Motivo', control: reason, name: 'reason', optional: true }));
    },
    async onSubmit(ctx) {
      const text = reason.value.trim();
      if (text.length > REASON_MAX) { ctx.fieldError('reason', `Usa como máximo ${REASON_MAX} caracteres.`); return false; }
      const payload = { id: movementId };
      if (text) payload.reason = text;
      await app.mutate('void_movement', payload, ctx.opId);
      return true;
    },
    onError: ledgerHandler(app),
  });
}

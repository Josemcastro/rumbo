// Formularios de dinero: aportación (asignar / ahorro nuevo), liberar, mover entre objetivos,
// pago (con cobertura del faltante), añadir ahorro y registrar salida.
// Todos muestran el efecto antes de confirmar y se recalculan si cambia el estado.

import {
  h, icon, formSheet, field, amountInput, dateInput, selectInput, textArea, segmented, checkbox, button,
} from '../ui.js';
import { formatCents, parseAmount, todayISO, isValidISODate, centsToInput } from '../format.js';
import { attributionOptions } from '../labels.js';

export const NOTE_MAX = 300;

// ---------- Piezas comunes ----------

function moneyFields(app, { attribution = true, amountLabel = 'Importe', amountHint = null } = {}) {
  const amount = amountInput({ dataset: { role: 'amount' } });
  const date = dateInput({ value: todayISO() });
  const attr = attribution ? selectInput(attributionOptions(app.names()), 'joint') : null;
  const note = textArea({ maxlength: NOTE_MAX, rows: 2 });
  const amountField = field({ label: amountLabel, control: amount, name: 'amount_cents', hint: amountHint });
  return {
    amount, date, attr, note, amountField,
    nodes: () => [
      amountField,
      field({ label: 'Fecha', control: date, name: 'date' }),
      attr ? field({ label: '¿De quién es?', control: attr, name: 'attribution', hint: 'Solo informativo: ayuda a ver quién aporta qué.' }) : null,
      field({ label: 'Nota', control: note, name: 'note', optional: true }),
    ],
    /** Céntimos escritos ahora (o null). */
    cents: () => parseAmount(amount.value),
    /** Valida y devuelve la parte común del payload, o null si hay errores (ya mostrados). */
    read(ctx) {
      let ok = true;
      const cents = parseAmount(amount.value);
      if (cents === null) { ctx.fieldError('amount_cents', 'Escribe un importe mayor que cero, por ejemplo 1.250,50.'); ok = false; }
      if (!isValidISODate(date.value)) { ctx.fieldError('date', 'Elige una fecha válida.'); ok = false; }
      const noteText = note.value.trim();
      if (noteText.length > NOTE_MAX) { ctx.fieldError('note', `Usa como máximo ${NOTE_MAX} caracteres.`); ok = false; }
      if (!ok) return null;
      const payload = { amount_cents: cents, date: date.value };
      if (attr && attr.value) payload.attribution = attr.value;
      if (noteText) payload.note = noteText;
      return payload;
    },
  };
}

function previewBox() {
  return h('div', { class: 'preview', 'aria-live': 'polite' });
}

function line(label, from, to) {
  return h('p', { class: 'preview-line' },
    h('span', { class: 'preview-label' }, label),
    h('span', { class: 'preview-values' }, formatCents(from), h('span', { class: 'preview-arrow', 'aria-label': 'pasa a' }, ' → '), h('strong', null, formatCents(to))));
}

function problem(text) {
  return h('p', { class: 'preview-problem' }, icon('alert'), h('span', null, text));
}

function onInput(els, fn) {
  for (const el of els) {
    if (!el) continue;
    el.addEventListener('input', fn);
    el.addEventListener('change', fn);
  }
}

function goalOf(app, goalId) {
  return app.goal(goalId);
}

function reservedOf(goal) {
  return (goal && goal.computed && goal.computed.reserved_cents) || 0;
}

function ledgerErrorHandler(app) {
  return (err, ctx) => {
    if (['ledger_conflict', 'insufficient_available', 'insufficient_reserve', 'grouped_movement'].includes(err.code)) {
      ctx.setAlert(err.message);
      app.refresh().catch(() => {});
      return true;
    }
    return false;
  };
}

// ---------- Añadir aportación ----------

export function openContribution(app, goalId) {
  const goal = goalOf(app, goalId);
  if (!goal) return;
  const f = moneyFields(app);
  const preview = previewBox();
  const available = () => app.state.savings.available_cents;
  let mode = available() > 0 ? 'allocate' : 'deposit_to_goal';
  const choice = segmented({
    legend: '¿De dónde sale el dinero?',
    name: 'contrib',
    cards: true,
    fieldName: 'kind',
    value: mode,
    options: [
      { value: 'allocate', label: 'Asignar de nuestros ahorros', description: '' },
      { value: 'deposit_to_goal', label: 'Registrar ahorro nuevo', description: 'Dinero que entra ahora y se reserva directamente para este objetivo.' },
    ],
    onChange: (v) => { mode = v; update(); },
  });

  let ctxRef = null;
  function update() {
    const g = goalOf(app, goalId);
    if (!g || !ctxRef) return;
    const avail = available();
    choice.item('allocate').setDescription(`Disponible: ${formatCents(avail)}`);
    const x = f.cents() || 0;
    const reserved = reservedOf(g);
    const nodes = [];
    let blocked = false;
    if (mode === 'allocate') {
      nodes.push(line('Disponible', avail, avail - x));
      nodes.push(line(`Reservado en «${g.name}»`, reserved, reserved + x));
      if (x > avail) {
        blocked = true;
        nodes.push(problem(avail > 0
          ? `Solo hay ${formatCents(avail)} disponibles. Elige «Registrar ahorro nuevo» o libera dinero de otro objetivo.`
          : 'No hay dinero disponible. Elige «Registrar ahorro nuevo» o libera dinero de otro objetivo.'));
      }
    } else {
      const total = app.state.savings.total_cents;
      nodes.push(line('Ahorros totales', total, total + x));
      nodes.push(line(`Reservado en «${g.name}»`, reserved, reserved + x));
    }
    preview.replaceChildren(...(x > 0 ? nodes : [h('p', { class: 'muted small' }, 'Escribe el importe para ver el efecto.')]));
    ctxRef.setBlocked(blocked);
  }

  formSheet(app, {
    initialFocus: f.amount,
    title: `Añadir aportación a «${goal.name}»`,
    submitLabel: 'Añadir aportación',
    successMessage: 'Aportación registrada',
    build(form, ctx) {
      ctxRef = ctx;
      form.append(choice, ...f.nodes().filter(Boolean), preview);
      onInput([f.amount], update);
      ctx.watch(update);
      update();
    },
    async onSubmit(ctx) {
      const payload = f.read(ctx);
      if (!payload) return false;
      await app.mutate('add_movement', { kind: mode, goal_id: goalId, ...payload }, ctx.opId);
      return true;
    },
    onError: ledgerErrorHandler(app),
  });
}

// ---------- Liberar reserva ----------

export function openRelease(app, goalId) {
  const goal = goalOf(app, goalId);
  if (!goal) return;
  const f = moneyFields(app, { attribution: false, amountLabel: 'Importe a liberar' });
  const preview = previewBox();
  const allBtn = button('Todo', () => { f.amount.value = centsToInput(reservedOf(goalOf(app, goalId))); update(); }, { small: true, variant: 'plain' });
  let ctxRef = null;

  function update() {
    const g = goalOf(app, goalId);
    if (!g || !ctxRef) return;
    const reserved = reservedOf(g);
    const avail = app.state.savings.available_cents;
    f.amountField.setHint(`Reservado ahora: ${formatCents(reserved)}`);
    const x = f.cents() || 0;
    const nodes = [line(`Reservado en «${g.name}»`, reserved, reserved - x), line('Disponible', avail, avail + x)];
    let blocked = false;
    if (x > reserved) {
      blocked = true;
      nodes.push(problem(`Solo hay ${formatCents(reserved)} reservados en este objetivo.`));
    }
    preview.replaceChildren(...(x > 0 ? nodes : [h('p', { class: 'muted small' }, 'El dinero liberado vuelve a «Disponible para asignar».')]));
    ctxRef.setBlocked(blocked);
  }

  formSheet(app, {
    initialFocus: f.amount,
    title: `Liberar reserva de «${goal.name}»`,
    submitLabel: 'Liberar',
    successMessage: 'Reserva liberada',
    build(form, ctx) {
      ctxRef = ctx;
      const nodes = f.nodes().filter(Boolean);
      nodes[0].append(allBtn);
      form.append(...nodes, preview);
      onInput([f.amount], update);
      ctx.watch(update);
      update();
    },
    async onSubmit(ctx) {
      const payload = f.read(ctx);
      if (!payload) return false;
      await app.mutate('add_movement', { kind: 'release', goal_id: goalId, ...payload }, ctx.opId);
      return true;
    },
    onError: ledgerErrorHandler(app),
  });
}

// ---------- Mover a otro objetivo ----------

export function openTransfer(app, goalId) {
  const goal = goalOf(app, goalId);
  if (!goal) return;
  const f = moneyFields(app, { attribution: false, amountLabel: 'Importe a mover' });
  const preview = previewBox();
  const dest = selectInput([], '');
  const destField = field({ label: 'Mover a', control: dest, name: 'to_goal_id' });
  let ctxRef = null;

  function fillDest() {
    const prev = dest.value;
    const options = app.state.goals
      .filter((g) => g.id !== goalId && g.status !== 'archived')
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    dest.replaceChildren(h('option', { value: '' }, 'Elige un objetivo…'),
      ...options.map((g) => h('option', { value: String(g.id), selected: String(g.id) === prev },
        g.status === 'active' ? g.name : `${g.name} (${g.status === 'paused' ? 'en pausa' : 'cumplido'})`)));
  }

  function update() {
    const g = goalOf(app, goalId);
    if (!g || !ctxRef) return;
    const reserved = reservedOf(g);
    f.amountField.setHint(`Reservado ahora en «${g.name}»: ${formatCents(reserved)}`);
    const x = f.cents() || 0;
    const to = dest.value ? goalOf(app, Number(dest.value)) : null;
    const nodes = [line(`Reservado en «${g.name}»`, reserved, reserved - x)];
    if (to) nodes.push(line(`Reservado en «${to.name}»`, reservedOf(to), reservedOf(to) + x));
    let blocked = false;
    if (x > reserved) {
      blocked = true;
      nodes.push(problem(`Solo hay ${formatCents(reserved)} reservados en este objetivo.`));
    }
    preview.replaceChildren(...(x > 0 ? nodes : [h('p', { class: 'muted small' }, 'El dinero pasa de la reserva de un objetivo a la de otro; los ahorros totales no cambian.')]));
    ctxRef.setBlocked(blocked);
  }

  formSheet(app, {
    title: `Mover dinero desde «${goal.name}»`,
    submitLabel: 'Mover',
    successMessage: 'Dinero movido',
    build(form, ctx) {
      ctxRef = ctx;
      fillDest();
      form.append(destField, ...f.nodes().filter(Boolean), preview);
      onInput([f.amount, dest], update);
      ctx.watch(() => { fillDest(); update(); });
      update();
    },
    async onSubmit(ctx) {
      const payload = f.read(ctx);
      let ok = !!payload;
      if (!dest.value) { ctx.fieldError('to_goal_id', 'Elige el objetivo al que mover el dinero.'); ok = false; }
      if (!ok) return false;
      await app.mutate('add_movement', { kind: 'transfer', goal_id: goalId, to_goal_id: Number(dest.value), ...payload }, ctx.opId);
      return true;
    },
    onError: ledgerErrorHandler(app),
  });
}

// ---------- Registrar pago ----------

export function openPayment(app, goalId) {
  const goal = goalOf(app, goalId);
  if (!goal) return;
  const f = moneyFields(app, { attribution: false, amountLabel: 'Importe pagado' });
  const preview = previewBox();
  const cover = checkbox({ label: '', name: 'cover_shortfall' });
  const coverInput = cover.querySelector('input');
  const coverLabel = cover.querySelector('label');
  cover.hidden = true;
  let ctxRef = null;

  function update() {
    const g = goalOf(app, goalId);
    if (!g || !ctxRef) return;
    const reserved = reservedOf(g);
    const avail = app.state.savings.available_cents;
    const total = app.state.savings.total_cents;
    f.amountField.setHint(`Reservado ahora: ${formatCents(reserved)}`);
    const x = f.cents() || 0;
    const shortfall = Math.max(0, x - reserved);
    const nodes = [];
    let blocked = false;
    cover.hidden = true;
    if (x > 0) {
      if (shortfall > 0 && shortfall > avail) {
        blocked = true;
        nodes.push(problem(`Faltan ${formatCents(shortfall)} reservados y solo hay ${formatCents(avail)} disponibles. Registra antes un ahorro o libera dinero de otro objetivo.`));
      } else if (shortfall > 0) {
        cover.hidden = false;
        coverLabel.textContent = `Faltan ${formatCents(shortfall)} reservados; se asignarán ${formatCents(shortfall)} del disponible.`;
        nodes.push(line('Disponible', avail, avail - shortfall));
        nodes.push(line(`Reservado en «${g.name}»`, reserved, 0));
        blocked = !coverInput.checked;
      } else {
        nodes.push(line(`Reservado en «${g.name}»`, reserved, reserved - x));
      }
      if (!(shortfall > avail)) nodes.push(line('Ahorros totales', total, total - x));
    } else {
      nodes.push(h('p', { class: 'muted small' }, 'Un pago sale de la reserva del objetivo y de vuestros ahorros totales.'));
    }
    preview.replaceChildren(...nodes);
    ctxRef.setBlocked(blocked);
  }

  formSheet(app, {
    initialFocus: f.amount,
    title: `Registrar pago de «${goal.name}»`,
    submitLabel: 'Registrar pago',
    successMessage: 'Pago registrado',
    build(form, ctx) {
      ctxRef = ctx;
      form.append(...f.nodes().filter(Boolean), preview, cover);
      onInput([f.amount, coverInput], update);
      ctx.watch(update);
      update();
    },
    async onSubmit(ctx) {
      const payload = f.read(ctx);
      if (!payload) return false;
      const g = goalOf(app, goalId);
      const shortfall = Math.max(0, payload.amount_cents - reservedOf(g));
      if (shortfall > 0) {
        if (!coverInput.checked) { ctx.fieldError('cover_shortfall', 'Confirma que se asigne lo que falta del disponible.'); return false; }
        payload.cover_shortfall = true;
      }
      await app.mutate('add_movement', { kind: 'payment', goal_id: goalId, ...payload }, ctx.opId);
      return true;
    },
    onError(err, ctx) {
      if (err.code === 'insufficient_reserve') {
        const d = err.details || {};
        const parts = [err.message];
        if (Number.isFinite(d.shortfall_cents)) parts.push(`Faltan ${formatCents(d.shortfall_cents)} reservados.`);
        if (Number.isFinite(d.available_cents)) parts.push(`Disponible: ${formatCents(d.available_cents)}.`);
        ctx.setAlert(parts.join(' '));
        app.refresh().catch(() => {});
        return true;
      }
      return ledgerErrorHandler(app)(err, ctx);
    },
  });
}

// ---------- Añadir ahorro / ahorros iniciales ----------

export function openDeposit(app, { initial = false } = {}) {
  const f = moneyFields(app, { amountLabel: initial ? '¿Cuánto tenéis ahorrado hoy?' : 'Importe' });
  const preview = previewBox();
  let ctxRef = null;

  function update() {
    if (!ctxRef || !app.state) return;
    const x = f.cents() || 0;
    const { total_cents: total, available_cents: avail } = app.state.savings;
    preview.replaceChildren(...(x > 0
      ? [line('Ahorros totales', total, total + x), line('Disponible', avail, avail + x)]
      : [h('p', { class: 'muted small' }, initial
        ? 'Registradlo una vez con la suma de lo que ya tenéis. Después podréis reservar parte para cada objetivo.'
        : 'El ahorro nuevo queda disponible para asignarlo a vuestros objetivos.')]));
  }

  formSheet(app, {
    initialFocus: f.amount,
    title: initial ? 'Registrar ahorros iniciales' : 'Añadir ahorro',
    submitLabel: initial ? 'Registrar' : 'Añadir ahorro',
    successMessage: initial ? 'Ahorros iniciales registrados' : 'Ahorro registrado',
    build(form, ctx) {
      ctxRef = ctx;
      form.append(...f.nodes().filter(Boolean), preview);
      onInput([f.amount], update);
      ctx.watch(update);
      update();
    },
    async onSubmit(ctx) {
      const payload = f.read(ctx);
      if (!payload) return false;
      const body = { kind: 'deposit', ...payload };
      if (initial) body.is_initial = true;
      await app.mutate('add_movement', body, ctx.opId);
      return true;
    },
    onError: ledgerErrorHandler(app),
  });
}

// ---------- Registrar salida general ----------

export function openWithdrawal(app) {
  const f = moneyFields(app, { amountLabel: 'Importe que sale' });
  const preview = previewBox();
  let ctxRef = null;

  function update() {
    if (!ctxRef || !app.state) return;
    const x = f.cents() || 0;
    const { total_cents: total, available_cents: avail } = app.state.savings;
    f.amountField.setHint(`Disponible ahora: ${formatCents(avail)}`);
    let blocked = false;
    const nodes = [];
    if (x > 0) {
      nodes.push(line('Ahorros totales', total, total - x), line('Disponible', avail, avail - x));
      if (x > avail) {
        blocked = true;
        nodes.push(problem(`Necesitas liberar antes dinero reservado: solo hay ${formatCents(avail)} disponibles.`));
      }
    } else {
      nodes.push(h('p', { class: 'muted small' }, 'Una salida general es dinero que sale de vuestros ahorros sin estar ligado a un objetivo. Nunca toca lo reservado.'));
    }
    preview.replaceChildren(...nodes);
    ctxRef.setBlocked(blocked);
  }

  formSheet(app, {
    initialFocus: f.amount,
    title: 'Registrar salida',
    submitLabel: 'Registrar salida',
    successMessage: 'Salida registrada',
    build(form, ctx) {
      ctxRef = ctx;
      form.append(...f.nodes().filter(Boolean), preview);
      onInput([f.amount], update);
      ctx.watch(update);
      update();
    },
    async onSubmit(ctx) {
      const payload = f.read(ctx);
      if (!payload) return false;
      await app.mutate('add_movement', { kind: 'withdrawal', ...payload }, ctx.opId);
      return true;
    },
    onError(err, ctx) {
      if (err.code === 'insufficient_available') {
        const d = err.details || {};
        ctx.setAlert(Number.isFinite(d.available_cents) ? `${err.message} Disponible: ${formatCents(d.available_cents)}.` : err.message);
        app.refresh().catch(() => {});
        return true;
      }
      return ledgerErrorHandler(app)(err, ctx);
    },
  });
}

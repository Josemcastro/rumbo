// Formularios de objetivos: nuevo, editar, desglose del presupuesto, mover de pestaña,
// cambios de estado (pausar, cumplir, archivar, reabrir) y eliminar.

import {
  h, icon, iconButton, button, formSheet, confirmSheet, field, textInput, textArea, amountInput, dateInput,
  selectInput, segmented, disclosure, notice, conflictFieldNames, nextId,
} from '../ui.js';
import { newOpId } from '../api.js';
import { formatCents, parseAmount, centsToInput, isValidISODate, plural } from '../format.js';
import { PRIORITY_LABELS, flag } from '../labels.js';
import { createTab, tabNameError, TAB_NAME_MAX } from './tabs.js';
import { TASK_TITLE_MAX } from './tasks.js';

export const GOAL_NAME_MAX = 80;
export const GOAL_DESC_MAX = 200;
export const GOAL_NOTES_MAX = 2000;
export const BUDGET_LABEL_MAX = 80;
const NEW_TAB = '__new__';

// ---------- Piezas ----------

function beneficiaryControl(app, value) {
  const names = app.names();
  return segmented({
    legend: 'Para quién',
    name: 'beneficiary',
    fieldName: 'beneficiary',
    value,
    options: [
      { value: 'both', label: 'Ambos' },
      { value: 'a', label: names.a },
      { value: 'b', label: names.b },
    ],
  });
}

function priorityControl(value) {
  return selectInput(['high', 'medium', 'low'].map((p) => ({ value: p, label: PRIORITY_LABELS[p] })), value);
}

function tabOptions(app) {
  return app.sortedTabs().map((t) => ({ value: String(t.id), label: t.name }));
}

/**
 * Selector de pestaña con opción «Nueva pestaña…» que la crea sin cerrar el formulario.
 */
function tabPicker(app, ctx, selectedId, { allowNew }) {
  const select = h('select');
  const newInput = textInput({ maxlength: TAB_NAME_MAX, placeholder: 'Nombre de la pestaña' });
  const newErr = h('p', { class: 'field-error', hidden: true });
  const newBtn = button('Crear pestaña', null, { small: true, variant: 'secondary' });
  newInput.id = nextId('newtab');
  const newRow = h('div', { class: 'new-tab-row', hidden: true },
    h('label', { class: 'visually-hidden', for: newInput.id }, 'Nombre de la nueva pestaña'),
    h('div', { class: 'task-add-row' }, newInput, newBtn), newErr);
  let opId = newOpId();
  // Nombre que viajó con `opId` en un envío fallido por red: el op_id solo se reutiliza con ese nombre.
  let retryName = null;
  let creating = false;

  function fill(value) {
    const options = tabOptions(app);
    if (allowNew) options.push({ value: NEW_TAB, label: 'Nueva pestaña…' });
    const wanted = value ?? select.value;
    const exists = options.some((o) => o.value === String(wanted));
    selectInputFill(select, options, exists ? String(wanted) : (options[0] ? options[0].value : ''));
    newRow.hidden = select.value !== NEW_TAB;
  }

  function showErr(message) {
    newErr.replaceChildren(icon('alert'), document.createTextNode(message));
    newErr.hidden = false;
    newInput.setAttribute('aria-invalid', 'true');
  }

  async function createNew() {
    if (creating) return;
    newErr.hidden = true;
    newInput.removeAttribute('aria-invalid');
    const problem = tabNameError(app, newInput.value);
    if (problem) { showErr(problem); newInput.focus(); return; }
    const sentName = newInput.value.trim();
    if (retryName !== null && retryName !== sentName) { opId = newOpId(); retryName = null; }
    creating = true;
    newBtn.disabled = true;
    newInput.readOnly = true;
    try {
      const id = await createTab(app, newInput.value, opId);
      opId = newOpId();
      retryName = null;
      newInput.value = '';
      fill(id !== null ? String(id) : null);
      select.focus();
      app.toast('Pestaña creada');
    } catch (err) {
      if (err && err.retryable) retryName = sentName; else { opId = newOpId(); retryName = null; }
      if (err && err.code === 'unauthorized') { app.invalidate(); return; }
      showErr(err && err.fields && err.fields.name ? err.fields.name : (err && err.message) || 'No se ha podido crear la pestaña.');
    } finally {
      creating = false;
      newBtn.disabled = false;
      newInput.readOnly = false;
    }
  }

  select.addEventListener('change', () => {
    newRow.hidden = select.value !== NEW_TAB;
    if (!newRow.hidden) newInput.focus();
  });
  newBtn.addEventListener('click', createNew);
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createNew(); }
  });

  fill(selectedId != null ? String(selectedId) : null);
  ctx.watch(() => fill());
  const wrap = field({ label: 'Pestaña', control: select, name: 'tab_id' });
  wrap.append(newRow);
  return { wrap, value: () => (select.value && select.value !== NEW_TAB ? Number(select.value) : null), select };
}

function selectInputFill(select, options, value) {
  select.replaceChildren(...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  select.value = value;
}

/** Editor de partidas del presupuesto (concepto + importe). */
function budgetEditor(initial, { onChange }) {
  const rowsEl = h('div', { class: 'budget-rows' });
  const errEl = h('p', { class: 'field-error', hidden: true });
  const addBtn = button('Añadir partida', () => { addRow(); onChange(); focusLast(); }, { small: true, variant: 'plain', iconName: 'plus' });
  const wrap = h('fieldset', { class: 'field budget-editor', dataset: { field: 'budget_items' } },
    h('legend', { class: 'field-label' }, 'Desglose del presupuesto'),
    h('p', { class: 'field-hint' }, 'Opcional. Si añades partidas, la meta será su suma.'),
    rowsEl, addBtn, errEl);

  function addRow(item = { label: '', amount_cents: null }) {
    const n = rowsEl.children.length + 1;
    const label = textInput({ maxlength: BUDGET_LABEL_MAX, value: item.label || '', placeholder: 'Concepto', 'aria-label': `Concepto de la partida ${n}` });
    const amount = amountInput({ value: item.amount_cents ? centsToInput(item.amount_cents) : '', 'aria-label': `Importe de la partida ${n}` });
    const row = h('div', { class: 'budget-row' }, label, amount);
    row.append(iconButton('trash', `Quitar la partida ${n}`, () => {
      row.remove();
      onChange();
      addBtn.focus();
    }));
    label.addEventListener('input', onChange);
    amount.addEventListener('input', onChange);
    rowsEl.append(row);
  }
  function focusLast() {
    const last = rowsEl.lastElementChild;
    if (last) last.querySelector('input').focus();
  }
  for (const item of initial) addRow(item);

  return {
    el: wrap,
    count: () => rowsEl.children.length,
    /** Suma de los importes válidos escritos. */
    sum: () => [...rowsEl.children].reduce((acc, row) => acc + (parseAmount(row.querySelectorAll('input')[1].value) || 0), 0),
    /** Lee las partidas; devuelve null y marca el error si alguna no es válida. Ignora filas vacías. */
    read() {
      errEl.hidden = true;
      const items = [];
      let problem = null;
      [...rowsEl.children].forEach((row, i) => {
        const [labelEl, amountEl] = row.querySelectorAll('input');
        labelEl.removeAttribute('aria-invalid');
        amountEl.removeAttribute('aria-invalid');
        const label = labelEl.value.trim();
        const raw = amountEl.value.trim();
        if (!label && !raw) return;
        const cents = parseAmount(raw);
        if (!label) { labelEl.setAttribute('aria-invalid', 'true'); problem = problem || `Escribe el concepto de la partida ${i + 1}.`; }
        if (label.length > BUDGET_LABEL_MAX) { labelEl.setAttribute('aria-invalid', 'true'); problem = problem || `El concepto de la partida ${i + 1} es demasiado largo.`; }
        if (cents === null) { amountEl.setAttribute('aria-invalid', 'true'); problem = problem || `Escribe un importe mayor que cero en la partida ${i + 1}.`; }
        items.push({ label, amount_cents: cents });
      });
      if (problem) {
        errEl.replaceChildren(icon('alert'), document.createTextNode(problem));
        errEl.hidden = false;
        return null;
      }
      return items;
    },
  };
}

function readText(input, max, name, ctx, label) {
  const value = input.value.trim();
  if (value.length > max) { ctx.fieldError(name, `${label}: usa como máximo ${max} caracteres.`); return null; }
  return value;
}

// ---------- Nuevo objetivo ----------

export function openGoalCreate(app, { tabId = null } = {}) {
  const name = textInput({ maxlength: GOAL_NAME_MAX, placeholder: 'Por ejemplo: Entrada del piso' });
  const target = amountInput();
  const targetField = field({ label: 'Meta (€)', control: target, name: 'target_cents' });
  const beneficiary = beneficiaryControl(app, 'both');
  const priority = priorityControl('medium');
  const description = textInput({ maxlength: GOAL_DESC_MAX });
  const desired = dateInput();
  const notes = textArea({ maxlength: GOAL_NOTES_MAX, rows: 3 });
  const steps = textArea({ rows: 4, placeholder: 'Pedir presupuesto\nComparar opciones\n…' });
  let budget = null;

  function syncTarget() {
    if (budget && budget.count() > 0) {
      target.readOnly = true;
      target.value = centsToInput(budget.sum());
      targetField.setHint('Es la suma del desglose.');
    } else {
      target.readOnly = false;
      targetField.setHint('');
    }
  }
  budget = budgetEditor([], { onChange: syncTarget });

  let picker;
  formSheet(app, {
    title: 'Nuevo objetivo',
    submitLabel: 'Crear objetivo',
    successMessage: null,
    build(form, ctx) {
      picker = tabPicker(app, ctx, tabId ?? (app.sortedTabs()[0] || {}).id, { allowNew: true });
      form.append(
        field({ label: 'Nombre', control: name, name: 'name' }),
        targetField,
        picker.wrap,
        beneficiary,
        field({ label: 'Prioridad', control: priority, name: 'priority' }),
        disclosure('Más opciones', [
          field({ label: 'Descripción', control: description, name: 'description', optional: true, hint: `Una frase corta (hasta ${GOAL_DESC_MAX} caracteres).` }),
          field({ label: 'Fecha deseada', control: desired, name: 'desired_date', optional: true }),
          field({ label: 'Notas', control: notes, name: 'notes', optional: true }),
          budget.el,
          field({ label: 'Pasos iniciales', control: steps, name: 'tasks', optional: true, hint: 'Un paso por línea. Se añadirán como tareas.' }),
        ]));
    },
    async onSubmit(ctx) {
      let ok = true;
      const payload = {};
      payload.name = name.value.trim();
      if (!payload.name) { ctx.fieldError('name', 'Escribe un nombre para el objetivo.'); ok = false; }
      else if (payload.name.length > GOAL_NAME_MAX) { ctx.fieldError('name', `Usa como máximo ${GOAL_NAME_MAX} caracteres.`); ok = false; }

      const tab = picker.value();
      if (!tab) { ctx.fieldError('tab_id', 'Elige una pestaña o crea una nueva.'); ok = false; }
      payload.tab_id = tab;

      const items = budget.read();
      if (items === null) ok = false;
      if (items && items.length) {
        payload.budget_items = items;
      } else {
        const cents = parseAmount(target.value);
        if (cents === null) { ctx.fieldError('target_cents', 'Escribe la meta, por ejemplo 3.000 (o añade un desglose en «Más opciones»).'); ok = false; }
        payload.target_cents = cents;
      }
      payload.beneficiary = beneficiary.getValue() || 'both';
      payload.priority = priority.value;

      const desc = readText(description, GOAL_DESC_MAX, 'description', ctx, 'Descripción');
      if (desc === null) ok = false; else if (desc) payload.description = desc;
      if (desired.value) {
        if (!isValidISODate(desired.value)) { ctx.fieldError('desired_date', 'Elige una fecha válida.'); ok = false; }
        payload.desired_date = desired.value;
      }
      const notesText = readText(notes, GOAL_NOTES_MAX, 'notes', ctx, 'Notas');
      if (notesText === null) ok = false; else if (notesText) payload.notes = notesText;
      const titles = steps.value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (titles.some((t) => t.length > TASK_TITLE_MAX)) { ctx.fieldError('tasks', `Cada paso puede tener como máximo ${TASK_TITLE_MAX} caracteres.`); ok = false; }
      if (titles.length) payload.tasks = titles.map((title) => ({ title }));
      if (!ok) {
        const wrap = ctx.form.querySelector('.disclosure-wrap');
        if (wrap.querySelector('[aria-invalid="true"], .field-error:not([hidden])')) wrap.open();
        return false;
      }

      const result = await app.mutate('create_goal', payload, ctx.opId);
      const newId = result && (result.goal ? result.goal.id : result.id);
      app.toast('Objetivo creado', Number.isFinite(Number(newId)) && newId !== null && newId !== undefined
        ? { action: { label: 'Ver', onClick: () => app.navigate({ name: 'goal', id: Number(newId) }) } }
        : {});
      return true;
    },
    onError(err, ctx) {
      if (err.code === 'validation' && err.fields) {
        const hidden = ['description', 'desired_date', 'notes', 'budget_items', 'tasks'];
        if (Object.keys(err.fields).some((k) => hidden.includes(k.split(/[.[]/)[0]))) ctx.form.querySelector('.disclosure-wrap').open();
      }
      return false;
    },
  });
}

// ---------- Editar objetivo ----------

const EDIT_FIELDS = ['name', 'description', 'target_cents', 'beneficiary', 'priority', 'desired_date', 'notes', 'tab_id'];

function goalSnapshot(goal) {
  return {
    name: goal.name || '',
    description: goal.description || '',
    target_cents: goal.target_cents ?? null,
    beneficiary: goal.beneficiary || 'both',
    priority: goal.priority || 'medium',
    desired_date: goal.desired_date || null,
    notes: goal.notes || '',
    tab_id: goal.tab_id,
  };
}

function rawValues(goal) {
  const out = {};
  for (const k of EDIT_FIELDS) out[k] = goal[k] === undefined ? null : goal[k];
  return out;
}

export function openGoalEdit(app, goalId) {
  const goal = app.goal(goalId);
  if (!goal) return;
  let base = goalSnapshot(goal);
  let raw = rawValues(goal);
  const hasItems = () => {
    const g = app.goal(goalId);
    return !!(g && g.budget_items && g.budget_items.length);
  };

  const name = textInput({ maxlength: GOAL_NAME_MAX, value: base.name });
  const target = amountInput({ value: hasItems() ? centsToInput(goal.computed.target_cents) : centsToInput(base.target_cents) });
  const targetField = field({ label: 'Meta (€)', control: target, name: 'target_cents' });
  const beneficiary = beneficiaryControl(app, base.beneficiary);
  const priority = priorityControl(base.priority);
  const description = textInput({ maxlength: GOAL_DESC_MAX, value: base.description });
  const desired = dateInput({ value: base.desired_date || '' });
  const notes = textArea({ maxlength: GOAL_NOTES_MAX, rows: 4, value: base.notes });
  const tabSelect = selectInput(tabOptions(app), String(base.tab_id));

  function syncTarget() {
    if (hasItems()) {
      target.readOnly = true;
      target.value = centsToInput((app.goal(goalId) || goal).computed.target_cents);
      targetField.setHint('Es la suma del desglose. Cámbiala con «Editar desglose».');
    } else {
      target.readOnly = false;
      targetField.setHint('');
    }
  }

  formSheet(app, {
    title: 'Editar objetivo',
    build(form, ctx) {
      form.append(
        field({ label: 'Nombre', control: name, name: 'name' }),
        targetField,
        field({ label: 'Pestaña', control: tabSelect, name: 'tab_id' }),
        beneficiary,
        field({ label: 'Prioridad', control: priority, name: 'priority' }),
        field({ label: 'Descripción', control: description, name: 'description', optional: true }),
        field({ label: 'Fecha deseada', control: desired, name: 'desired_date', optional: true }),
        field({ label: 'Notas', control: notes, name: 'notes', optional: true }));
      syncTarget();
      ctx.watch(() => {
        syncTarget();
        const prev = tabSelect.value;
        selectInputFill(tabSelect, tabOptions(app), prev);
      });
    },
    async onSubmit(ctx) {
      let ok = true;
      const values = {
        name: name.value.trim(),
        description: description.value.trim(),
        beneficiary: beneficiary.getValue() || 'both',
        priority: priority.value,
        desired_date: desired.value || null,
        notes: notes.value.trim(),
        tab_id: Number(tabSelect.value),
      };
      if (!values.name) { ctx.fieldError('name', 'Escribe un nombre para el objetivo.'); ok = false; }
      else if (values.name.length > GOAL_NAME_MAX) { ctx.fieldError('name', `Usa como máximo ${GOAL_NAME_MAX} caracteres.`); ok = false; }
      if (values.description.length > GOAL_DESC_MAX) { ctx.fieldError('description', `Usa como máximo ${GOAL_DESC_MAX} caracteres.`); ok = false; }
      if (values.notes.length > GOAL_NOTES_MAX) { ctx.fieldError('notes', `Usa como máximo ${GOAL_NOTES_MAX} caracteres.`); ok = false; }
      if (values.desired_date && !isValidISODate(values.desired_date)) { ctx.fieldError('desired_date', 'Elige una fecha válida.'); ok = false; }
      if (!hasItems()) {
        const cents = parseAmount(target.value);
        if (cents === null) { ctx.fieldError('target_cents', 'Escribe una meta mayor que cero.'); ok = false; }
        values.target_cents = cents;
      }
      if (!ok) return false;

      const changes = {};
      const sentBase = {};
      for (const k of Object.keys(values)) {
        if (values[k] !== base[k]) { changes[k] = values[k]; sentBase[k] = raw[k]; }
      }
      if (!Object.keys(changes).length) return true;
      await app.mutate('update_goal', { id: goalId, changes, base: sentBase }, ctx.opId);
      return true;
    },
    onConflict(err) {
      const fresh = app.goal(goalId) || err.current;
      if (!fresh) return;
      const snap = goalSnapshot(fresh);
      for (const k of conflictFieldNames(err)) {
        if (k === 'name') name.value = snap.name;
        if (k === 'description') description.value = snap.description;
        if (k === 'target_cents' && !hasItems()) target.value = centsToInput(snap.target_cents);
        if (k === 'beneficiary') beneficiary.setValue(snap.beneficiary);
        if (k === 'priority') priority.value = snap.priority;
        if (k === 'desired_date') desired.value = snap.desired_date || '';
        if (k === 'notes') notes.value = snap.notes;
        if (k === 'tab_id') tabSelect.value = String(snap.tab_id);
      }
      base = snap;
      raw = rawValues(fresh);
    },
  });
}

// ---------- Desglose del presupuesto ----------

export function openBudgetForm(app, goalId) {
  const goal = app.goal(goalId);
  if (!goal) return;
  let baseItems = (goal.budget_items || []).map((it) => ({ label: it.label, amount_cents: it.amount_cents }));
  // Meta que veía este dispositivo al abrir: se envía como base para que el
  // servidor detecte si otro dispositivo la cambió mientras tanto (CAS).
  let baseTarget = goal.computed.target_cents;
  const manual = amountInput({ value: centsToInput(goal.computed.target_cents) });
  const manualField = field({ label: 'Meta sin desglose (€)', control: manual, name: 'target_cents', hint: 'Sin partidas, el objetivo usa esta meta.' });
  const total = h('p', { class: 'budget-total', 'aria-live': 'polite' });
  let editor = null;

  function sync() {
    if (!editor) return;
    const count = editor.count();
    manualField.hidden = count > 0;
    total.replaceChildren(count > 0 ? h('span', null, 'Meta (suma): ', h('strong', null, formatCents(editor.sum()))) : '');
  }
  editor = budgetEditor(baseItems.length ? baseItems : [{ label: '', amount_cents: null }], { onChange: sync });

  formSheet(app, {
    title: `Desglose de «${goal.name}»`,
    intro: 'Añade las partidas que forman el presupuesto. La meta del objetivo será la suma. Si quitas todas, volverá a usarse una meta manual.',
    successMessage: 'Desglose guardado',
    build(form) {
      form.append(editor.el, total, manualField);
      sync();
    },
    async onSubmit(ctx) {
      const items = editor.read();
      if (items === null) return false;
      const payload = { goal_id: goalId, items, base_items: baseItems };
      if (!items.length) {
        const cents = parseAmount(manual.value);
        if (cents === null) { ctx.fieldError('target_cents', 'Escribe la meta, que debe ser mayor que cero.'); return false; }
        payload.target_cents = cents;
        payload.base_target_cents = baseTarget;
      }
      await app.mutate('set_budget', payload, ctx.opId);
      return true;
    },
    onConflict() {
      const fresh = app.goal(goalId);
      if (fresh) {
        baseItems = (fresh.budget_items || []).map((it) => ({ label: it.label, amount_cents: it.amount_cents }));
        baseTarget = fresh.computed.target_cents;
        manual.value = centsToInput(fresh.computed.target_cents);
      }
    },
  });
}

// ---------- Mover a otra pestaña ----------

export function openMoveTab(app, goalId) {
  const goal = app.goal(goalId);
  if (!goal) return;
  let base = goal.tab_id;
  const select = selectInput(tabOptions(app), String(goal.tab_id));
  formSheet(app, {
    title: `Mover «${goal.name}»`,
    submitLabel: 'Mover',
    successMessage: 'Objetivo movido',
    build(form) { form.append(field({ label: 'Pestaña', control: select, name: 'tab_id' })); },
    async onSubmit(ctx) {
      const tabId = Number(select.value);
      if (tabId === base) return true;
      await app.mutate('update_goal', { id: goalId, changes: { tab_id: tabId }, base: { tab_id: base } }, ctx.opId);
      return true;
    },
    onConflict() { const g = app.goal(goalId); if (g) base = g.tab_id; },
  });
}

// ---------- Estado: pausar / reactivar / reabrir ----------

const STATUS_MESSAGES = {
  paused: 'Objetivo en pausa',
  active: 'Objetivo reactivado',
};

export function setGoalStatus(app, goalId, status) {
  const goal = app.goal(goalId);
  if (!goal) return;
  const reopened = status === 'active' && (goal.status === 'done' || goal.status === 'archived');
  app.run('update_goal', { id: goalId, changes: { status }, base: { status: goal.status } },
    { success: reopened ? 'Objetivo reabierto' : STATUS_MESSAGES[status] || 'Guardado' });
}

// ---------- Estado: cumplido / archivado (con elección sobre la reserva) ----------

export function openStatusChange(app, goalId, target) {
  const goal = app.goal(goalId);
  if (!goal) return;
  let baseStatus = goal.status;
  const c = goal.computed || {};
  const reserved = c.reserved_cents || 0;
  const isDone = target === 'done';

  const warnings = [];
  if (isDone) {
    if (c.pending_cents > 0) warnings.push(`Aún faltan ${formatCents(c.pending_cents)} para llegar a la meta.`);
    const pendingTasks = (c.tasks_total || 0) - (c.tasks_done || 0);
    if (pendingTasks > 0) warnings.push(`${plural(pendingTasks, 'tarea sigue', 'tareas siguen')} sin completar.`);
  }

  const reserveChoice = reserved > 0 ? segmented({
    legend: `¿Qué hacemos con los ${formatCents(reserved)} reservados?`,
    name: 'reserve',
    cards: true,
    value: 'keep',
    options: [
      { value: 'keep', label: 'Mantener reservado', description: 'Siguen apartados para este objetivo (por ejemplo, para pagos pendientes).' },
      { value: 'release', label: 'Devolver al disponible', description: 'Vuelven a «Disponible para asignar» para usarlos en otros objetivos.' },
    ],
  }) : null;

  const intro = [];
  if (isDone) {
    intro.push(h('p', null, `«${goal.name}» pasará a Cumplidos. Podréis reabrirlo cuando queráis.`));
    if (warnings.length) intro.push(notice('warning', h('p', null, h('strong', null, 'Antes de marcarlo: ')), ...warnings.map((w) => h('p', null, w))));
  } else {
    intro.push(h('p', null, `«${goal.name}» dejará de aparecer entre los activos. Su historial se conserva y podréis reabrirlo cuando queráis.`));
  }

  formSheet(app, {
    title: isDone ? 'Marcar como cumplido' : 'Archivar objetivo',
    intro: h('div', { class: 'sheet-intro' }, intro),
    submitLabel: isDone ? (warnings.length ? 'Marcar igualmente' : 'Marcar como cumplido') : 'Archivar',
    successMessage: isDone ? 'Objetivo cumplido' : 'Objetivo archivado',
    build(form) { if (reserveChoice) form.append(reserveChoice); },
    async onSubmit(ctx) {
      const payload = { id: goalId, changes: { status: target }, base: { status: baseStatus } };
      if (reserveChoice) payload.release_reserve = reserveChoice.getValue() === 'release';
      await app.mutate('update_goal', payload, ctx.opId);
      return true;
    },
    onConflict() { const g = app.goal(goalId); if (g) baseStatus = g.status; },
    onError(err, ctx) {
      if (err.code === 'ledger_conflict' || err.code === 'insufficient_reserve') {
        ctx.setAlert(err.message);
        app.refresh().catch(() => {});
        return true;
      }
      return false;
    },
  });
}

// ---------- Eliminar ----------

export function openDeleteGoal(app, goalId) {
  const goal = app.goal(goalId);
  if (!goal) return;
  const c = goal.computed || {};
  if (flag(c.has_movements)) {
    const archived = goal.status === 'archived';
    confirmSheet(app, {
      title: 'No se puede eliminar',
      message: [
        `«${goal.name}» tiene movimientos de dinero en el historial, así que no se puede eliminar sin perder ese registro.`,
        archived ? 'Ya está archivado: no aparece entre los activos.' : 'Puedes archivarlo: dejará de aparecer entre los activos y conservaréis el historial.',
      ],
      confirmLabel: archived ? 'Entendido' : 'Archivar en su lugar',
      successMessage: null,
      async onConfirm() {
        if (!archived) setTimeout(() => openStatusChange(app, goalId, 'archived'), 0);
        return true;
      },
    });
    return;
  }
  const tasks = (goal.tasks || []).length;
  const items = (goal.budget_items || []).length;
  const extra = [];
  if (tasks) extra.push(plural(tasks, 'tarea', 'tareas'));
  if (items) extra.push(plural(items, 'partida del desglose', 'partidas del desglose'));
  confirmSheet(app, {
    title: 'Eliminar objetivo',
    message: [
      `Se eliminará «${goal.name}»${extra.length ? ` junto con ${extra.join(' y ')}` : ''}.`,
      'Esta acción no se puede deshacer.',
    ],
    confirmLabel: 'Eliminar',
    danger: true,
    successMessage: 'Objetivo eliminado',
    async onConfirm(ctx) {
      const tabId = goal.tab_id;
      const viewing = app.route.name === 'goal' && app.route.id === goalId;
      await app.mutate('delete_goal', { id: goalId }, ctx.opId);
      if (viewing) {
        const lastTab = app.memory.get('goals-tab');
        app.navigate(lastTab != null && lastTab === tabId && app.tab(tabId) ? { name: 'goals', id: tabId } : { name: 'goals' }, { replace: true });
      }
      return true;
    },
    onError(err, ctx) {
      if (err.code === 'goal_has_movements') {
        ctx.setAlert(err.message, { actions: [{ label: 'Archivar', onClick: () => { ctx.close(); setTimeout(() => openStatusChange(app, goalId, 'archived'), 0); } }] });
        app.refresh().catch(() => {});
        return true;
      }
      return false;
    },
  });
}


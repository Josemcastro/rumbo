// Tareas: alta rápida en línea («Añadir una tarea…» + Enter), edición y eliminación.

import {
  h, icon, button, formSheet, confirmSheet, field, textInput, textArea, dateInput, selectInput, conflictFieldNames,
} from '../ui.js';
import { newOpId } from '../api.js';
import { isValidISODate } from '../format.js';

export const TASK_TITLE_MAX = 120;
export const TASK_NOTE_MAX = 500;

export function findTask(app, taskId) {
  for (const goal of app.state ? app.state.goals : []) {
    const task = (goal.tasks || []).find((t) => t.id === taskId);
    if (task) return { task, goal };
  }
  return { task: null, goal: null };
}

function assigneeOptions(names) {
  return [
    { value: '', label: 'Sin asignar' },
    { value: 'a', label: names.a },
    { value: 'b', label: names.b },
    { value: 'both', label: 'Ambos' },
  ];
}

/** Formulario en línea al final de la lista de tareas. Enter añade la tarea. */
export function createTaskInline(app, goalId, { label }) {
  const opKey = `task-op-${goalId}`;
  const busyKey = `task-busy-${goalId}`;
  const busy = !!app.memory.get(busyKey);
  const inputId = `new-task-${goalId}`;
  const errId = `new-task-err-${goalId}`;
  const input = textInput({
    id: inputId, placeholder: label, maxlength: TASK_TITLE_MAX, readOnly: busy, 'aria-describedby': errId,
    dataset: { persist: `new-task-${goalId}`, fk: `new-task-${goalId}` },
  });
  const btn = button('Añadir', null, { type: 'submit', small: true, disabled: busy, iconName: 'plus', dataset: { fk: `new-task-btn-${goalId}` } });
  const err = h('p', { class: 'field-error', id: errId, hidden: true });
  const form = h('form', { class: 'task-add', novalidate: true, dataset: { taskForm: String(goalId) } },
    h('label', { for: inputId, class: 'visually-hidden' }, 'Nueva tarea'),
    h('div', { class: 'task-add-row' }, input, btn),
    err);

  const current = () => document.querySelector(`[data-task-form="${goalId}"]`);
  function showError(message) {
    const f = current();
    if (!f) return;
    const e = f.querySelector('.field-error');
    e.replaceChildren(icon('alert'), document.createTextNode(message));
    e.hidden = false;
    f.querySelector('input').setAttribute('aria-invalid', 'true');
  }
  function setBusy(value) {
    if (value) app.memory.set(busyKey, true); else app.memory.delete(busyKey);
    const f = current();
    if (!f) return;
    f.querySelector('input').readOnly = value;
    f.querySelector('button').disabled = value;
  }

  async function submit() {
    if (app.memory.get(busyKey)) return;
    const f = current() || form;
    const field = f.querySelector('input');
    const e = f.querySelector('.field-error');
    e.hidden = true;
    field.removeAttribute('aria-invalid');
    const title = field.value.trim();
    if (!title) { showError('Escribe la tarea antes de añadirla.'); return; }
    if (title.length > TASK_TITLE_MAX) { showError(`Usa como máximo ${TASK_TITLE_MAX} caracteres.`); return; }
    // Tras un fallo de red se reutiliza el op_id solo si el título no ha cambiado: si el envío
    // anterior se guardó, el servidor devolvería su respuesta y la tarea nueva no se crearía.
    const pending = app.memory.get(opKey);
    const opId = pending && pending.title === title ? pending.opId : newOpId();
    app.memory.set(opKey, { opId, title });
    setBusy(true);
    try {
      await app.mutate('create_task', { goal_id: goalId, title }, opId);
      app.memory.delete(opKey);
      const now = current();
      if (now) now.querySelector('input').value = '';
    } catch (error) {
      if (!(error && error.retryable)) app.memory.delete(opKey);
      if (error && error.code === 'validation') {
        showError((error.fields && error.fields.title) || error.message);
      } else {
        app.handleError(error, submit);
      }
    } finally {
      setBusy(false);
      const now = current();
      if (now && document.activeElement === document.body) now.querySelector('input').focus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  return form;
}

export function openTaskEdit(app, taskId) {
  const { task } = findTask(app, taskId);
  if (!task) return;
  const names = app.names();
  const snapshot = (t) => ({ title: t.title || '', assignee: t.assignee || null, due_date: t.due_date || null, note: t.note || '' });
  let base = snapshot(task);
  const rawBase = { title: task.title, assignee: task.assignee ?? null, due_date: task.due_date ?? null, note: task.note ?? '' };

  const title = textInput({ maxlength: TASK_TITLE_MAX, value: base.title });
  const assignee = selectInput(assigneeOptions(names), base.assignee || '');
  const due = dateInput({ value: base.due_date || '' });
  const note = textArea({ maxlength: TASK_NOTE_MAX, value: base.note });

  formSheet(app, {
    title: 'Editar tarea',
    initialFocus: title,
    build(form) {
      form.append(
        field({ label: 'Tarea', control: title, name: 'title' }),
        field({ label: 'Responsable', control: assignee, name: 'assignee', optional: true }),
        field({ label: 'Fecha límite', control: due, name: 'due_date', optional: true }),
        field({ label: 'Nota', control: note, name: 'note', optional: true, hint: `Hasta ${TASK_NOTE_MAX} caracteres.` }));
    },
    async onSubmit(ctx) {
      const values = {
        title: title.value.trim(),
        assignee: assignee.value || null,
        due_date: due.value || null,
        note: note.value.trim(),
      };
      let bad = false;
      if (!values.title) { ctx.fieldError('title', 'Escribe la tarea.'); bad = true; }
      else if (values.title.length > TASK_TITLE_MAX) { ctx.fieldError('title', `Usa como máximo ${TASK_TITLE_MAX} caracteres.`); bad = true; }
      if (values.due_date && !isValidISODate(values.due_date)) { ctx.fieldError('due_date', 'Elige una fecha válida.'); bad = true; }
      if (values.note.length > TASK_NOTE_MAX) { ctx.fieldError('note', `Usa como máximo ${TASK_NOTE_MAX} caracteres.`); bad = true; }
      if (bad) return false;
      const changes = {};
      const sentBase = {};
      for (const k of Object.keys(values)) {
        if (values[k] !== base[k]) { changes[k] = values[k]; sentBase[k] = rawBase[k]; }
      }
      if (!Object.keys(changes).length) return true;
      await app.mutate('update_task', { id: taskId, changes, base: sentBase }, ctx.opId);
      return true;
    },
    onConflict(err) {
      const fresh = (err && err.current) || findTask(app, taskId).task;
      if (!fresh) return;
      const snap = snapshot(fresh);
      for (const name of conflictFieldNames(err)) {
        if (name === 'title') title.value = snap.title;
        if (name === 'assignee') assignee.value = snap.assignee || '';
        if (name === 'due_date') due.value = snap.due_date || '';
        if (name === 'note') note.value = snap.note;
      }
      base = snap;
      Object.assign(rawBase, { title: fresh.title, assignee: fresh.assignee ?? null, due_date: fresh.due_date ?? null, note: fresh.note ?? '' });
    },
  });
}

export function openTaskDelete(app, taskId) {
  const { task } = findTask(app, taskId);
  if (!task) return;
  confirmSheet(app, {
    title: 'Eliminar tarea',
    message: `Se eliminará «${task.title}». Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
    successMessage: 'Tarea eliminada',
    async onConfirm(ctx) {
      await app.mutate('delete_task', { id: taskId }, ctx.opId);
      return true;
    },
  });
}

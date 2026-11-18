// Gestión de pestañas: crear, renombrar, reordenar (subir/bajar) y eliminar.

import {
  h, iconButton, button, openSheet, formSheet, field, textInput, selectInput,
  setFieldError, clearFieldErrors, notice, conflictFieldNames,
} from '../ui.js';
import { newOpId } from '../api.js';
import { plural } from '../format.js';

export const TAB_NAME_MAX = 40;

/** Valida un nombre de pestaña. Devuelve el mensaje de error o null. */
export function tabNameError(app, name, exceptId = null) {
  const value = name.trim();
  if (!value) return 'Escribe un nombre para la pestaña.';
  if (value.length > TAB_NAME_MAX) return `Usa como máximo ${TAB_NAME_MAX} caracteres.`;
  const lower = value.toLocaleLowerCase('es');
  if (app.state.tabs.some((t) => t.id !== exceptId && String(t.name).toLocaleLowerCase('es') === lower)) {
    return 'Ya tenéis una pestaña con ese nombre.';
  }
  return null;
}

/**
 * Crea una pestaña y devuelve su id. Lanza ApiError si falla.
 */
export async function createTab(app, name, opId) {
  const value = name.trim();
  const result = await app.mutate('create_tab', { name: value }, opId);
  const fromResult = result && (result.tab ? result.tab.id : result.id);
  if (Number.isFinite(Number(fromResult)) && fromResult !== null && fromResult !== undefined) return Number(fromResult);
  const lower = value.toLocaleLowerCase('es');
  const found = app.state.tabs.find((t) => String(t.name).toLocaleLowerCase('es') === lower);
  return found ? found.id : null;
}

export function openTabManager(app) {
  let busy = false;
  let createOp = newOpId();
  // Nombre enviado con `createOp` tras un fallo de red: el op_id solo se reutiliza con el mismo nombre.
  let retryName = null;
  const list = h('ul', { class: 'manage-list' });
  const nameInput = textInput({ maxlength: TAB_NAME_MAX, placeholder: 'Por ejemplo: Mascotas', dataset: { fk: 'new-tab-name' } });
  const addBtn = button('Añadir', null, { variant: 'primary', type: 'submit' });
  const createForm = h('form', { class: 'inline-form', novalidate: true },
    field({ label: 'Nueva pestaña', control: nameInput, name: 'name' }),
    addBtn);

  function rebuild() {
    if (!app.state) return;
    const active = document.activeElement;
    const fk = active && list.contains(active) ? active.dataset.fk : null;
    const tabs = app.sortedTabs();
    list.replaceChildren(...tabs.map((tab, i) => h('li', { class: 'manage-item' },
      h('div', { class: 'manage-main' },
        h('span', { class: 'manage-name' }, tab.name),
        h('span', { class: 'muted small' }, plural(tab.goal_count || 0, 'objetivo', 'objetivos'))),
      h('div', { class: 'manage-actions' },
        iconButton('arrowUp', `Subir «${tab.name}»`, () => move(tabs, i, -1), { disabled: busy || i === 0, dataset: { fk: `up-${tab.id}` } }),
        iconButton('arrowDown', `Bajar «${tab.name}»`, () => move(tabs, i, 1), { disabled: busy || i === tabs.length - 1, dataset: { fk: `down-${tab.id}` } }),
        iconButton('pencil', `Renombrar «${tab.name}»`, () => openRenameTab(app, tab.id), { disabled: busy, dataset: { fk: `ren-${tab.id}` } }),
        iconButton('trash', `Eliminar «${tab.name}»`, () => openDeleteTab(app, tab.id), { disabled: busy, dataset: { fk: `del-${tab.id}` } })))));
    if (!tabs.length) list.append(h('li', { class: 'muted' }, 'No hay pestañas personalizadas.'));
    if (fk) {
      let el = list.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (el && el.disabled) el = list.querySelector('button:not([disabled])');
      if (el) el.focus();
    }
  }

  async function move(tabs, index, dir) {
    if (busy) return;
    const order = tabs.map((t) => t.id);
    const j = index + dir;
    [order[index], order[j]] = [order[j], order[index]];
    busy = true;
    rebuild();
    await app.run('reorder_tabs', { order }, { success: null });
    busy = false;
    rebuild();
  }

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearFieldErrors(createForm);
    const problem = tabNameError(app, nameInput.value);
    if (problem) { setFieldError(createForm, 'name', problem); nameInput.focus(); return; }
    const sentName = nameInput.value.trim();
    if (retryName !== null && retryName !== sentName) { createOp = newOpId(); retryName = null; }
    busy = true;
    addBtn.disabled = true;
    nameInput.readOnly = true;
    rebuild();
    try {
      await createTab(app, nameInput.value, createOp);
      createOp = newOpId();
      retryName = null;
      nameInput.value = '';
      app.toast('Pestaña creada');
    } catch (err) {
      if (err && err.code === 'validation' && err.fields) {
        createOp = newOpId();
        setFieldError(createForm, 'name', err.fields.name || err.message);
      } else if (err && err.code === 'unauthorized') {
        app.invalidate();
        return;
      } else {
        if (err && err.retryable) retryName = sentName; else { createOp = newOpId(); retryName = null; }
        setFieldError(createForm, 'name', err && err.message ? err.message : 'No se ha podido crear la pestaña.');
      }
    } finally {
      busy = false;
      addBtn.disabled = false;
      nameInput.readOnly = false;
      rebuild();
      nameInput.focus();
    }
  });

  // «Nuevo objetivo» vive aquí (y dentro de cada pestaña), no en el Resumen.
  // goal.js ya importa este módulo: se carga bajo demanda para evitar un ciclo.
  const newGoalBtn = button('Nuevo objetivo', async () => {
    const { openGoalCreate } = await import('./goal.js');
    sheet.close();
    openGoalCreate(app, { tabId: null });
  }, { variant: 'primary', iconName: 'plus', extraClass: 'btn-block', dataset: { fk: 'manage-new-goal' } });

  const sheet = openSheet({
    title: 'Gestionar',
    content: [
      h('div', { class: 'manage-block' },
        h('h3', { class: 'subsection-title' }, 'Objetivos'),
        h('p', { class: 'sheet-intro' }, 'Cread un objetivo y elegid en qué pestaña aparece.'),
        newGoalBtn),
      h('div', { class: 'manage-block' },
        h('h3', { class: 'subsection-title' }, 'Pestañas'),
        h('p', { class: 'sheet-intro' }, 'Resumen y Ahorros son fijas. El resto podéis crearlas, renombrarlas, ordenarlas o eliminarlas.'),
        list,
        createForm),
    ],
  });
  rebuild();
  const off = app.onState(rebuild);
  sheet.onClose(off);
}

export function openRenameTab(app, tabId) {
  const tab = app.tab(tabId);
  if (!tab) return;
  let base = { name: tab.name };
  const input = textInput({ maxlength: TAB_NAME_MAX, value: tab.name });
  formSheet(app, {
    title: 'Renombrar pestaña',
    initialFocus: input,
    selectOnOpen: true,
    build(form) { form.append(field({ label: 'Nombre', control: input, name: 'name' })); },
    async onSubmit(ctx) {
      const problem = tabNameError(app, input.value, tabId);
      if (problem) { ctx.fieldError('name', problem); return false; }
      const name = input.value.trim();
      if (name === base.name) return true;
      await app.mutate('rename_tab', { id: tabId, changes: { name }, base: { name: base.name } }, ctx.opId);
      return true;
    },
    onConflict(err) {
      const current = (err && err.current) || app.tab(tabId);
      if (current) {
        base = { name: current.name };
        if (conflictFieldNames(err).includes('name')) input.value = current.name;
      }
    },
  });
}

export function openDeleteTab(app, tabId) {
  const tab = app.tab(tabId);
  if (!tab) return;
  const others = () => app.sortedTabs().filter((t) => t.id !== tabId);
  const goalCount = () => app.state.goals.filter((g) => g.tab_id === tabId).length;
  const select = selectInput([], '', {});
  const destField = field({ label: 'Mover sus objetivos a', control: select, name: 'move_to_tab_id' });
  const info = h('div');

  function sync() {
    const count = goalCount();
    const opts = others();
    const prev = select.value;
    select.replaceChildren(h('option', { value: '' }, 'Elige una pestaña…'),
      ...opts.map((t) => h('option', { value: String(t.id), selected: String(t.id) === prev }, t.name)));
    destField.hidden = count === 0;
    info.replaceChildren(count === 0
      ? h('p', null, `La pestaña «${tab.name}» está vacía. Se eliminará sin afectar a ningún objetivo.`)
      : opts.length
        ? notice('info', `La pestaña «${tab.name}» tiene ${plural(count, 'objetivo', 'objetivos')} (de cualquier estado). Para eliminarla, elige a qué pestaña ${count === 1 ? 'moverlo' : 'moverlos'}.`)
        : notice('warning', `La pestaña «${tab.name}» tiene ${plural(count, 'objetivo', 'objetivos')} y no hay otra pestaña a la que moverlos. Crea antes otra pestaña.`));
  }

  formSheet(app, {
    title: 'Eliminar pestaña',
    submitLabel: 'Eliminar pestaña',
    danger: true,
    successMessage: 'Pestaña eliminada',
    build(form, ctx) {
      form.append(info, destField);
      sync();
      ctx.watch(() => { if (app.tab(tabId)) sync(); });
    },
    async onSubmit(ctx) {
      const count = goalCount();
      const payload = { id: tabId };
      if (count > 0) {
        if (!select.value) { ctx.fieldError('move_to_tab_id', 'Elige la pestaña a la que mover los objetivos.'); return false; }
        payload.move_to_tab_id = Number(select.value);
      }
      const viewing = app.route.name === 'tab' && app.route.id === tabId;
      await app.mutate('delete_tab', payload, ctx.opId);
      if (viewing) app.navigate(payload.move_to_tab_id ? { name: 'tab', id: payload.move_to_tab_id } : { name: 'summary' }, { replace: true });
      return true;
    },
    onError(err, ctx) {
      if (err.code === 'tab_has_goals') {
        app.refresh().catch(() => {}).then(() => {
          sync();
          ctx.setAlert(err.message);
        });
        return true;
      }
      return false;
    },
  });
}


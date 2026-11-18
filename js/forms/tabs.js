// Gestión de pestañas (Ajustes → Pestañas de objetivos): crear, renombrar, reordenar
// (subir/bajar) y eliminar.

import {
  h, iconButton, button, formSheet, field, textInput, selectInput,
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

// La página se vuelve a pintar con cada cambio de datos (también de otro dispositivo), así
// que lo que está en curso se guarda en app.memory: si hay un envío pendiente, el op_id
// que se reutiliza al reintentar un fallo de red (solo con el mismo nombre) y el último
// error ({ name, message }), que solo vale mientras el campo conserva ese nombre.
const MEM_BUSY = 'tabs-busy';
const MEM_OP = 'tabs-create-op';
const MEM_ERROR = 'tabs-create-error';

/** Campo «Nueva pestaña» que hay ahora en pantalla, o null. */
const currentNameInput = () => document.querySelector('[data-tab-create] input');

/** Contenido de Ajustes → Pestañas de objetivos: lista con sus acciones y alta de pestañas. */
export function tabManager(app) {
  const busy = !!app.memory.get(MEM_BUSY);
  const tabs = app.sortedTabs();

  const list = h('ul', { class: 'manage-list' }, tabs.map((tab, i) => h('li', { class: 'manage-item' },
    h('div', { class: 'manage-main' },
      h('span', { class: 'manage-name' }, tab.name),
      h('span', { class: 'muted small' }, plural(tab.goal_count || 0, 'objetivo', 'objetivos'))),
    h('div', { class: 'manage-actions' },
      iconButton('arrowUp', `Subir «${tab.name}»`, () => moveTab(app, tabs, i, -1), { disabled: busy || i === 0, dataset: { fk: `up-${tab.id}` } }),
      iconButton('arrowDown', `Bajar «${tab.name}»`, () => moveTab(app, tabs, i, 1), { disabled: busy || i === tabs.length - 1, dataset: { fk: `down-${tab.id}` } }),
      iconButton('pencil', `Renombrar «${tab.name}»`, () => openRenameTab(app, tab.id), { disabled: busy, dataset: { fk: `ren-${tab.id}` } }),
      iconButton('trash', `Eliminar «${tab.name}»`, () => openDeleteTab(app, tab.id), { disabled: busy, dataset: { fk: `del-${tab.id}` } })))));
  if (!tabs.length) list.append(h('li', { class: 'manage-empty muted' }, 'Aún no hay pestañas. Cread la primera aquí abajo.'));

  const nameInput = textInput({
    maxlength: TAB_NAME_MAX, placeholder: 'Por ejemplo: Mascotas', readOnly: busy,
    dataset: { fk: 'new-tab-name', persist: 'new-tab-name' },
  });
  const form = h('form', { class: 'manage-create', novalidate: true, dataset: { tabCreate: '' } },
    field({ label: 'Nueva pestaña', control: nameInput, name: 'name' }),
    button('Añadir pestaña', null, { variant: 'primary', type: 'submit', iconName: 'plus', disabled: busy, extraClass: 'btn-block', dataset: { fk: 'new-tab-add' } }));
  // Al repintar esta misma página, app.js devuelve al campo lo escrito; al volver a ella desde
  // otra, el campo sale vacío. El error se muestra solo si el campo (el que aún está en
  // pantalla, si lo hay) sigue con el nombre al que se refiere; si no, se olvida.
  const error = app.memory.get(MEM_ERROR);
  const shown = currentNameInput();
  if (error && shown && shown.value.trim() === error.name) setFieldError(form, 'name', error.message);
  else app.memory.delete(MEM_ERROR);
  nameInput.addEventListener('input', () => {
    if (!app.memory.get(MEM_ERROR)) return;
    app.memory.delete(MEM_ERROR);
    clearFieldErrors(form);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); createFromPage(app); });

  return h('div', { class: 'manage' }, list, form);
}

async function moveTab(app, tabs, index, dir) {
  if (app.memory.get(MEM_BUSY)) return;
  const order = tabs.map((t) => t.id);
  const j = index + dir;
  [order[index], order[j]] = [order[j], order[index]];
  const movedId = order[j];
  app.memory.set(MEM_BUSY, true);
  app.render();
  await app.run('reorder_tabs', { order }, { success: null });
  app.memory.delete(MEM_BUSY);
  app.render();
  // El foco vuelve a la flecha de la pestaña movida (o a la otra, si esa ya no se puede usar).
  const arrow = (d) => document.querySelector(`[data-fk="${d < 0 ? 'up' : 'down'}-${movedId}"]`);
  const target = [arrow(dir), arrow(-dir)].find((el) => el && !el.disabled);
  if (target) target.focus();
}

async function createFromPage(app) {
  if (app.memory.get(MEM_BUSY)) return;
  const input = currentNameInput();
  if (!input) return;
  const name = input.value.trim();
  app.memory.delete(MEM_ERROR);
  const problem = tabNameError(app, name);
  if (problem) {
    app.memory.set(MEM_ERROR, { name, message: problem });
    app.render();
    currentNameInput()?.focus();
    return;
  }
  const pending = app.memory.get(MEM_OP);
  const opId = pending && pending.name === name ? pending.opId : newOpId();
  app.memory.set(MEM_OP, { opId, name });
  app.memory.set(MEM_BUSY, true);
  app.render();
  let created = false;
  try {
    await createTab(app, name, opId);
    created = true;
    app.memory.delete(MEM_OP);
  } catch (err) {
    if (err && err.code === 'unauthorized') { app.memory.delete(MEM_BUSY); app.invalidate(); return; }
    if (!(err && err.retryable)) app.memory.delete(MEM_OP);
    const detail = err && err.fields && err.fields.name ? err.fields.name : err && err.message;
    // Si entretanto se ha salido de la página, el campo ya no muestra ese nombre: se avisa aparte.
    if (currentNameInput()?.value.trim() === name) {
      app.memory.set(MEM_ERROR, { name, message: detail || 'No se ha podido crear la pestaña.' });
    } else {
      app.toast(`No se ha podido crear la pestaña «${name}». ${detail || ''}`.trim(), { type: 'error' });
    }
  } finally {
    app.memory.delete(MEM_BUSY);
  }
  if (created) {
    const el = currentNameInput();
    if (el) el.value = '';
    app.toast('Pestaña creada');
  }
  app.render();
  currentNameInput()?.focus();
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
      const viewing = app.route.name === 'goals' && app.route.id === tabId;
      await app.mutate('delete_tab', payload, ctx.opId);
      if (app.memory.get('goals-tab') === tabId) app.memory.delete('goals-tab');
      if (viewing) app.navigate(payload.move_to_tab_id ? { name: 'goals', id: payload.move_to_tab_id } : { name: 'goals' }, { replace: true });
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


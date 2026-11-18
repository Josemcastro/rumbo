// Piezas de interfaz reutilizables: creación de elementos, avisos (toasts), hojas modales
// accesibles, campos de formulario, formularios con op_id, menús y barras de progreso.
// Todo se construye con el DOM (sin innerHTML con datos) para cumplir la CSP estricta.

import { newOpId, CONFLICT_MESSAGE } from './api.js';
import { formatPercent } from './format.js';
import { icon } from './icons.js';

export { icon };

// ---------- Creación de elementos ----------

const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'required', 'multiple', 'indeterminate']);

/**
 * h('button', { class: 'btn', onClick: fn, 'aria-label': 'Cerrar' }, 'Texto', otroNodo)
 * - `class` admite cadena o array (se ignoran valores falsos).
 * - `on<Evento>` añade un listener.
 * - `dataset` es un objeto con data-*.
 * - Atributos con valor `false`, `null` o `undefined` se omiten; `true` → atributo vacío.
 * Los textos se insertan siempre como nodos de texto (nunca como HTML).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') {
        const cls = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
        if (cls) el.className = cls;
      } else if (key === 'dataset') {
        for (const [k, v] of Object.entries(value)) {
          if (v !== undefined && v !== null) el.dataset[k] = String(v);
        }
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (PROP_KEYS.has(key)) {
        el[key] = value;
      } else if (value === false) {
        continue;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(parent, child);
    else if (child instanceof Node) parent.append(child);
    else parent.append(document.createTextNode(String(child)));
  }
  return parent;
}

let uid = 0;
export const nextId = (prefix = 'id') => `${prefix}-${++uid}`;

/** Vacía un nodo y le añade nuevos hijos. */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
  return el;
}

export function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Icono de la app (icon.svg en la raíz). Se resuelve desde este módulo para que valga
 *  igual en index.html que en tests/app-local.html o en https://usuario.github.io/repo/. */
export const APP_ICON_URL = new URL('../icon.svg', import.meta.url).href;

/** Logo de la app con esquinas de icono. Es decorativo: el nombre «Rumbo» va siempre al lado. */
export function appLogo(size, extraClass = '') {
  return h('img', {
    src: APP_ICON_URL, alt: '', width: size, height: size, decoding: 'async', draggable: 'false',
    class: ['app-logo', extraClass],
  });
}

/** Botón solo con icono y etiqueta accesible. */
export function iconButton(name, label, onClick, extra = {}) {
  return h('button', {
    type: 'button', class: ['icon-btn', extra.class], 'aria-label': label, title: label,
    onClick, disabled: extra.disabled, dataset: extra.dataset,
  }, icon(name));
}

/** Botón con texto (y opcionalmente icono). variant: primary | secondary | plain | danger. */
export function button(label, onClick, { variant = 'secondary', iconName = null, small = false, extraClass = null, disabled = false, dataset = null, type = 'button' } = {}) {
  return h('button', {
    type, class: ['btn', `btn-${variant}`, small && 'btn-small', extraClass], onClick, disabled, dataset,
  }, iconName ? icon(iconName) : null, h('span', null, label));
}

// ---------- Toasts (aria-live) ----------

let toastRegion = null;

export function initToasts() {
  toastRegion = document.getElementById('toasts');
}

/**
 * Aviso breve. `type`: 'info' | 'error'. `action`: { label, onClick } (p. ej. «Reintentar»).
 */
export function toast(message, { type = 'info', action = null, timeout } = {}) {
  if (!toastRegion) initToasts();
  if (!toastRegion) return;
  const el = h('div', { class: ['toast', type === 'error' && 'toast-error'], role: type === 'error' ? 'alert' : 'status' },
    type === 'error' ? icon('alert') : icon('check'),
    h('span', { class: 'toast-text' }, message));
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), prefersReducedMotion() ? 0 : 180);
  };
  if (action) {
    el.append(h('button', { type: 'button', class: 'toast-action', onClick: () => { remove(); action.onClick(); } }, action.label));
  }
  el.append(h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Cerrar aviso', onClick: remove }, icon('close')));
  toastRegion.append(el);
  while (toastRegion.children.length > 3) toastRegion.firstElementChild.remove();
  const ms = timeout ?? (action ? 12000 : type === 'error' ? 7000 : 3000);
  setTimeout(remove, ms);
}

// ---------- Hojas modales (<dialog> nativo: foco atrapado y Escape) ----------

const openSheets = new Set();

/** Cierra todas las hojas abiertas (p. ej. si el enlace deja de ser válido). */
export function closeAllSheets() {
  for (const sheet of [...openSheets]) sheet.close({ force: true });
}

/** Primer campo editable visible de un contenedor (sin radios ni casillas). */
const FIELD_SELECTOR = 'input:not([type=hidden]):not([disabled]):not([readonly]):not([type=radio]):not([type=checkbox]):not([type=button]):not([type=submit]), select:not([disabled]), textarea:not([disabled]):not([readonly])';
function firstEditable(container) {
  return [...container.querySelectorAll(FIELD_SELECTOR)].find((el) => !el.closest('[hidden]')) || null;
}

/** Devuelve el foco a quien abrió la hoja; si el repintado lo ha sustituido, a su equivalente. */
function restoreFocus(opener, openerKey, openerDialog) {
  const usable = (el) => el && document.contains(el) && !el.disabled && !el.closest('[hidden]') && typeof el.focus === 'function';
  let target = usable(opener) ? opener : null;
  if (!target && openerKey) {
    const scope = openerDialog && document.contains(openerDialog) && openerDialog.open ? openerDialog : document;
    const el = scope.querySelector(`[data-fk="${CSS.escape(openerKey)}"]`);
    if (usable(el)) target = el;
  }
  if (!target && openerDialog && document.contains(openerDialog) && openerDialog.open) {
    target = firstEditable(openerDialog) || openerDialog.querySelector('.sheet-close');
  }
  if (!target) {
    const heading = document.querySelector('main h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      target = heading;
    }
  }
  if (target) target.focus({ preventScroll: true });
}

/**
 * Abre una hoja modal. Devuelve { dialog, body, close, setBusy, onClose }.
 * - `initialFocus`: elemento que recibe el foco al abrir (con `selectOnOpen`, además se
 *   selecciona su texto). Por defecto, el primer campo editable visible; si no hay
 *   ninguno, `fallbackFocus` o el botón «Cerrar».
 * Al cerrarse devuelve el foco al elemento que la abrió (o a su equivalente tras repintar).
 */
export function openSheet({ title, content = [], className = '', initialFocus = null, selectOnOpen = false, fallbackFocus = null }) {
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const openerKey = opener && opener.closest ? opener.closest('[data-fk]')?.dataset.fk || null : null;
  const openerDialog = opener && opener.closest ? opener.closest('dialog') : null;
  const titleId = nextId('sheet-title');
  const closeListeners = [];
  let busy = false;
  let closed = false;

  const body = h('div', { class: 'sheet-body' }, content);
  const closeBtn = iconButton('close', 'Cerrar', () => api.close(), { class: 'sheet-close' });
  const dialog = h('dialog', { class: ['sheet', className], 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'sheet-head' }, h('h2', { id: titleId, class: 'sheet-title' }, title), closeBtn),
    body);

  const api = {
    dialog,
    body,
    close({ force = false } = {}) {
      if (closed || (busy && !force)) return;
      closed = true;
      openSheets.delete(api);
      dialog.classList.add('is-closing');
      const finish = () => {
        if (dialog.open) dialog.close();
        dialog.remove();
        closeListeners.forEach((fn) => fn());
        if (!force) restoreFocus(opener, openerKey, openerDialog);
      };
      if (prefersReducedMotion() || force) finish(); else setTimeout(finish, 140);
    },
    setBusy(value) { busy = value; dialog.classList.toggle('is-busy', value); },
    onClose(fn) { closeListeners.push(fn); },
    get closed() { return closed; },
  };

  dialog.addEventListener('cancel', (e) => { e.preventDefault(); api.close(); });
  // Si el navegador cierra el diálogo por su cuenta (Escape repetido), se completa el cierre.
  dialog.addEventListener('close', () => {
    if (closed) return;
    if (busy) { dialog.showModal(); return; }
    api.close();
  });
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) api.close();
  });

  document.body.append(dialog);
  openSheets.add(api);
  dialog.showModal();
  // El foco se mueve dentro del mismo gesto del usuario: en iOS abre el teclado.
  const target = (initialFocus && !initialFocus.closest('[hidden]') && !initialFocus.disabled ? initialFocus : null)
    || firstEditable(body) || fallbackFocus || closeBtn;
  target.focus();
  if (selectOnOpen && target === initialFocus && typeof target.select === 'function') target.select();
  return api;
}

// ---------- Campos de formulario ----------

/**
 * Envuelve un control con su etiqueta, ayuda y mensaje de error enlazados por aria.
 * `name` identifica el campo para mostrar errores del servidor (`fields`).
 */
export function field({ label, control, hint, name, optional = false, className = '' }) {
  if (!control.id) control.id = nextId('f');
  const id = control.id;
  const hintEl = h('p', { class: 'field-hint', id: `${id}-hint`, hidden: !hint }, hint || '');
  const errEl = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
  control.setAttribute('aria-describedby', `${hintEl.id} ${errEl.id}`);
  if (name && !control.name) control.name = name;
  const wrap = h('div', { class: ['field', className], dataset: name ? { field: name } : undefined },
    h('label', { for: id, class: 'field-label' }, label, optional ? h('span', { class: 'optional' }, ' · opcional') : null),
    control, hintEl, errEl);
  wrap.setHint = (text) => { hintEl.textContent = text || ''; hintEl.hidden = !text; };
  return wrap;
}

function findField(root, name) {
  const candidates = [name, String(name).split(/[.[]/)[0]];
  for (const key of candidates) {
    const wrap = root.querySelector(`[data-field="${CSS.escape(key)}"]`);
    if (wrap) return wrap;
  }
  return null;
}

export function setFieldError(root, name, message) {
  const wrap = findField(root, name);
  if (!wrap) return false;
  const err = wrap.querySelector('.field-error');
  if (!err) return false;
  err.replaceChildren(icon('alert'), document.createTextNode(String(message)));
  err.hidden = false;
  wrap.querySelectorAll('input, select, textarea').forEach((c) => c.setAttribute('aria-invalid', 'true'));
  return true;
}

export function clearFieldErrors(root) {
  root.querySelectorAll('.field-error').forEach((el) => { el.hidden = true; el.replaceChildren(); });
  root.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}

/** Pone el foco en el primer campo con error. */
export function focusFirstError(root) {
  const bad = root.querySelector('[aria-invalid="true"]');
  if (bad) bad.focus();
}

export function textInput(props = {}) {
  return h('input', { type: 'text', autocomplete: 'off', ...props });
}

export function textArea(props = {}) {
  return h('textarea', { rows: 3, ...props });
}

export function amountInput(props = {}) {
  return h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', class: 'input-amount', spellcheck: 'false', ...props });
}

export function dateInput(props = {}) {
  return h('input', { type: 'date', ...props });
}

export function selectInput(options, value, props = {}) {
  const select = h('select', props);
  fillSelect(select, options, value);
  return select;
}

export function fillSelect(select, options, value) {
  select.replaceChildren();
  for (const opt of options) {
    select.append(h('option', { value: String(opt.value), selected: String(opt.value) === String(value ?? ''), disabled: opt.disabled }, opt.label));
  }
}

/**
 * Grupo de opciones tipo «segmento» (radios accesibles). Una opción con `disabled` se ve
 * atenuada y no se puede elegir; su descripción debería explicar el motivo.
 */
export function segmented({ legend, name, options, value, onChange, cards = false, fieldName }) {
  const groupName = nextId(name || 'seg');
  const errEl = h('p', { class: 'field-error', hidden: true });
  const fs = h('fieldset', { class: ['segmented', 'field', cards && 'segmented-cards'], dataset: fieldName ? { field: fieldName } : undefined },
    h('legend', { class: 'field-label' }, legend));
  const wrap = h('div', { class: 'segmented-options' });
  for (const opt of options) {
    const id = nextId('opt');
    const input = h('input', { type: 'radio', name: groupName, id, value: opt.value, checked: opt.value === value, disabled: !!opt.disabled, onChange: () => onChange && onChange(opt.value) });
    const descEl = opt.description !== undefined ? h('span', { class: 'segment-desc' }, opt.description) : null;
    const label = h('label', { for: id, class: 'segment' },
      h('span', { class: 'segment-title' }, opt.label), descEl);
    const item = h('div', { class: 'segment-item' }, input, label);
    item.setDescription = (text) => { if (descEl) descEl.textContent = text; };
    item.setDisabled = (disabled) => { input.disabled = !!disabled; };
    item.dataset.value = opt.value;
    wrap.append(item);
  }
  fs.append(wrap, errEl);
  fs.getValue = () => (fs.querySelector('input:checked') || {}).value;
  fs.setValue = (v) => { fs.querySelectorAll('input').forEach((i) => { i.checked = i.value === v; }); };
  fs.item = (v) => wrap.querySelector(`[data-value="${CSS.escape(v)}"]`);
  return fs;
}

/** Casilla con etiqueta. */
export function checkbox({ label, checked = false, onChange, name, hint }) {
  const id = nextId('cb');
  const input = h('input', { type: 'checkbox', id, checked, name, onChange: onChange ? (e) => onChange(e.target.checked) : null });
  return h('div', { class: 'check-field', dataset: name ? { field: name } : undefined },
    input, h('label', { for: id }, label, hint ? h('span', { class: 'field-hint' }, hint) : null),
    h('p', { class: 'field-error', hidden: true }));
}

/** Botón que muestra u oculta una sección (aria-expanded). */
export function disclosure(label, content, { open = false } = {}) {
  const regionId = nextId('disc');
  const region = h('div', { id: regionId, class: 'disclosure-region', hidden: !open }, content);
  const btn = h('button', { type: 'button', class: 'disclosure', 'aria-expanded': String(open), 'aria-controls': regionId },
    h('span', null, label), icon('chevronDown'));
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(next));
    region.hidden = !next;
  });
  const wrap = h('div', { class: 'disclosure-wrap' }, btn, region);
  wrap.open = () => { btn.setAttribute('aria-expanded', 'true'); region.hidden = false; };
  return wrap;
}

/** Caja de aviso dentro de un formulario o vista. tone: info | warning | error | success */
export function notice(tone, ...content) {
  const iconName = tone === 'error' || tone === 'warning' ? 'alert' : tone === 'success' ? 'checkCircle' : 'info';
  return h('div', { class: ['notice', `notice-${tone}`] }, icon(iconName), h('div', { class: 'notice-text' }, content));
}

// ---------- Formulario en hoja con op_id, errores y reintento ----------

/**
 * Abre un formulario en hoja modal.
 * - `build(form, ctx)` añade los campos.
 * - `onSubmit(ctx)` hace la llamada; devuelve `false` si la validación local falla.
 * - `onError(err, ctx)` (opcional) devuelve true si ha gestionado el error.
 * - `onConflict(err, ctx)` (opcional) se llama tras recargar el estado por un `conflict`.
 * - `initialFocus` / `selectOnOpen`: campo que recibe el foco al abrir (por defecto, el
 *   primer campo editable; en confirmaciones sin campos, «Cancelar»).
 * El op_id se genera al abrir y se reutiliza al reintentar un fallo de red solo si los datos
 * del formulario no han cambiado: si la primera petición llegó a guardarse y solo se perdió
 * la respuesta, el servidor devolvería la respuesta guardada del envío original, así que un
 * envío con datos distintos necesita un op_id nuevo. Tras un rechazo definitivo también se
 * genera otro, porque el siguiente envío será distinto.
 */
export function formSheet(app, opts) {
  const {
    title, intro, build, onSubmit, onError, onConflict,
    submitLabel = 'Guardar', danger = false, successMessage = 'Guardado', cancelLabel = 'Cancelar',
    hideSubmit = false, initialFocus = null, selectOnOpen = false,
  } = opts;

  const form = h('form', { class: 'form', novalidate: true });
  const alertBox = h('div', { class: 'form-alert', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: ['btn', danger ? 'btn-danger' : 'btn-primary'], hidden: hideSubmit }, submitLabel);
  const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, hideSubmit ? 'Cerrar' : cancelLabel);
  const listeners = [];
  let busy = false;
  let blocked = false;
  // Datos del último envío y, tras un fallo reintentable, los datos que viajaron con ese op_id.
  let sentSnapshot = null;
  let retrySnapshot = null;

  const ctx = {
    app,
    form,
    opId: newOpId(),
    data: {},
    submitButton: submit,
    renewOpId() { ctx.opId = newOpId(); retrySnapshot = null; },
    /** Recuerda que el último envío puede haberse guardado: su op_id solo vale para esos datos. */
    keepOpIdForRetry() { retrySnapshot = sentSnapshot; },
    fieldError(name, message) {
      if (!setFieldError(form, name, message)) ctx.setAlert(message);
    },
    setAlert(message, { retry = false, tone = 'error', actions = [] } = {}) {
      alertBox.replaceChildren(icon(tone === 'error' ? 'alert' : 'info'), h('span', { class: 'form-alert-text' }, message));
      alertBox.classList.toggle('is-info', tone !== 'error');
      const btns = [];
      if (retry) btns.push(h('button', { type: 'button', class: 'btn btn-small btn-secondary', onClick: run }, 'Reintentar'));
      for (const a of actions) btns.push(h('button', { type: 'button', class: 'btn btn-small btn-secondary', onClick: a.onClick }, a.label));
      if (btns.length) alertBox.append(h('div', { class: 'form-alert-actions' }, btns));
      alertBox.hidden = false;
      alertBox.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    },
    clearAlert() { alertBox.hidden = true; alertBox.replaceChildren(); },
    setBlocked(value) { blocked = value; syncButton(); },
    setSubmitLabel(text) { submit.textContent = text; },
    /** Se llama cuando cambia el estado del espacio (otra pestaña o dispositivo). */
    watch(fn) { listeners.push(app.onState(fn)); },
    close() { sheet.close(); },
    submit: () => run(),
  };

  function syncButton() { submit.disabled = busy || blocked; }

  /** Valores actuales de todos los controles del formulario (para comparar envíos). */
  function snapshot() {
    return JSON.stringify([...form.elements].filter((el) => el.tagName !== 'BUTTON' && el.tagName !== 'FIELDSET').map((el) => (
      el.type === 'checkbox' || el.type === 'radio' ? `${el.name}:${el.value}:${el.checked}` : `${el.name}:${el.value}`)));
  }

  if (intro) form.append(typeof intro === 'string' ? h('p', { class: 'sheet-intro' }, intro) : intro);
  build(form, ctx);
  form.append(alertBox, h('div', { class: 'form-actions' }, cancel, submit));

  const sheet = openSheet({ title, content: [form], initialFocus, selectOnOpen, fallbackFocus: hideSubmit ? null : cancel });
  ctx.sheet = sheet;
  cancel.addEventListener('click', () => sheet.close());
  sheet.onClose(() => listeners.forEach((off) => off()));

  async function run() {
    if (busy || blocked) return;
    clearFieldErrors(form);
    ctx.clearAlert();
    sentSnapshot = snapshot();
    // Se mantiene la marca hasta renovar el op_id: un fallo de validación local no la borra.
    if (retrySnapshot !== null && retrySnapshot !== sentSnapshot) ctx.renewOpId();
    busy = true;
    syncButton();
    submit.classList.add('is-busy');
    submit.setAttribute('aria-busy', 'true');
    form.setAttribute('aria-busy', 'true');
    sheet.setBusy(true);
    let ok = false;
    try {
      const result = await onSubmit(ctx);
      ok = result !== false;
      if (!ok) focusFirstError(form);
    } catch (err) {
      await handleFormError(app, err, ctx, { onError, onConflict });
    } finally {
      busy = false;
      sheet.setBusy(false);
      submit.classList.remove('is-busy');
      submit.removeAttribute('aria-busy');
      form.removeAttribute('aria-busy');
      syncButton();
    }
    if (ok) {
      sheet.close();
      if (successMessage) app.toast(successMessage);
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  return ctx;
}

/** Traduce errores de la capa de datos a mensajes en el formulario. */
async function handleFormError(app, err, ctx, { onError, onConflict }) {
  if (!err || err.name !== 'ApiError') {
    ctx.keepOpIdForRetry();
    ctx.setAlert('Algo no ha ido bien. Inténtalo de nuevo.', { retry: true });
    return;
  }
  if (err.code === 'unauthorized') {
    ctx.sheet.setBusy(false);
    app.invalidate();
    return;
  }
  if (onError && (await onError(err, ctx))) {
    if (err.retryable) ctx.keepOpIdForRetry(); else ctx.renewOpId();
    return;
  }
  if (err.retryable) {
    ctx.keepOpIdForRetry();
    app.reportNetwork(err.code !== 'network');
    ctx.setAlert(`${err.message} Si cambias algún dato, se enviará como un cambio nuevo: revisa antes si el anterior llegó a guardarse.`, { retry: true });
    return;
  }
  ctx.renewOpId();
  if (err.code === 'conflict') {
    ctx.setAlert(CONFLICT_MESSAGE);
    await app.refresh().catch(() => {});
    if (onConflict) onConflict(err, ctx);
    for (const name of conflictFieldNames(err)) {
      setFieldError(ctx.form, name, 'Cambió en otro dispositivo: revisa este valor.');
    }
    return;
  }
  if (err.code === 'validation' && err.fields && typeof err.fields === 'object') {
    let shown = false;
    const others = [];
    for (const [name, message] of Object.entries(err.fields)) {
      if (setFieldError(ctx.form, name, message)) shown = true;
      else others.push(String(message));
    }
    if (others.length) ctx.setAlert(others.join(' '));
    else if (!shown) ctx.setAlert(err.message);
    focusFirstError(ctx.form);
    return;
  }
  if (err.code === 'not_found') {
    ctx.setAlert(err.message);
    app.refresh().catch(() => {});
    return;
  }
  ctx.setAlert(err.message);
}

export function conflictFieldNames(err) {
  const f = err && err.fields;
  if (!f) return [];
  return Array.isArray(f) ? f.map(String) : Object.keys(f);
}

/** Diálogo de confirmación con el mismo manejo de errores que un formulario. */
export function confirmSheet(app, { title, message, confirmLabel, danger = false, build, onConfirm, successMessage, onError }) {
  const paragraphs = message ? (Array.isArray(message) ? message : [message]) : [];
  return formSheet(app, {
    title,
    intro: paragraphs.length ? h('div', { class: 'sheet-intro' }, paragraphs.map((m) => (m instanceof Node ? m : h('p', null, m)))) : null,
    build: build || (() => {}),
    submitLabel: confirmLabel,
    danger,
    successMessage,
    onSubmit: onConfirm,
    onError,
  });
}

// ---------- Menú desplegable accesible ----------

/**
 * Botón que despliega un menú. items: [{ label, icon, onSelect, disabled, danger }].
 * Teclado: flechas, Inicio/Fin, Escape; se cierra al pulsar fuera.
 */
export function menuButton({ label, iconName = 'more', items, buttonClass = 'btn btn-secondary', iconOnly = false, align = 'end', dataset = null }) {
  const menuId = nextId('menu');
  const btn = h('button', {
    type: 'button', class: buttonClass, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId,
    'aria-label': iconOnly ? label : null, title: iconOnly ? label : null, dataset,
  }, icon(iconName), iconOnly ? null : h('span', null, label));
  const menu = h('div', { class: ['menu', `menu-${align}`], id: menuId, role: 'menu', hidden: true });
  const wrap = h('div', { class: 'menu-wrap' }, btn, menu);

  for (const item of items.filter(Boolean)) {
    menu.append(h('button', {
      type: 'button', role: 'menuitem', class: ['menu-item', item.danger && 'is-danger'], disabled: item.disabled, tabindex: '-1',
      // Primero se devuelve el foco al botón del menú: así la hoja que se abra (o el repintado)
      // tiene un elemento visible al que volver.
      onClick: () => { close(true); item.onSelect(); },
    }, item.icon ? icon(item.icon) : null, h('span', null, item.label)));
  }

  const enabledItems = () => [...menu.querySelectorAll('.menu-item:not([disabled])')];
  function onDocDown(e) { if (!wrap.contains(e.target)) close(); }
  function open() {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDocDown, true);
    const first = enabledItems()[0];
    if (first) first.focus();
  }
  function close(returnFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocDown, true);
    if (returnFocus) btn.focus();
  }
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
  });
  menu.addEventListener('keydown', (e) => {
    const list = enabledItems();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
  });
  return wrap;
}

// ---------- Barra de progreso ----------

/** Una sola barra con role="progressbar", valor accesible y texto. */
export function progressBar(percentCapped, { label, valueText } = {}) {
  const value = Math.max(0, Math.min(100, Number(percentCapped) || 0));
  const fill = h('div', { class: 'progress-fill' });
  fill.style.width = `${value}%`; // CSSOM: permitido por la CSP (no es un atributo style)
  return h('div', {
    class: ['progress', value >= 100 && 'is-complete'], role: 'progressbar',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(value * 10) / 10),
    'aria-valuetext': valueText || formatPercent(percentCapped), 'aria-label': label || 'Progreso',
  }, fill);
}

// ---------- Portapapeles y compartir ----------

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* se prueba el método alternativo */ }
  const ta = h('textarea', { class: 'visually-hidden', readonly: true, 'aria-hidden': 'true' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function canShare() {
  return typeof navigator.share === 'function';
}

/** Comparte con el menú del sistema. Devuelve true si se compartió. */
export async function shareLink(url) {
  if (!canShare()) return false;
  try {
    await navigator.share({ title: 'Rumbo', text: 'Nuestro espacio en «Rumbo»', url });
    return true;
  } catch {
    return false;
  }
}

/**
 * Bloque con el enlace del espacio, botones «Copiar» y «Compartir» (si existe).
 */
export function linkBox(url, { toastFn } = {}) {
  const input = h('input', { type: 'text', class: 'link-input', readOnly: true, value: url, 'aria-label': 'Enlace del espacio', spellcheck: 'false' });
  input.addEventListener('focus', () => input.select());
  const copyBtn = button('Copiar', async () => {
    const ok = await copyText(url);
    if (toastFn) toastFn(ok ? 'Enlace copiado' : 'No se ha podido copiar. Selecciona el enlace y cópialo a mano.', { type: ok ? 'info' : 'error' });
  }, { iconName: 'copy' });
  const shareBtn = canShare() ? button('Compartir', () => shareLink(url), { iconName: 'share' }) : null;
  return h('div', { class: 'link-box' }, input, h('div', { class: 'link-actions' }, copyBtn, shareBtn));
}

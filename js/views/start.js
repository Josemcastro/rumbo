// Pantallas sin espacio cargado: configuración pendiente, inicio (crear / demostración),
// enlace recién creado, enlace no válido, carga y error de carga.

import {
  h, icon, button, linkBox, field, textInput, setFieldError, clearFieldErrors, notice, appLogo, prefersReducedMotion,
} from '../ui.js';
import { generateSecret, isValidSecret } from '../api.js';
import { spaceLink } from '../router.js';

/** Extrae el secreto de un enlace pegado (dirección completa o solo la parte tras «#»). */
export function secretFromLink(value) {
  let v = String(value || '').trim();
  const i = v.indexOf('#');
  if (i >= 0) v = v.slice(i + 1);
  v = v.split('/')[0].trim();
  return isValidSecret(v) ? v : null;
}

function screen(...children) {
  return h('div', { class: 'screen' }, h('div', { class: 'screen-card' }, children));
}

function brandMark() {
  return h('div', { class: 'screen-brand' }, appLogo(64, 'screen-logo'), h('span', null, 'Rumbo'));
}

// ---------- Falta configurar Supabase ----------

export function renderSetupMissing() {
  const steps = [
    ['Crea un proyecto gratuito en ', h('strong', null, 'supabase.com'), '.'],
    ['Abre ', h('strong', null, 'SQL Editor'), ', pega todo el contenido del archivo ', h('code', null, 'supabase/schema.sql'), ' de este repositorio y pulsa ', h('strong', null, 'Run'), '.'],
    ['En ', h('strong', null, 'Project Settings → API'), ' (o «API Keys»), copia la ', h('strong', null, 'Project URL'), ' y la clave pública ', h('strong', null, 'anon'), ' o ', h('strong', null, 'publishable'), '.'],
    ['Pega esos dos valores en el archivo ', h('code', null, 'config.js'), ' y sube el cambio a GitHub.'],
    ['Espera un minuto a que GitHub Pages publique el cambio y recarga esta página.'],
  ];
  return screen(
    brandMark(),
    h('h1', { class: 'screen-title' }, 'Falta conectar la base de datos'),
    h('p', { class: 'screen-text' }, 'Esta web guarda vuestros datos en un proyecto de Supabase que todavía no está configurado. Son unos minutos y solo hay que hacerlo una vez:'),
    h('ol', { class: 'steps' }, steps.map((s) => h('li', null, s))),
    notice('warning', 'Usa solo la clave pública (anon / publishable). Nunca pongas en config.js la clave service_role ni la clave secret.'),
    h('p', { class: 'screen-foot' }, 'Tienes los pasos detallados en el archivo README.md del repositorio.'),
  );
}

// ---------- Inicio sin secreto ----------

/** Tiempo que el logo se queda solo antes de mostrar las opciones (efecto «se abre la app»). */
const HOME_REVEAL_MS = 650;

export function renderHome(app) {
  let pending = null; // { secret, demo } reutilizado al reintentar tras un fallo de red
  let busy = false;

  const codeInput = textInput({ autocomplete: 'off', spellcheck: 'false', maxlength: 200 });
  const codeField = field({ label: 'Código de configuración', control: codeInput, name: 'setup_code', hint: 'Lo eligió quien instaló esta web. Pídeselo si no lo tienes.' });
  codeField.hidden = true;

  const alertBox = h('div', { class: 'form-alert', role: 'alert', hidden: true });
  const createBtn = button('Crear nuestro espacio', null, { variant: 'primary', extraClass: 'btn-block', type: 'submit' });
  const demoBtn = button('Ver una demostración', () => create(true), { variant: 'plain', extraClass: 'btn-block' });

  function setAlert(message, retry) {
    alertBox.replaceChildren(icon('alert'), h('span', { class: 'form-alert-text' }, message));
    if (retry) alertBox.append(h('div', { class: 'form-alert-actions' }, button('Reintentar', retry, { small: true })));
    alertBox.hidden = false;
  }

  function setBusy(value, demo) {
    busy = value;
    createBtn.disabled = value;
    demoBtn.disabled = value;
    createBtn.querySelector('span').textContent = value && !demo ? 'Creando…' : 'Crear nuestro espacio';
    demoBtn.querySelector('span').textContent = value && demo ? 'Preparando la demostración…' : 'Ver una demostración';
    (demo ? demoBtn : createBtn).setAttribute('aria-busy', String(value));
  }

  async function create(demo) {
    if (busy) return;
    alertBox.hidden = true;
    clearFieldErrors(card);
    if (!pending || pending.demo !== demo) pending = { secret: generateSecret(), demo };
    const { secret } = pending;
    const setupCode = demo ? null : codeInput.value.trim() || null;
    setBusy(true, demo);
    let ok = false;
    try {
      await app.api.createSpace(secret, { demo, setupCode });
      ok = true;
    } catch (err) {
      if (err && err.retryable) {
        // Puede que se creara y se perdiera la respuesta: si el secreto ya funciona, está hecho.
        try { await app.api.getRev(secret); ok = true; } catch { /* sigue fallando */ }
        if (!ok) setAlert(err.message, () => create(demo));
      } else {
        pending = null;
        handleError(err);
      }
    } finally {
      setBusy(false, demo);
    }
    if (ok) {
      pending = null;
      app.openSpace(secret, demo ? { name: 'summary' } : { name: 'welcome' });
    }
  }

  function handleError(err) {
    const code = err && err.code;
    if (code === 'setup_code_required' || (code === 'validation' && err.fields && err.fields.setup_code)) {
      codeField.hidden = false;
      setFieldError(card, 'setup_code', (err.fields && err.fields.setup_code) || err.message);
      codeInput.focus();
      return;
    }
    setAlert(err && err.message ? err.message : 'Algo no ha ido bien. Inténtalo de nuevo.', null);
  }

  const form = h('form', { class: 'form home-form', novalidate: true }, codeField, alertBox, createBtn);
  form.addEventListener('submit', (e) => { e.preventDefault(); create(false); });

  // «Ya tenemos un espacio»: entrar pegando el enlace guardado, sin crear otro espacio.
  const linkInput = textInput({ autocomplete: 'off', spellcheck: 'false', maxlength: 500, placeholder: 'Pegad aquí el enlace completo' });
  const linkForm = h('form', { class: 'form home-link', novalidate: true },
    field({ label: 'Vuestro enlace', control: linkInput, name: 'link', hint: 'El que guardasteis al crear el espacio (o pedídselo a la otra persona).' }),
    button('Entrar en nuestro espacio', null, { variant: 'primary', extraClass: 'btn-block', type: 'submit' }));
  linkForm.hidden = true;
  linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(linkForm);
    const secret = secretFromLink(linkInput.value);
    if (!secret) {
      setFieldError(linkForm, 'link', 'Ese enlace no parece completo. Copiadlo entero, incluida la parte que va detrás de «#».');
      linkInput.focus();
      return;
    }
    app.openSpace(secret);
  });
  const haveBtn = button('Ya tenemos un espacio', () => {
    linkForm.hidden = false;
    haveBtn.hidden = true;
    linkInput.focus();
  }, { variant: 'secondary', extraClass: 'btn-block' });

  // Primero se ve solo el logo, centrado; tras un instante se abren las tres opciones
  // debajo (sin animación ni espera si se prefiere reducir el movimiento).
  const reduce = prefersReducedMotion();
  const reveal = h('div', { class: 'home-reveal', inert: reduce ? null : true },
    h('div', { class: 'home-reveal-clip' },
      h('div', { class: 'home-actions' }, form, haveBtn, linkForm, demoBtn)));
  const card = h('div', { class: 'home-card' },
    h('div', { class: 'home-brand' }, appLogo(112, 'home-logo'), h('h1', { class: 'home-name' }, 'Rumbo')),
    reveal);
  const page = h('div', { class: ['screen', 'home', reduce && 'is-open'] }, card);
  if (!reduce) {
    setTimeout(() => {
      page.classList.add('is-open');
      reveal.removeAttribute('inert');
    }, HOME_REVEAL_MS);
  }
  return page;
}

// ---------- Enlace recién creado ----------

export function renderWelcome(app, secret) {
  const url = spaceLink(secret);
  return screen(
    brandMark(),
    h('div', { class: 'screen-icon is-success' }, icon('checkCircle')),
    h('h1', { class: 'screen-title' }, 'Vuestro espacio está listo'),
    h('p', { class: 'screen-text' }, 'Este es vuestro enlace privado. Guardadlo en un lugar seguro (en favoritos o en vuestras notas) y compartidlo solo entre vosotros: es la única forma de entrar.'),
    linkBox(url, { toastFn: app.toast }),
    notice('warning', 'Cualquier persona con este enlace puede ver y editar vuestro espacio. Si alguna vez se comparte por error, podréis regenerarlo desde Ajustes.'),
    button('Entrar en nuestro espacio', () => app.openSpace(secret), { variant: 'primary', extraClass: 'btn-block' }),
  );
}

// ---------- Enlace no válido ----------

export function renderInvalid(app) {
  return screen(
    brandMark(),
    h('div', { class: 'screen-icon' }, icon('link')),
    h('h1', { class: 'screen-title' }, 'Este enlace ya no es válido'),
    h('p', { class: 'screen-text' }, 'Puede que esté incompleto o que se haya regenerado desde otro dispositivo. Pide el enlace nuevo a la otra persona del espacio.'),
    button('Ir al inicio', () => app.goHome(), { variant: 'secondary', extraClass: 'btn-block' }),
  );
}

// ---------- Carga ----------

export function renderLoading(text = 'Cargando vuestro espacio…') {
  return h('div', { class: 'screen screen-loading', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }),
    h('p', { class: 'screen-text' }, text));
}

const ERROR_TITLES = {
  not_installed: 'La base de datos no está preparada',
  bad_config: 'No se puede conectar con Supabase',
};

export function renderLoadError(app, err, retry) {
  const code = err && err.code;
  return screen(
    brandMark(),
    h('div', { class: 'screen-icon is-warning' }, icon(code === 'network' ? 'cloudOff' : 'alert')),
    h('h1', { class: 'screen-title' }, ERROR_TITLES[code] || 'No hemos podido cargar vuestro espacio'),
    h('p', { class: 'screen-text' }, err && err.message ? err.message : 'Algo no ha ido bien. Inténtalo de nuevo.'),
    button('Reintentar', retry, { variant: 'primary', extraClass: 'btn-block', iconName: 'refresh' }),
  );
}

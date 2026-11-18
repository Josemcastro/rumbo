// Vista «Ajustes»: lista agrupada (como los Ajustes del iPhone) que lleva a cada página:
// Vosotros, Pestañas de objetivos, Enlace del espacio, Apariencia, Este dispositivo y
// Sobre Rumbo. Cada página tiene su cabecera «‹ Ajustes».

import { h, icon, button, linkBox, notice, appLogo, nextId } from '../ui.js';
import { formatDateTime } from '../format.js';
import { flag } from '../labels.js';
import { spaceLink } from '../router.js';
import { openNamesForm, openRegenerate } from '../forms/settings.js';
import { tabManager } from '../forms/tabs.js';
import { THEMES, THEME_LABELS, getThemePref, setThemePref } from '../theme.js';

const PAGES = {
  vosotros: { title: 'Vosotros', iconName: 'users', render: renderNames },
  pestanas: { title: 'Pestañas de objetivos', iconName: 'folder', render: renderTabs },
  enlace: { title: 'Enlace del espacio', iconName: 'link', render: renderLink },
  apariencia: { title: 'Apariencia', iconName: 'appearance', render: renderAppearance },
  dispositivo: { title: 'Este dispositivo', iconName: 'phone', render: renderDevice },
  sobre: { title: 'Sobre Rumbo', iconName: 'info', render: renderAbout },
};

/** Título de una página de Ajustes (para el título del documento). */
export function settingsTitle(section) {
  return PAGES[section] ? PAGES[section].title : 'Ajustes';
}

export function renderSettings(app) {
  const page = PAGES[app.route.section];
  if (!page) return renderRoot(app);
  return h('div', { class: 'view view-narrow settings-page' },
    h('a', { class: 'back-link', href: app.href({ name: 'settings' }), dataset: { fk: 'settings-back' } },
      icon('chevronLeft'), h('span', null, 'Ajustes')),
    h('header', { class: 'view-head view-head-center' }, h('h1', { class: 'view-title' }, page.title)),
    page.render(app));
}

// ---------- Lista principal ----------

function renderRoot(app) {
  const space = app.state.space || {};
  const isDemo = flag(space.is_demo);
  const names = app.names();
  const unnamed = !(space.name_a || space.name_b);
  const tabCount = app.state.tabs.length;

  return h('div', { class: 'view view-narrow' },
    h('header', { class: 'view-head view-head-center' }, h('h1', { class: 'view-title' }, 'Ajustes')),
    group(app, 'Vuestro espacio', [
      { section: 'vosotros', value: unnamed ? 'Sin nombres' : `${names.a} y ${names.b}` },
      { section: 'pestanas', value: String(tabCount) },
      { section: 'enlace', value: 'Compartir' },
    ]),
    group(app, 'Preferencias', [
      { section: 'apariencia', value: THEME_LABELS[getThemePref()] },
      // Las demostraciones no se recuerdan en el dispositivo.
      isDemo ? null : { section: 'dispositivo', value: app.remembersSpace ? 'Lo recuerda' : 'No lo recuerda' },
    ]),
    group(app, null, [{ section: 'sobre', value: isDemo ? 'Demostración' : null }]));
}

function group(app, title, rows) {
  const id = title ? nextId('settings-group') : null;
  return h('section', { class: 'settings-group', 'aria-labelledby': id, 'aria-label': title ? null : 'Más información' },
    title ? h('h2', { class: 'settings-group-title', id }, title) : null,
    h('ul', { class: 'settings-list' }, rows.filter(Boolean).map(({ section, value }) => {
      const page = PAGES[section];
      return h('li', null, h('a', { class: 'settings-row has-icon', href: app.href({ name: 'settings', section }), dataset: { fk: `settings-${section}` } },
        h('span', { class: 'settings-row-icon' }, icon(page.iconName)),
        h('span', { class: 'settings-row-title' }, page.title),
        value ? h('span', { class: 'settings-row-value' }, value) : null,
        icon('chevronRight', 'settings-row-chevron')));
    })));
}

// ---------- Piezas de las páginas ----------

/** Lista de datos (etiqueta a la izquierda, valor a la derecha). */
function facts(rows) {
  return h('dl', { class: 'settings-list' }, rows.map(([label, value]) => h('div', { class: 'settings-row is-static' },
    h('dt', { class: 'settings-row-title' }, label),
    h('dd', { class: 'settings-row-value' }, value))));
}

/** Fila-botón dentro de una lista (como «Cerrar sesión» en el iPhone). */
function actionList(label, onClick, { danger = false, iconName = null, fk = null } = {}) {
  return h('div', { class: 'settings-list' },
    h('button', { type: 'button', class: ['settings-row', 'settings-action', danger && 'is-danger'], onClick, dataset: { fk } },
      iconName ? icon(iconName) : null, h('span', null, label)));
}

function note(...content) {
  return h('p', { class: 'settings-note' }, content);
}

// ---------- Vosotros ----------

function renderNames(app) {
  const space = app.state.space || {};
  const names = app.names();
  return h('div', { class: 'settings-body' },
    facts([
      ['Primera persona', space.name_a ? names.a : 'Sin nombre'],
      ['Segunda persona', space.name_b ? names.b : 'Sin nombre'],
    ]),
    actionList('Editar nombres', () => openNamesForm(app), { iconName: 'pencil', fk: 'edit-names' }),
    note('Los nombres se usan para indicar de quién es cada aportación, para quién es cada objetivo y quién se encarga de cada tarea.'));
}

// ---------- Pestañas de objetivos ----------

function renderTabs(app) {
  return h('div', { class: 'settings-body' },
    note('Las pestañas agrupan vuestros objetivos y aparecen como filtros en «Objetivos». Podéis crearlas, renombrarlas, ordenarlas o eliminarlas; si una tiene objetivos, al eliminarla elegiréis a cuál moverlos.'),
    tabManager(app));
}

// ---------- Enlace del espacio ----------

function renderLink(app) {
  const dangerId = nextId('danger');
  return h('div', { class: 'settings-body' },
    h('div', { class: 'card card-pad settings-card' },
      linkBox(spaceLink(app.secret), { toastFn: app.toast }),
      h('p', { class: 'settings-card-note' }, icon('alert'), h('span', null, 'Cualquier persona con este enlace puede ver y editar vuestro espacio.'))),
    note('Es la única forma de entrar: guardadlo en un lugar seguro y compartidlo solo entre vosotros.'),
    h('section', { class: 'settings-group', 'aria-labelledby': dangerId },
      h('h2', { class: 'settings-group-title', id: dangerId }, 'Zona de peligro'),
      actionList('Regenerar enlace', () => openRegenerate(app), { danger: true, iconName: 'refresh', fk: 'regenerate' }),
      note('Crea un enlace nuevo y anula el actual en todos los dispositivos. Usadlo si el enlace se ha compartido con alguien que no debería tenerlo.')));
}

// ---------- Apariencia ----------

function renderAppearance(app) {
  const current = getThemePref();
  const groupName = nextId('theme');
  const options = THEMES.map((value) => {
    const id = nextId('theme-opt');
    const input = h('input', {
      type: 'radio', name: groupName, id, value, checked: value === current, class: 'visually-hidden',
      dataset: { fk: `theme-${value}` },
    });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setThemePref(value);
      app.render();
    });
    return h('div', { class: 'theme-option' }, input,
      h('label', { for: id, class: 'theme-card' },
        h('span', { class: ['theme-preview', `is-${value}`], 'aria-hidden': 'true' },
          h('span', { class: 'theme-preview-card' }), h('span', { class: 'theme-preview-line' }), h('span', { class: 'theme-preview-line is-short' })),
        h('span', { class: 'theme-name' }, THEME_LABELS[value]),
        h('span', { class: 'theme-check', 'aria-hidden': 'true' }, icon('check'))));
  });

  return h('div', { class: 'settings-body' },
    h('fieldset', { class: 'theme-picker' },
      h('legend', { class: 'visually-hidden' }, 'Tema de la app'),
      h('div', { class: 'theme-options' }, options)),
    note(current === 'auto'
      ? 'Automático sigue el modo claro u oscuro de este dispositivo y cambia con él.'
      : `La app se verá siempre en modo ${current === 'dark' ? 'oscuro' : 'claro'} en este dispositivo.`),
    note('Es una preferencia de este dispositivo: no cambia lo que ve la otra persona.'));
}

// ---------- Este dispositivo ----------

function renderDevice(app) {
  const space = app.state.space || {};
  if (flag(space.is_demo)) {
    return h('div', { class: 'settings-body' },
      note('Las demostraciones no se recuerdan en ningún dispositivo: solo se abren con su enlace.'));
  }
  const on = app.remembersSpace;
  return h('div', { class: 'settings-body' },
    h('div', { class: ['card', 'card-pad', 'settings-status', on && 'is-on'] },
      icon(on ? 'checkCircle' : 'circle'),
      h('p', null, on
        ? 'Este dispositivo recuerda vuestro espacio y lo abre directamente, también desde el icono de la pantalla de inicio.'
        : 'Este dispositivo no recuerda vuestro espacio: solo se abre con el enlace.')),
    on
      ? actionList('Olvidar en este dispositivo', () => {
        app.forgetDevice();
        app.toast('Este dispositivo ya no recordará vuestro espacio.');
        app.render();
      }, { danger: true, fk: 'device-memory' })
      : actionList('Recordar en este dispositivo', () => {
        app.rememberDevice();
        app.toast('Este dispositivo recordará vuestro espacio.');
        app.render();
      }, { fk: 'device-memory' }),
    note('Algunos móviles abren el acceso de la pantalla de inicio sin el enlace privado; si el dispositivo lo recuerda, entraréis igualmente. Se guarda solo aquí y nunca se envía a ningún sitio.'));
}

// ---------- Sobre Rumbo ----------

function renderAbout(app) {
  const space = app.state.space || {};
  const isDemo = flag(space.is_demo);
  return h('div', { class: 'settings-body' },
    h('div', { class: 'about-head' },
      appLogo(72, 'about-logo'),
      h('p', { class: 'about-name' }, 'Rumbo'),
      h('p', { class: 'about-text' }, 'Ahorros, objetivos y tareas en común para dos personas.')),
    isDemo ? notice('info',
      h('p', null, h('strong', null, 'Espacio de demostración. '), 'Todos los datos son ficticios y el espacio se borra automáticamente pasadas 24 horas. Podéis probar lo que queráis.'),
      button('Crear vuestro espacio real', () => app.goHome(), { variant: 'primary', small: true, dataset: { fk: 'create-real' } })) : null,
    facts([['Espacio creado', formatDateTime(space.created_at) || '—']]),
    note(app.backendKind === 'pglite'
      ? 'Modo de pruebas locales: los datos están en la base de datos de este navegador.'
      : 'Los datos se guardan en vuestra base de datos de Supabase. El enlace solo está en la dirección de esta página y, si lo permitís, en la memoria de este dispositivo; nunca se envía a terceros.'));
}

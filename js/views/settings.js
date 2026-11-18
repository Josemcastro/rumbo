// Vista «Ajustes»: nombres, enlace del espacio (copiar, compartir, regenerar) y modo demo.

import { h, button, linkBox, notice } from '../ui.js';
import { formatDateTime } from '../format.js';
import { flag } from '../labels.js';
import { spaceLink } from '../router.js';
import { openNamesForm, openRegenerate } from '../forms/settings.js';

export function renderSettings(app) {
  const space = app.state.space || {};
  const names = app.names();
  const isDemo = flag(space.is_demo);

  return h('div', { class: 'view' },
    h('header', { class: 'view-head view-head-center' }, h('h1', { class: 'view-title' }, 'Ajustes')),

    isDemo ? notice('info',
      h('p', null, h('strong', null, 'Espacio de demostración. '), 'Todos los datos son ficticios y el espacio se borra automáticamente pasadas 24 horas. Podéis probar lo que queráis.'),
      button('Crear vuestro espacio real', () => app.goHome(), { variant: 'primary', small: true })) : null,

    h('section', { class: 'section card card-pad', 'aria-labelledby': 'names-heading' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'names-heading', class: 'section-title' }, 'Vosotros'),
        button('Editar', () => openNamesForm(app), { variant: 'plain', small: true, iconName: 'pencil', dataset: { fk: 'edit-names' } })),
      h('dl', { class: 'facts' },
        h('div', { class: 'fact' }, h('dt', null, 'Primera persona'), h('dd', null, space.name_a ? names.a : 'Sin nombre')),
        h('div', { class: 'fact' }, h('dt', null, 'Segunda persona'), h('dd', null, space.name_b ? names.b : 'Sin nombre'))),
      h('p', { class: 'muted small' }, 'Los nombres se usan para indicar de quién es cada aportación, para quién es cada objetivo y quién se encarga de cada tarea.')),

    h('section', { class: 'section card card-pad', 'aria-labelledby': 'link-heading' },
      h('h2', { id: 'link-heading', class: 'section-title' }, 'Enlace del espacio'),
      h('p', { class: 'muted small' }, 'Cualquier persona con este enlace puede ver y editar vuestro espacio.'),
      linkBox(spaceLink(app.secret), { toastFn: app.toast }),
      isDemo ? null : h('div', { class: 'device-memory' },
        h('p', { class: 'muted small' }, app.remembersSpace
          ? 'Este dispositivo recuerda vuestro espacio y lo abre directamente, también desde el icono de la pantalla de inicio.'
          : 'Este dispositivo no recuerda vuestro espacio: solo se abre con el enlace.'),
        app.remembersSpace
          ? button('Olvidar en este dispositivo', () => { app.forgetDevice(); app.toast('Este dispositivo ya no recordará vuestro espacio.'); app.render(); }, { variant: 'plain', small: true, extraClass: 'btn-inline', dataset: { fk: 'forget-device' } })
          : button('Recordar en este dispositivo', () => { app.rememberDevice(); app.toast('Este dispositivo recordará vuestro espacio.'); app.render(); }, { variant: 'plain', small: true, extraClass: 'btn-inline', dataset: { fk: 'remember-device' } })),
      h('div', { class: 'danger-zone' },
        h('h3', { class: 'subsection-title' }, 'Regenerar enlace'),
        h('p', { class: 'muted small' }, 'Crea un enlace nuevo y anula el actual. Úsalo si el enlace se ha compartido con alguien que no debería tenerlo.'),
        button('Regenerar enlace', () => openRegenerate(app), { variant: 'danger-outline', small: true, iconName: 'refresh', dataset: { fk: 'regenerate' } }))),

    h('section', { class: 'section', 'aria-labelledby': 'about-heading' },
      h('h2', { id: 'about-heading', class: 'section-title' }, 'Sobre este espacio'),
      h('p', { class: 'muted small' }, `Creado el ${formatDateTime(space.created_at) || '—'}.`),
      h('p', { class: 'muted small' }, app.backendKind === 'pglite'
        ? 'Modo de pruebas locales: los datos están en la base de datos de este navegador.'
        : 'Los datos se guardan en vuestra base de datos de Supabase. El enlace solo está en la dirección de esta página y, si lo permitís, en la memoria de este dispositivo; nunca se envía a terceros.')));
}

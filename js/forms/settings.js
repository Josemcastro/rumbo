// Formularios de Ajustes: nombres de los miembros y regenerar el enlace.

import { h, formSheet, confirmSheet, field, textInput, notice, conflictFieldNames } from '../ui.js';
import { generateSecret } from '../api.js';

const NAME_MAX = 40;

export function openNamesForm(app) {
  const space = app.state.space;
  let base = { name_a: space.name_a || '', name_b: space.name_b || '' };
  const inputA = textInput({ maxlength: NAME_MAX, value: base.name_a, autocomplete: 'given-name' });
  const inputB = textInput({ maxlength: NAME_MAX, value: base.name_b, autocomplete: 'off' });

  formSheet(app, {
    title: 'Vuestros nombres',
    initialFocus: inputA,
    intro: 'Así aparecerán en aportaciones, objetivos y tareas.',
    build(form) {
      form.append(
        field({ label: 'Primera persona', control: inputA, name: 'name_a', hint: `Hasta ${NAME_MAX} caracteres.` }),
        field({ label: 'Segunda persona', control: inputB, name: 'name_b', hint: `Hasta ${NAME_MAX} caracteres.` }));
    },
    async onSubmit(ctx) {
      const values = { name_a: inputA.value.trim(), name_b: inputB.value.trim() };
      let bad = false;
      for (const [k, v] of Object.entries(values)) {
        if (v.length > NAME_MAX) { ctx.fieldError(k, `Usa como máximo ${NAME_MAX} caracteres.`); bad = true; }
      }
      if (bad) return false;
      const changes = {};
      const sentBase = {};
      for (const k of Object.keys(values)) {
        if (values[k] !== base[k]) { changes[k] = values[k]; sentBase[k] = base[k]; }
      }
      if (!Object.keys(changes).length) return true;
      await app.mutate('set_names', { changes, base: sentBase }, ctx.opId);
      return true;
    },
    onConflict(err) {
      const current = (err && err.current) || app.state.space || {};
      const fresh = { name_a: current.name_a || '', name_b: current.name_b || '' };
      for (const name of conflictFieldNames(err)) {
        if (name === 'name_a') inputA.value = fresh.name_a;
        if (name === 'name_b') inputB.value = fresh.name_b;
      }
      base = fresh;
    },
  });
}

export function openRegenerate(app) {
  const newSecret = generateSecret();
  confirmSheet(app, {
    title: 'Regenerar enlace',
    message: [
      notice('warning', 'El enlace actual y cualquier copia dejarán de funcionar en todos los dispositivos. Tendréis que compartir el nuevo.'),
      h('p', null, 'Este dispositivo pasará a usar el enlace nuevo automáticamente. Después, cópialo y envíaselo a la otra persona.'),
    ],
    confirmLabel: 'Regenerar enlace',
    danger: true,
    successMessage: 'Enlace regenerado. Compartid el nuevo enlace.',
    async onConfirm(ctx) {
      await app.regenerate(newSecret, ctx.opId);
      return true;
    },
  });
}

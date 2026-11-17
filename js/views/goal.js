// Vista de detalle de un objetivo: datos, resumen económico, tareas, historial y notas.

import { h, icon, button, menuButton, progressBar, notice, nextId } from '../ui.js';
import { formatCents, formatPercent, formatDate, formatDateShort, formatDateTime, monthlyEstimate, todayISO, plural } from '../format.js';
import {
  PRIORITY_LABELS, FUNDING_LABELS, FUNDING_ICONS, beneficiaryLabel, assigneeLabel, flag,
} from '../labels.js';
import { computed, statusBadge, fundingLine } from './cards.js';
import { movementList } from './movements.js';
import { renderMissing } from './tab.js';
import { openContribution, openRelease, openTransfer, openPayment } from '../forms/money.js';
import {
  openGoalEdit, openBudgetForm, openMoveTab, openStatusChange, openDeleteGoal, setGoalStatus,
} from '../forms/goal.js';
import { openTaskEdit, openTaskDelete, createTaskInline } from '../forms/tasks.js';

export function renderGoalView(app) {
  const goal = app.goal(app.route.id);
  if (!goal) return renderMissing(app, 'Este objetivo ya no existe', 'Puede que se haya eliminado desde otro dispositivo.');
  const c = computed(goal);
  const names = app.names();
  const tab = app.tab(goal.tab_id);
  const backRoute = tab ? { name: 'tab', id: tab.id } : { name: 'summary' };

  return h('div', { class: 'view goal-view' },
    h('a', { class: 'back-link', href: app.href(backRoute) }, icon('chevronLeft'), h('span', null, tab ? tab.name : 'Resumen')),
    header(app, goal, names, tab),
    c.ready_to_complete
      ? notice('success',
        h('p', null, h('strong', null, 'Listo para marcar como cumplido. '), 'La meta está cubierta y no quedan tareas pendientes.'),
        button('Marcar como cumplido', () => openStatusChange(app, goal.id, 'done'), { variant: 'primary', small: true, dataset: { fk: 'ready-done' } }))
      : null,
    moneySection(app, goal),
    tasksSection(app, goal, names),
    historySection(app, goal),
    goal.notes ? h('section', { class: 'section', 'aria-labelledby': 'notes-heading' },
      h('h2', { id: 'notes-heading', class: 'section-title' }, 'Notas'),
      h('p', { class: 'prewrap card card-pad' }, goal.notes)) : null,
    h('p', { class: 'muted small last-activity' }, icon('clock'),
      `Última actividad: ${formatDateTime(c.last_activity_at || goal.last_activity_at || goal.updated_at) || '—'}`));
}

function header(app, goal, names) {
  const s = goal.status;
  const items = [
    { label: 'Editar', icon: 'pencil', onSelect: () => openGoalEdit(app, goal.id) },
    { label: goal.budget_items && goal.budget_items.length ? 'Editar desglose' : 'Añadir desglose', icon: 'list', onSelect: () => openBudgetForm(app, goal.id) },
    { label: 'Mover a otra pestaña', icon: 'folder', onSelect: () => openMoveTab(app, goal.id) },
    s === 'active' ? { label: 'Pausar', icon: 'pause', onSelect: () => setGoalStatus(app, goal.id, 'paused') } : null,
    s === 'paused' ? { label: 'Reactivar', icon: 'play', onSelect: () => setGoalStatus(app, goal.id, 'active') } : null,
    s === 'active' || s === 'paused' ? { label: 'Marcar como cumplido', icon: 'checkCircle', onSelect: () => openStatusChange(app, goal.id, 'done') } : null,
    s === 'done' || s === 'archived' ? { label: 'Reabrir', icon: 'undo', onSelect: () => setGoalStatus(app, goal.id, 'active') } : null,
    s !== 'archived' ? { label: 'Archivar', icon: 'archive', onSelect: () => openStatusChange(app, goal.id, 'archived') } : null,
    { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => openDeleteGoal(app, goal.id) },
  ];

  const facts = [
    ['Pestaña', app.tabName(goal.tab_id) || '—'],
    ['Prioridad', PRIORITY_LABELS[goal.priority] || 'Media'],
    ['Para', beneficiaryLabel(names, goal.beneficiary)],
    ['Fecha deseada', goal.desired_date ? formatDate(goal.desired_date) : 'Sin fecha'],
  ];

  return h('header', { class: 'view-head goal-head' },
    h('div', { class: 'goal-head-row' },
      h('h1', { class: 'view-title' }, goal.name),
      menuButton({ label: 'Acciones', iconName: 'more', items, buttonClass: 'btn btn-secondary btn-small', dataset: { fk: 'goal-actions' } })),
    goal.description ? h('p', { class: 'view-sub' }, goal.description) : null,
    h('div', { class: 'goal-status-row' }, statusBadge(s)),
    h('dl', { class: 'facts' }, facts.map(([k, v]) => h('div', { class: 'fact' }, h('dt', null, k), h('dd', null, v)))));
}

function moneySection(app, goal) {
  const c = computed(goal);
  const funding = fundingLine(goal);
  const open = goal.status === 'active' || goal.status === 'paused';
  const rows = [
    ['Meta', c.target_cents],
    ['Reservado', c.reserved_cents],
    ['Ya pagado', c.paid_cents],
    ['Pendiente', c.pending_cents],
  ];
  if (c.surplus_cents > 0) rows.push(['Excedente', c.surplus_cents]);

  let estimate = null;
  if (open) {
    const est = monthlyEstimate(c.pending_cents, goal.desired_date, todayISO());
    if (est && est.overdue) {
      estimate = notice('warning', 'Fecha pendiente de revisar: la fecha deseada ya ha pasado y aún falta dinero.');
    } else if (est && est.dueToday) {
      estimate = notice('warning', `La fecha deseada es hoy y aún faltan ${formatCents(c.pending_cents)}.`);
    } else if (est) {
      estimate = h('p', { class: 'estimate' }, icon('calendar'),
        h('span', null, h('strong', null, `Unos ${formatCents(est.perMonthCents)} al mes durante ${plural(est.months, 'mes', 'meses')}`),
          ' — pendiente dividido entre los meses que quedan, sin contar intereses.'));
    }
  }

  const items = goal.budget_items || [];
  const breakdown = items.length
    ? h('div', { class: 'breakdown' },
      h('h3', { class: 'subsection-title' }, 'Desglose del presupuesto'),
      h('ul', { class: 'breakdown-list' },
        items.map((it) => h('li', null, h('span', null, it.label), h('span', { class: 'num' }, formatCents(it.amount_cents)))),
        h('li', { class: 'breakdown-total' }, h('span', null, 'Total'), h('span', { class: 'num' }, formatCents(c.target_cents)))))
    : null;

  const reserved = c.reserved_cents || 0;
  const moneyMenu = menuButton({
    label: 'Más acciones de dinero',
    iconName: 'more',
    iconOnly: true,
    buttonClass: 'btn btn-secondary btn-icon',
    dataset: { fk: 'money-more' },
    items: [
      { label: 'Liberar reserva', icon: 'unlock', disabled: reserved <= 0, onSelect: () => openRelease(app, goal.id) },
      { label: 'Mover a otro objetivo', icon: 'transfer', disabled: reserved <= 0, onSelect: () => openTransfer(app, goal.id) },
      { label: 'Registrar pago', icon: 'card', disabled: goal.status === 'archived', onSelect: () => openPayment(app, goal.id) },
    ],
  });

  return h('section', { class: 'section card card-pad', 'aria-labelledby': 'money-heading' },
    h('div', { class: 'section-head' },
      h('h2', { id: 'money-heading', class: 'section-title' }, 'Dinero'),
      h('span', { class: ['funding', `funding-${funding.tone}`] }, icon(FUNDING_ICONS[c.funding_status] || 'circle'), FUNDING_LABELS[c.funding_status] || '')),
    h('dl', { class: 'money-grid' }, rows.map(([label, value]) => h('div', { class: 'money-cell' }, h('dt', null, label), h('dd', null, formatCents(value || 0))))),
    progressBar(c.percent_capped, { label: `Progreso de ${goal.name}`, valueText: `${formatPercent(c.percent)}, ${formatCents(c.covered_cents || 0)} de ${formatCents(c.target_cents || 0)}` }),
    h('div', { class: 'goal-card-row' },
      h('span', { class: 'goal-card-percent' }, formatPercent(c.percent)),
      h('span', { class: ['funding', `funding-${funding.tone}`] }, icon(funding.iconName), funding.text)),
    estimate,
    breakdown,
    h('div', { class: 'button-row' },
      open ? button('Añadir aportación', () => openContribution(app, goal.id), { variant: 'primary', iconName: 'plus', dataset: { fk: 'goal-contrib' } }) : null,
      moneyMenu));
}

function tasksSection(app, goal, names) {
  const c = computed(goal);
  const tasks = goal.tasks || [];
  const hideDone = !!app.prefs.get('hideDone', false);
  const visible = hideDone ? tasks.filter((t) => !flag(t.done)) : tasks;
  const today = todayISO();
  const ids = tasks.map((t) => t.id);

  function move(task, dir) {
    const vi = visible.indexOf(task);
    const neighbor = visible[vi + dir];
    if (!neighbor) return;
    const order = ids.slice();
    const i = order.indexOf(task.id);
    const j = order.indexOf(neighbor.id);
    order[i] = neighbor.id;
    order[j] = task.id;
    app.run('reorder_tasks', { goal_id: goal.id, order }, { success: null });
  }

  function toggle(task, input) {
    const key = `pending-task-${task.id}`;
    const was = flag(task.done);
    if (app.memory.get(key)) { input.checked = !input.checked; return; }
    app.memory.set(key, true);
    input.setAttribute('aria-busy', 'true');
    app.run('update_task', { id: task.id, changes: { done: input.checked }, base: { done: was } }, { success: null })
      .then((ok) => {
        app.memory.delete(key);
        const el = document.querySelector(`[data-fk="task-check-${task.id}"]`);
        if (el) {
          el.removeAttribute('aria-busy');
          if (!ok) el.checked = was;
        }
      });
  }

  const list = h('ul', { class: 'task-list' }, visible.map((task, index) => {
    const done = flag(task.done);
    const cbId = nextId('task');
    const meta = [];
    const who = assigneeLabel(names, task.assignee);
    if (who) meta.push(h('span', null, icon('user'), who));
    if (task.due_date) {
      const overdue = !done && task.due_date < today;
      meta.push(h('span', { class: overdue ? 'is-late' : null }, icon('calendar'),
        overdue ? `Venció el ${formatDateShort(task.due_date, today)}` : `Para el ${formatDateShort(task.due_date, today)}`));
    }
    const input = h('input', { type: 'checkbox', id: cbId, checked: done, dataset: { fk: `task-check-${task.id}` } });
    input.addEventListener('change', () => toggle(task, input));
    return h('li', { class: ['task', done && 'is-done'] },
      input,
      h('div', { class: 'task-main' },
        h('label', { for: cbId, class: 'task-title' }, task.title),
        meta.length ? h('p', { class: 'task-meta' }, meta) : null,
        task.note ? h('p', { class: 'task-note' }, task.note) : null),
      menuButton({
        label: `Más opciones de «${task.title}»`,
        iconName: 'more',
        iconOnly: true,
        buttonClass: 'icon-btn',
        dataset: { fk: `task-more-${task.id}` },
        items: [
          { label: 'Editar', icon: 'pencil', onSelect: () => openTaskEdit(app, task.id) },
          { label: 'Subir', icon: 'arrowUp', disabled: index === 0, onSelect: () => move(task, -1) },
          { label: 'Bajar', icon: 'arrowDown', disabled: index === visible.length - 1, onSelect: () => move(task, 1) },
          { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => openTaskDelete(app, task.id) },
        ],
      }));
  }));

  const hideId = nextId('hide');
  const hideToggle = tasks.some((t) => flag(t.done))
    ? h('div', { class: 'check-inline' },
      h('input', { type: 'checkbox', id: hideId, checked: hideDone, dataset: { fk: 'hide-done' }, onChange: (e) => { app.prefs.set('hideDone', e.target.checked); app.render(); } }),
      h('label', { for: hideId }, 'Ocultar completadas'))
    : null;

  const summary = c.tasks_total > 0
    ? `${c.tasks_done} de ${c.tasks_total} tareas · ${formatPercent(c.tasks_percent)}`
    : null;

  return h('section', { class: 'section', 'aria-labelledby': 'tasks-heading' },
    h('div', { class: 'section-head' },
      h('h2', { id: 'tasks-heading', class: 'section-title' }, 'Tareas'),
      summary ? h('span', { class: 'muted' }, summary) : null),
    hideToggle,
    tasks.length
      ? (visible.length ? list : h('p', { class: 'muted' }, 'Todas las tareas están completadas.'))
      : h('p', { class: 'muted' }, 'Aún no hay pasos. Apuntad lo que falta por hacer para conseguir este objetivo.'),
    createTaskInline(app, goal.id, { label: tasks.length ? 'Añadir una tarea…' : 'Añadir pasos' }));
}

function historySection(app, goal) {
  const movements = app.state.movements.filter((m) => m.goal_id === goal.id || m.to_goal_id === goal.id);
  return h('section', { class: 'section', 'aria-labelledby': 'goal-history-heading' },
    h('h2', { id: 'goal-history-heading', class: 'section-title' }, 'Historial del objetivo'),
    movementList(app, movements, { goalId: goal.id, key: `goal-${goal.id}`, emptyText: 'Aún no hay movimientos en este objetivo.' }));
}

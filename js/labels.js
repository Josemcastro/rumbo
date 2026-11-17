// Textos de la interfaz derivados de valores del modelo (estados, prioridades, tipos…).

export const STATUS_LABELS = { active: 'Activo', paused: 'En pausa', done: 'Cumplido', archived: 'Archivado' };
export const STATUS_ICONS = { active: 'circle', paused: 'pause', done: 'checkCircle', archived: 'archive' };
export const PRIORITY_LABELS = { high: 'Alta', medium: 'Media', low: 'Baja' };
export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
export const FUNDING_LABELS = { none: 'Sin ahorro', progress: 'En progreso', funded: 'Financiado' };
export const FUNDING_ICONS = { none: 'circle', progress: 'clock', funded: 'checkCircle' };

export const FILTER_OPTIONS = [
  { value: 'active', label: 'Activos' },
  { value: 'paused', label: 'En pausa' },
  { value: 'done', label: 'Cumplidos' },
  { value: 'archived', label: 'Archivados' },
  { value: 'all', label: 'Todos' },
];

export const SORT_OPTIONS = [
  { value: 'priority', label: 'Prioridad' },
  { value: 'date', label: 'Fecha deseada' },
  { value: 'progress', label: 'Progreso económico' },
];

/** Nombres visibles de los dos miembros (con alternativa si están vacíos). */
export function memberNames(space) {
  const a = (space && space.name_a || '').trim();
  const b = (space && space.name_b || '').trim();
  return { a: a || 'Persona A', b: b || 'Persona B' };
}

export function beneficiaryLabel(names, value) {
  if (value === 'a') return names.a;
  if (value === 'b') return names.b;
  return 'Ambos';
}

export function assigneeLabel(names, value) {
  if (value === 'a') return names.a;
  if (value === 'b') return names.b;
  if (value === 'both') return 'Ambos';
  return '';
}

export function attributionLabel(names, value) {
  if (value === 'a') return names.a;
  if (value === 'b') return names.b;
  if (value === 'joint') return 'Conjunta';
  return 'Sin indicar';
}

export function attributionOptions(names) {
  return [
    { value: 'joint', label: 'Conjunta' },
    { value: 'a', label: names.a },
    { value: 'b', label: names.b },
    { value: '', label: 'Sin indicar' },
  ];
}

/** Nombre legible del tipo de movimiento. */
export function kindLabel(m) {
  switch (m.kind) {
    case 'deposit': return flag(m.is_initial) ? 'Ahorros iniciales' : 'Ahorro';
    case 'deposit_to_goal': return 'Ahorro asignado';
    case 'allocate': return 'Asignación';
    case 'release': return 'Liberación';
    case 'transfer': return 'Movimiento entre objetivos';
    case 'payment': return 'Pago';
    case 'withdrawal': return 'Salida';
    default: return m.kind;
  }
}

export const KIND_ICONS = {
  deposit: 'arrowIn', deposit_to_goal: 'arrowIn', allocate: 'wallet', release: 'unlock',
  transfer: 'transfer', payment: 'card', withdrawal: 'arrowOut',
};

/** Signo del movimiento respecto a los ahorros totales: +1 entra, −1 sale, 0 interno. */
export function totalSign(kind) {
  if (kind === 'deposit' || kind === 'deposit_to_goal') return 1;
  if (kind === 'payment' || kind === 'withdrawal') return -1;
  return 0;
}

/** Signo del movimiento respecto a la reserva de un objetivo concreto. */
export function goalSign(m, goalId) {
  switch (m.kind) {
    case 'deposit_to_goal':
    case 'allocate': return 1;
    case 'release':
    case 'payment': return -1;
    case 'transfer': return m.to_goal_id === goalId ? 1 : -1;
    default: return 0;
  }
}

/** Interpreta un booleano que puede llegar como true/false, 1/0 o 't'/'f'. */
export function flag(value) {
  return value === true || value === 1 || value === 't' || value === 'true';
}

export const STATUS_DESCRIPTIONS = {
  active: 'Objetivo activo',
  paused: 'Objetivo en pausa',
  done: 'Objetivo cumplido',
  archived: 'Objetivo archivado',
};

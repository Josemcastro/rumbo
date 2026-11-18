// Rutas dentro del fragmento de la URL (la parte tras «#», que nunca llega a ningún servidor):
//   #<secreto>                     → Resumen
//   #<secreto>/objetivos           → Objetivos (todas las pestañas)
//   #<secreto>/objetivos/<id>      → Objetivos de una pestaña
//   #<secreto>/objetivo/<id>       → Detalle de un objetivo
//   #<secreto>/ahorros             → Ahorros
//   #<secreto>/ajustes             → Ajustes
//   #<secreto>/ajustes/<sección>   → Una página de Ajustes (vosotros, apariencia, pestanas…)
//   #<secreto>/bienvenida          → Enlace recién creado (antes de entrar en el espacio)
// Compatibilidad: la ruta antigua #<secreto>/tab/<id> lleva a #<secreto>/objetivos/<id>.

/** Páginas de Ajustes (el valor es el fragmento de la URL); las mismas claves que PAGES en js/views/settings.js. */
export const SETTINGS_SECTIONS = ['vosotros', 'pestanas', 'enlace', 'apariencia', 'dispositivo', 'sobre'];

const isId = (value) => /^\d+$/.test(value || '');

/**
 * Lee el fragmento. Devuelve { secret, route, legacy }; `legacy` indica que la dirección
 * usaba una ruta antigua y conviene reescribirla con buildHash().
 */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return { secret: null, route: { name: 'home' }, legacy: false };
  const [secret, section, id] = raw.split('/');
  let route;
  let legacy = false;
  if (!section) route = { name: 'summary' };
  else if (section === 'objetivos') route = isId(id) ? { name: 'goals', id: Number(id) } : { name: 'goals' };
  else if (section === 'objetivo' && isId(id)) route = { name: 'goal', id: Number(id) };
  else if (section === 'ahorros') route = { name: 'savings' };
  else if (section === 'ajustes') route = SETTINGS_SECTIONS.includes(id) ? { name: 'settings', section: id } : { name: 'settings' };
  else if (section === 'bienvenida') route = { name: 'welcome' };
  else if (section === 'tab' && isId(id)) { route = { name: 'goals', id: Number(id) }; legacy = true; }
  else route = { name: 'summary' };
  return { secret, route, legacy };
}

export function routePath(route) {
  switch (route && route.name) {
    case 'goals': return route.id != null ? `/objetivos/${route.id}` : '/objetivos';
    case 'goal': return `/objetivo/${route.id}`;
    case 'savings': return '/ahorros';
    case 'settings': return route.section ? `/ajustes/${route.section}` : '/ajustes';
    case 'welcome': return '/bienvenida';
    default: return '';
  }
}

export function buildHash(secret, route) {
  return `#${secret}${routePath(route)}`;
}

export function sameRoute(a, b) {
  return !!a && !!b && a.name === b.name && (a.id ?? null) === (b.id ?? null) && (a.section ?? null) === (b.section ?? null);
}

/** Dirección base de la web (sin fragmento), válida en https://usuario.github.io/repo/. */
export function baseUrl() {
  return location.origin + location.pathname + location.search;
}

/** Enlace completo para compartir: <web>#<secreto>. */
export function spaceLink(secret) {
  return `${baseUrl()}#${secret}`;
}

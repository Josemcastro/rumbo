// Rutas dentro del fragmento de la URL (la parte tras «#», que nunca llega a ningún servidor):
//   #<secreto>                     → Resumen
//   #<secreto>/ahorros             → Ahorros
//   #<secreto>/tab/<id>            → Pestaña de objetivos
//   #<secreto>/objetivo/<id>       → Detalle de un objetivo
//   #<secreto>/ajustes             → Ajustes
//   #<secreto>/bienvenida          → Enlace recién creado (antes de abrir el dashboard)

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return { secret: null, route: { name: 'home' } };
  const [secret, section, id] = raw.split('/');
  let route;
  if (!section) route = { name: 'summary' };
  else if (section === 'ahorros') route = { name: 'savings' };
  else if (section === 'ajustes') route = { name: 'settings' };
  else if (section === 'bienvenida') route = { name: 'welcome' };
  else if (section === 'tab' && /^\d+$/.test(id || '')) route = { name: 'tab', id: Number(id) };
  else if (section === 'objetivo' && /^\d+$/.test(id || '')) route = { name: 'goal', id: Number(id) };
  else route = { name: 'summary' };
  return { secret, route };
}

export function routePath(route) {
  switch (route && route.name) {
    case 'savings': return '/ahorros';
    case 'settings': return '/ajustes';
    case 'welcome': return '/bienvenida';
    case 'tab': return `/tab/${route.id}`;
    case 'goal': return `/objetivo/${route.id}`;
    default: return '';
  }
}

export function buildHash(secret, route) {
  return `#${secret}${routePath(route)}`;
}

export function sameRoute(a, b) {
  return !!a && !!b && a.name === b.name && (a.id ?? null) === (b.id ?? null);
}

/** Dirección base de la web (sin fragmento), válida en https://usuario.github.io/repo/. */
export function baseUrl() {
  return location.origin + location.pathname + location.search;
}

/** Enlace completo para compartir: <web>#<secreto>. */
export function spaceLink(secret) {
  return `${baseUrl()}#${secret}`;
}

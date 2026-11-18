// Tema de la interfaz (Ajustes → Apariencia): automático (según el sistema), claro u oscuro.
// Es una preferencia de este dispositivo: se guarda en localStorage («rumbo.theme») y nunca
// sale de aquí. js/theme-boot.js la aplica antes de pintar (sin parpadeo); este módulo la
// lee y la cambia en caliente. Los colores de cada tema están en styles.css.

const KEY = 'rumbo.theme';
export const THEMES = ['auto', 'light', 'dark'];
export const THEME_LABELS = { auto: 'Automático', light: 'Claro', dark: 'Oscuro' };
// Color de la barra del navegador en cada tema (el fondo de la app, --bg).
const BAR_COLORS = { light: '#f5f5f7', dark: '#000000' };

/** Preferencia guardada en este dispositivo: 'auto' | 'light' | 'dark'. */
export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Guarda la preferencia (si se puede) y la aplica al momento. */
export function setThemePref(pref) {
  const value = THEMES.includes(pref) ? pref : 'auto';
  try { localStorage.setItem(KEY, value); } catch { /* sin almacenamiento: solo esta visita */ }
  applyTheme(value);
  return value;
}

/**
 * Aplica el tema: atributo data-theme en <html> (lo usan los tokens de styles.css),
 * <meta name="color-scheme"> para los controles nativos y <meta name="theme-color">
 * para la barra del navegador.
 */
export function applyTheme(pref) {
  const value = THEMES.includes(pref) ? pref : 'auto';
  document.documentElement.dataset.theme = value;
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', value === 'auto' ? 'light dark' : value);
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    // Cada meta lleva su media (claro u oscuro); con un tema fijo, las dos usan su color.
    const forDark = /dark/.test(meta.getAttribute('media') || '');
    meta.setAttribute('content', BAR_COLORS[value === 'auto' ? (forDark ? 'dark' : 'light') : value]);
  });
}

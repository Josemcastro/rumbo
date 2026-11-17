// Utilidades puras de formato y lectura para «Rumbo».
// Sin dependencias del DOM: se pueden probar en cualquier motor JS (ver tests/format-tests.html).
// Todos los importes se manejan como céntimos enteros; nunca se usan floats para dinero.

export const NBSP = ' ';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MAX_EURO_DIGITS = 9; // hasta 999.999.999,99 €

/** Agrupa una cadena de dígitos con puntos de miles: «1250» → «1.250». */
function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Formato manual de respaldo, idéntico al de Intl es-ES con agrupación siempre activa. */
function formatCentsManual(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  return (negative ? '-' : '') + groupThousands(String(euros)) + ',' + String(rest).padStart(2, '0') + NBSP + '€';
}

// Intl con `useGrouping: 'always'` (para que 4 cifras lleven punto: «1.250,50 €»).
// Los motores antiguos tratan 'always' como `true` y en es-ES no agrupan 4 cifras;
// por eso se comprueba con una sonda y, si no coincide, se usa el formato manual.
const currencyFormatter = (() => {
  try {
    const fmt = new Intl.NumberFormat('es-ES', {
      style: 'currency', currency: 'EUR', useGrouping: 'always',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const probe = fmt.format(1234.5).replace(/\s/g, NBSP);
    return probe === '1.234,50' + NBSP + '€' ? fmt : null;
  } catch {
    return null;
  }
})();

/** 125050 → «1.250,50 €» (espacio duro antes del símbolo). */
export function formatCents(cents) {
  const value = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  if (currencyFormatter) {
    return currencyFormatter.format(value / 100).replace(/\s/g, NBSP).replace('−', '-');
  }
  return formatCentsManual(value);
}

/** Importe con signo explícito para historiales: «+50,00 €», «−50,00 €». */
export function formatSignedCents(cents, sign) {
  const body = formatCents(Math.abs(cents));
  if (sign > 0) return '+' + body;
  if (sign < 0) return '−' + body;
  return body;
}

/** Céntimos → texto editable en un campo («1.250,50»), sin símbolo. */
export function centsToInput(cents) {
  if (!Number.isFinite(cents) || cents <= 0) return '';
  return formatCentsManual(cents).replace(NBSP + '€', '');
}

/**
 * Lee un importe escrito por una persona y lo devuelve en céntimos enteros (> 0),
 * o `null` si no es válido. Acepta «1.250,50», «1250,5», «1250.50», «12», «1.250»,
 * «1,250.50», con o sin «€». Rechaza negativos, cero, letras y más de 2 decimales.
 * No usa aritmética de coma flotante.
 */
export function parseAmount(input) {
  let s = String(input ?? '').trim().replace(/[\s  ]/g, '');
  s = s.replace(/^€/, '').replace(/€$/, '');
  if (!s || !/^[0-9.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart;
  let frac = '';

  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos separadores: el último es el decimal y el otro, de miles (en grupos de 3).
    const decSep = lastComma > lastDot ? ',' : '.';
    const thouSep = decSep === ',' ? '.' : ',';
    const idx = s.lastIndexOf(decSep);
    intPart = s.slice(0, idx);
    frac = s.slice(idx + 1);
    if (intPart.includes(decSep)) return null;
    const grouped = new RegExp('^\\d{1,3}(\\' + thouSep + '\\d{3})+$');
    if (!grouped.test(intPart)) return null;
    intPart = intPart.split(thouSep).join('');
  } else if (lastComma >= 0) {
    // Solo coma: separador decimal (uso español).
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    [intPart, frac] = parts;
  } else if (lastDot >= 0) {
    // Solo punto: decimal si hay 1–2 cifras detrás («1250.50»); de miles si son grupos de 3 («1.250»).
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      [intPart, frac] = parts;
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = parts.join('');
    } else {
      return null;
    }
  } else {
    intPart = s;
  }

  if (intPart === '') intPart = '0'; // «,50» → 0,50 €
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return null;
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (intPart.length > MAX_EURO_DIGITS) return null;
  const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  return cents > 0 ? cents : null;
}

/**
 * Porcentaje con un decimal y coma: 66.666 → «66,7 %», 100 → «100 %».
 * Nunca muestra «100 %» si aún no se ha llegado, ni «0 %» si ya hay algo.
 */
export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  let r = Math.round(value * 10) / 10;
  if (value < 100 && r >= 100) r = 99.9;
  if (value > 0 && r === 0) r = 0.1;
  const text = Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
  return text + NBSP + '%';
}

// ---------- Fechas ----------

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es «YYYY-MM-DD» una fecha real del calendario? */
export function isValidISODate(iso) {
  const m = ISO_DATE_RE.exec(String(iso ?? ''));
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= days;
}

function parts(iso) {
  const m = ISO_DATE_RE.exec(String(iso ?? ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** Fecha local de hoy como «YYYY-MM-DD» (o la de `now` si se indica). */
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** «2026-03-12» → «12 mar 2026». */
export function formatDate(iso) {
  const p = parts(iso);
  if (!p) return '';
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** «2026-03-03» → «3 mar» (añade el año si no es el de `today`). */
export function formatDateShort(iso, today = todayISO()) {
  const p = parts(iso);
  if (!p) return '';
  const t = parts(today);
  return t && t.y === p.y ? `${p.d} ${MONTHS[p.m - 1]}` : `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** «2026-03-12» → «12/03/2026». */
export function formatDateNumeric(iso) {
  const p = parts(iso);
  if (!p) return '';
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/**
 * Lee una marca de tiempo tal como la devuelve Postgres en JSON
 * («2026-03-12T14:05:09.123456+00:00», «2026-03-12 14:05:09+00», «2026-03-12T14:05:09Z»).
 * Recorta los microsegundos para que todos los navegadores la acepten. Devuelve Date o null.
 */
export function parseTimestamp(ts) {
  if (!ts) return null;
  let s = String(ts).trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  if (/T\d{2}:\d{2}/.test(s)) {
    s = s.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  }
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Marca de tiempo → «12 mar 2026, 14:05» en hora local. */
export function formatDateTime(isoTs) {
  const date = parseTimestamp(isoTs);
  if (!date) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(todayISO(date))}, ${hh}:${mm}`;
}

/** Meses completos entre dos fechas ISO (puede ser negativo). */
export function monthsBetween(fromIso, toIso) {
  const a = parts(fromIso); const b = parts(toIso);
  if (!a || !b) return 0;
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return months;
}

/**
 * Estimación de ahorro mensual para llegar a la fecha deseada.
 * Devuelve null si no hay fecha o no falta dinero; `{ overdue: true }` si la fecha ya
 * ha pasado; `{ overdue: false, dueToday: true }` si es hoy; o
 * `{ overdue: false, months, perMonthCents }` (mínimo 1 mes, redondeando al céntimo
 * hacia arriba). Sin intereses. Mismo criterio que la tarjeta: atrasado solo si fecha < hoy.
 */
export function monthlyEstimate(pendingCents, desiredIso, today = todayISO()) {
  if (!desiredIso || !isValidISODate(desiredIso) || !(pendingCents > 0)) return null;
  if (desiredIso < today) return { overdue: true };
  if (desiredIso === today) return { overdue: false, dueToday: true };
  const months = Math.max(1, monthsBetween(today, desiredIso));
  return { overdue: false, months, perMonthCents: Math.ceil(pendingCents / months) };
}

// ---------- Texto ----------

/** plural(3, 'tarea', 'tareas') → «3 tareas». */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Recorta un texto largo con «…». */
export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

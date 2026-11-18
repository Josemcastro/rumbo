// Iconos lineales (24×24, trazo 1,5) dibujados con el DOM de SVG.
// No usan innerHTML, así que cumplen la política de seguridad de contenidos.
// Cada forma es un trazado («d»), un círculo C(cx, cy, r) o un trazado relleno F(d).

const SVG_NS = 'http://www.w3.org/2000/svg';
const C = (cx, cy, r) => ({ c: [cx, cy, r] });
const F = (d) => ({ d, fill: true });

export const ICONS = {
  // Barra de navegación inferior y Ajustes (el logo de la app es la imagen icon.svg).
  target: [C(12, 12, 8.5), C(12, 12, 5), C(12, 12, 1.5)],
  gear: ['M10.14 5.51L10.34 3.05A9.1 9.1 0 0 1 13.66 3.05L13.86 5.51A6.75 6.75 0 0 1 15.27 6.1L17.15 4.5A9.1 9.1 0 0 1 19.5 6.85L17.9 8.73A6.75 6.75 0 0 1 18.49 10.14L20.95 10.34A9.1 9.1 0 0 1 20.95 13.66L18.49 13.86A6.75 6.75 0 0 1 17.9 15.27L19.5 17.15A9.1 9.1 0 0 1 17.15 19.5L15.27 17.9A6.75 6.75 0 0 1 13.86 18.49L13.66 20.95A9.1 9.1 0 0 1 10.34 20.95L10.14 18.49A6.75 6.75 0 0 1 8.73 17.9L6.85 19.5A9.1 9.1 0 0 1 4.5 17.15L6.1 15.27A6.75 6.75 0 0 1 5.51 13.86L3.05 13.66A9.1 9.1 0 0 1 3.05 10.34L5.51 10.14A6.75 6.75 0 0 1 6.1 8.73L4.5 6.85A9.1 9.1 0 0 1 6.85 4.5L8.73 6.1A6.75 6.75 0 0 1 10.14 5.51Z', C(12, 12, 2.75)],
  appearance: [C(12, 12, 8.5), F('M12 3.5a8.5 8.5 0 0 1 0 17z')],
  phone: ['M8.5 2.5h7a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z', 'M11 18.5h2'],
  plus: ['M12 5v14M5 12h14'],
  close: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  chevronLeft: ['M15 5l-7 7 7 7'],
  chevronRight: ['M9 5l7 7-7 7'],
  chevronDown: ['M6 9l6 6 6-6'],
  arrowUp: ['M12 19V5M6 11l6-6 6 6'],
  arrowDown: ['M12 5v14M6 13l6 6 6-6'],
  settings: ['M4 7h9M17 7h3M4 17h3M11 17h9', C(15, 7, 2), C(9, 17, 2)],
  more: [C(6, 12, 1), C(12, 12, 1), C(18, 12, 1)],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M10 11v6M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  calendar: ['M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3v4M16 3v4'],
  wallet: ['M4 7a2 2 0 0 1 2-2h11v4', 'M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z', C(16, 14.5, 1)],
  copy: ['M9 9h10v11H9z', 'M5 15V4h10'],
  share: ['M12 4v11', 'M8 8l4-4 4 4', 'M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'],
  refresh: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4h-4'],
  pause: ['M9 6v12M15 6v12'],
  play: ['M8 5l11 7-11 7z'],
  archive: ['M4 5h16v4H4z', 'M5 9v10h14V9', 'M10 13h4'],
  checkCircle: [C(12, 12, 8.5), 'M8.5 12.5l2.5 2.5 4.5-5'],
  circle: [C(12, 12, 8.5)],
  alert: [C(12, 12, 8.5), 'M12 8v5', 'M12 16v.01'],
  info: [C(12, 12, 8.5), 'M12 11v5', 'M12 8v.01'],
  clock: [C(12, 12, 8.5), 'M12 7.5V12l3 2'],
  flag: ['M6 21V4', 'M6 4h11l-2 4 2 4H6'],
  user: [C(12, 8, 3.5), 'M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5'],
  users: [C(9, 8, 3), 'M3.5 19c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5', C(16.5, 9, 2.5), 'M15.5 14.6c2.2-.3 4.2.9 5 3.4'],
  transfer: ['M4 8h14M14 4l4 4-4 4', 'M20 16H6M10 12l-4 4 4 4'],
  arrowOut: ['M7 17L17 7', 'M9 7h8v8'],
  arrowIn: ['M17 7L7 17', 'M15 17H7V9'],
  list: ['M9 7h11M9 12h11M9 17h11', 'M4.5 7h.01M4.5 12h.01M4.5 17h.01'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  folder: ['M4 6h6l2 2h8v11H4z'],
  unlock: ['M8 11V8a4 4 0 0 1 7.7-1.5', 'M5 11h14v9H5z'],
  card: ['M3 6h18v12H3z', 'M3 10h18', 'M7 15h4'],
  link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  home: ['M4 11l8-7 8 7', 'M6 9.5V20h12V9.5'],
  // Hucha: cuerpo con oreja y hocico (mira a la derecha), ranura, ojo y rabito.
  piggy: ['M17.5 8.2V5c-1.3 0-2.4.7-3 1.6A9 9 0 0 0 12 6.2C7.6 6.2 4.5 8.6 4.5 12c0 1.9 1 3.5 2.5 4.6V19h2.5v-1.5c.8.2 1.6.3 2.5.3s1.7-.1 2.5-.3V19h2.5v-2.4c.9-.6 1.6-1.4 2-2.3h1.5v-4h-1.3c-.3-.8-.9-1.5-1.7-2.1z', 'M10 9.2h3', 'M16 11h.01', 'M4.5 11.5c-1.1 0-2-.8-2-1.8'],
  cloud: ['M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z'],
  cloudOff: ['M7 18h10a4 4 0 0 0 1.6-.33', 'M20.5 14.5A4 4 0 0 0 17.5 10a6 6 0 0 0-8.3-4.6', 'M6.2 11.1A3.5 3.5 0 0 0 7 18', 'M4 4l16 16'],
  database: ['M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z', 'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6', 'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', C(12, 12, 3)],
  sparkle: ['M12 4v4M12 16v4M4 12h4M16 12h4'],
};

/** Icono SVG decorativo (aria-hidden). */
export function icon(name, extraClass = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${extraClass ? ' ' + extraClass : ''}`);
  for (const shape of ICONS[name] || []) {
    if (typeof shape === 'string' || shape.d) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', typeof shape === 'string' ? shape : shape.d);
      if (shape.fill) path.setAttribute('fill', 'currentColor');
      svg.append(path);
    } else {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(shape.c[0]));
      circle.setAttribute('cy', String(shape.c[1]));
      circle.setAttribute('r', String(shape.c[2]));
      svg.append(circle);
    }
  }
  return svg;
}

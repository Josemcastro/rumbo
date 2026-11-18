// Aplica el tema elegido en Ajustes → Apariencia ANTES de pintar la página, para que no haya
// un destello del otro tema al abrir. Es un script clásico (sin módulos ni defer) que se carga
// en el <head>; la lógica completa está en js/theme.js, que usa los mismos valores.
(function () {
  var pref = 'auto';
  try {
    var saved = localStorage.getItem('rumbo.theme');
    if (saved === 'light' || saved === 'dark' || saved === 'auto') pref = saved;
  } catch (e) { /* sin almacenamiento: se sigue el tema del sistema */ }
  var root = document.documentElement;
  root.setAttribute('data-theme', pref);
  if (pref === 'auto') return;
  var color = pref === 'dark' ? '#000000' : '#f5f5f7';
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', pref);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', color);
})();

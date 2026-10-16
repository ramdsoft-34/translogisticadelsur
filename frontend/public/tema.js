// Aplica el tema guardado (o el del sistema) antes de pintar la página, para evitar el parpadeo.
(function () {
  var t = null;
  try { t = localStorage.getItem('tls_tema'); } catch (e) { /* sin almacenamiento */ }
  // El inicio de sesión sigue siempre la apariencia del sistema.
  var login = location.pathname === '/' || location.pathname.indexOf('/ingresar') === 0;
  if (login || (t !== 'claro' && t !== 'oscuro')) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  document.documentElement.setAttribute('data-tema', t);
})();

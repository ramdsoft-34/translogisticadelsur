import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEsCo from '@angular/common/locales/es-CO';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptor';

registerLocaleData(localeEsCo);

// Un módulo de una versión anterior que ya no se puede descargar deja la pantalla anterior congelada:
// se recarga una sola vez en la dirección pedida para tomar la versión vigente.
function alFallarNavegacion(e: { url: string; error: unknown }) {
  if (!/chunk|dynamically imported module|module script|Failed to fetch/i.test(String((e.error as Error)?.message || e.error))) return;
  try {
    if (sessionStorage.getItem('recarga-navegacion') === e.url) { sessionStorage.removeItem('recarga-navegacion'); return; }
    sessionStorage.setItem('recarga-navegacion', e.url);
  } catch { /* sin almacenamiento: se recarga igual */ }
  location.assign(e.url);
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withNavigationErrorHandler(alFallarNavegacion)),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: LOCALE_ID, useValue: 'es-CO' },
  ],
};

import { Component, inject } from '@angular/core';
import { NavigationError, Router, RouterOutlet } from '@angular/router';
import { Globales } from './shared/globales';

// Si se publicó una versión nueva mientras la página estaba abierta, una sección puede pedir un archivo
// que ya no existe: en vez de mostrar un error, se carga esa sección con la versión nueva (una sola vez).
const ARCHIVO_VIEJO = /dynamically imported module|Loading chunk|module script failed|error loading dynamically/i;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Globales],
  template: '<router-outlet /><app-globales />',
})
export class App {
  constructor() {
    inject(Router).events.subscribe(ev => {
      if (!(ev instanceof NavigationError) || !ARCHIVO_VIEJO.test(String(ev.error?.message || ev.error))) return;
      const clave = 'tls_recarga_version';
      let ultima = 0;
      try { ultima = Number(sessionStorage.getItem(clave)) || 0; } catch { /* sin almacenamiento */ }
      if (Date.now() - ultima < 30000) return;                 // evita recargas en bucle
      try { sessionStorage.setItem(clave, String(Date.now())); } catch { /* sin almacenamiento */ }
      location.assign(ev.url);
    });
  }
}

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth.service';

export const conSesion: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.usuario() ? true : inject(Router).parseUrl('/ingresar');
};

export const sinSesion: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.usuario() ? inject(Router).parseUrl(auth.inicio()) : true;
};

// Exige alguno de los permisos indicados en `data.permisos` de la ruta.
export const conPermiso: CanActivateFn = (ruta) => {
  const auth = inject(Auth);
  const permisos: string[] = ruta.data?.['permisos'] || [];
  return !permisos.length || auth.tiene(...permisos) ? true : inject(Router).parseUrl(auth.inicio());
};

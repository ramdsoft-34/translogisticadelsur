import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth.service';

// La sesión vive en una cookie HttpOnly: si la página se recargó, se recupera preguntando al servidor
export const conSesion: CanActivateFn = async () => {
  const auth = inject(Auth); const router = inject(Router);
  return (await auth.restaurar()) ? true : router.parseUrl('/ingresar');
};

export const sinSesion: CanActivateFn = async () => {
  const auth = inject(Auth); const router = inject(Router);
  return (await auth.restaurar()) ? router.parseUrl(auth.inicio()) : true;
};

// Exige alguno de los permisos indicados en `data.permisos` de la ruta.
export const conPermiso: CanActivateFn = (ruta) => {
  const auth = inject(Auth);
  const permisos: string[] = ruta.data?.['permisos'] || [];
  return !permisos.length || auth.tiene(...permisos) ? true : inject(Router).parseUrl(auth.inicio());
};

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { Auth } from './auth.service';

// Agrega el token y cierra la sesión si el servidor la rechaza.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const token = auth.token();
  const r = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(r).pipe(catchError((e: HttpErrorResponse) => {
    if (e.status === 401 && token && !req.url.endsWith('/auth/login')) auth.salir(false);
    return throwError(() => e);
  }));
};

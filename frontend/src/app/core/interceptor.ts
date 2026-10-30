import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, retry, throwError, timer } from 'rxjs';
import { Auth } from './auth.service';
import { ID_PESTANA } from './en-vivo.service';

// Esperas entre reintentos cuando el servidor no responde (p. ej. unos segundos mientras se publica una versión)
const ESPERAS = [700, 1500, 3000, 5000, 7000];

// Se reintenta solo cuando es seguro:
// - 502/503: el servidor no alcanzó a recibir la petición (se puede repetir cualquier método).
// - Sin conexión (0) o 504: solo consultas (GET/HEAD), para no duplicar un registro.
function reintentable(e: unknown, metodo: string) {
  if (!(e instanceof HttpErrorResponse)) return false;
  if (e.status === 502 || e.status === 503) return true;
  return (e.status === 0 || e.status === 504) && (metodo === 'GET' || metodo === 'HEAD');
}

// Envía la cookie de sesión y el id de la pestaña (que también protege contra CSRF), reintenta los cortes breves
// del servidor y cierra la sesión si el servidor la rechaza.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const r = req.clone({ withCredentials: true, setHeaders: { 'X-Cliente-Id': ID_PESTANA } });
  return next(r).pipe(
    retry({ count: ESPERAS.length, delay: (e, intento) => (reintentable(e, req.method) ? timer(ESPERAS[intento - 1]) : throwError(() => e)) }),
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && auth.usuario() && !req.url.endsWith('/auth/login')) auth.salir(false);
      return throwError(() => e);
    }),
  );
};

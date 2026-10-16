import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../core/auth.service';

// Lleva al inicio que corresponde al rol.
@Component({ selector: 'app-redirigir', template: '' })
export class Redirigir {
  constructor() {
    const auth = inject(Auth);
    inject(Router).navigateByUrl(auth.usuario()?.debeCambiarClave ? '/mi-cuenta' : auth.inicio(), { replaceUrl: true });
  }
}

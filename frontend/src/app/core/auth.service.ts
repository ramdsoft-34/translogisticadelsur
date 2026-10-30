import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './api.service';
import { Usuario } from './modelos';

// Sesión del usuario. El token va en una cookie HttpOnly que pone el servidor: el navegador no lo guarda en
// localStorage ni sessionStorage y JavaScript no lo puede leer. Al recargar la página, la sesión se recupera
// preguntando al servidor (/auth/yo). La clave del RNDC tampoco se guarda en el navegador (ver RndcClave).
@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private router = inject(Router);

  readonly usuario = signal<Usuario | null>(null);
  readonly esSuper = computed(() => this.usuario()?.rol === 'superadmin');
  private restaurando: Promise<Usuario | null> | null = null;

  // Recupera la sesión de la cookie (una sola consulta aunque la pidan varios guardias a la vez)
  restaurar(): Promise<Usuario | null> {
    if (this.usuario()) return Promise.resolve(this.usuario());
    if (!this.restaurando) {
      this.restaurando = this.api.get<Usuario>('/auth/yo')
        .then(u => { this.usuario.set(u); return u; })
        .catch(() => null)
        .finally(() => { this.restaurando = null; });
    }
    return this.restaurando;
  }

  // Con doble factor activo, la primera respuesta pide el código de la app (devuelve null)
  async ingresar(email: string, password: string, codigo?: string): Promise<Usuario | null> {
    const r = await this.api.post<{ usuario: Usuario; segundoFactor?: boolean }>('/auth/login', { email, password, ...(codigo ? { codigo } : {}) });
    if (r.segundoFactor) return null;
    this.usuario.set(r.usuario);
    return r.usuario;
  }

  // Tras activar el doble factor el servidor cierra las demás sesiones y deja una cookie nueva
  sesion(_token: string, usuario: Usuario) { this.usuario.set(usuario); }

  async refrescar() {
    this.usuario.set(await this.api.get<Usuario>('/auth/yo'));
  }

  async cambiarClave(actual: string, nueva: string) {
    const r = await this.api.post<{ usuario: Usuario }>('/auth/cambiar-clave', { actual, nueva });
    this.usuario.set(r.usuario);
  }

  async salir(llamarServidor = true) {
    if (llamarServidor && this.usuario()) { try { await this.api.post('/auth/salir'); } catch { /* ya expiró */ } }
    this.usuario.set(null);
    this.router.navigate(['/ingresar']);
  }

  tiene(...permisos: string[]) {
    const p = this.usuario()?.permisos || [];
    return permisos.some(x => p.includes(x));
  }

  inicio() {
    return this.esSuper() ? '/admin/empresas' : '/inicio';
  }
}

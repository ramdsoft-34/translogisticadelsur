import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './api.service';
import { Usuario } from './modelos';

const LLAVE = 'tls_sesion';

// Sesión del usuario. El token se guarda en sessionStorage (se borra al cerrar
// la pestaña); la clave del RNDC nunca se guarda (ver RndcClave).
@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private router = inject(Router);

  readonly usuario = signal<Usuario | null>(null);
  readonly token = signal<string>('');
  readonly esSuper = computed(() => this.usuario()?.rol === 'superadmin');

  constructor() {
    try {
      const s = JSON.parse(sessionStorage.getItem(LLAVE) || 'null');
      if (s?.token) { this.token.set(s.token); this.usuario.set(s.usuario); }
    } catch { /* sin sesión */ }
  }

  private guardar(token: string, usuario: Usuario) {
    this.token.set(token); this.usuario.set(usuario);
    try { sessionStorage.setItem(LLAVE, JSON.stringify({ token, usuario })); } catch { /* almacenamiento no disponible */ }
  }

  // Con doble factor activo, la primera respuesta pide el código de la app (devuelve null)
  async ingresar(email: string, password: string, codigo?: string): Promise<Usuario | null> {
    const r = await this.api.post<{ token: string; usuario: Usuario; segundoFactor?: boolean }>('/auth/login', { email, password, ...(codigo ? { codigo } : {}) });
    if (r.segundoFactor) return null;
    this.guardar(r.token, r.usuario);
    return r.usuario;
  }

  // Tras activar el doble factor el servidor cierra las demás sesiones y entrega un token nuevo
  sesion(token: string, usuario: Usuario) { this.guardar(token, usuario); }

  async refrescar() {
    const u = await this.api.get<Usuario>('/auth/yo');
    this.guardar(this.token(), u);
  }

  async cambiarClave(actual: string, nueva: string) {
    const r = await this.api.post<{ token: string; usuario: Usuario }>('/auth/cambiar-clave', { actual, nueva });
    this.guardar(r.token, r.usuario);
  }

  async salir(llamarServidor = true) {
    if (llamarServidor && this.token()) { try { await this.api.post('/auth/salir'); } catch { /* ya expiró */ } }
    this.token.set(''); this.usuario.set(null);
    try { sessionStorage.removeItem(LLAVE); } catch { /* nada */ }
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

import { DestroyRef, Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { Auth } from './auth.service';

export interface Cambio { recurso: string; ruta: string; metodo: string; origen: string; fecha: number }

// Identificador de esta pestaña: sus propios cambios no la hacen recargar dos veces
export const ID_PESTANA = (() => { try { return crypto.randomUUID(); } catch { return String(Math.random()).slice(2); } })();

// Cambios en vivo: recibe por SSE lo que modifican otros usuarios de la empresa y avisa a las pantallas
// abiertas para que se actualicen sin recargar. También detecta cuando se publica una versión nueva.
@Injectable({ providedIn: 'root' })
export class EnVivo {
  private auth = inject(Auth);
  private oyentes = new Set<{ recursos: string[]; fn: (c: Cambio) => void }>();
  private control: AbortController | null = null;
  private espera = 1000;
  private versionTimer: ReturnType<typeof setInterval> | undefined;

  // Una pantalla se suscribe a los recursos que muestra (p. ej. ['viajes', 'rndc']); se cancela al salir de ella.
  // Varios avisos seguidos se agrupan en una sola recarga.
  al(recursos: string[], fn: () => void, retraso = 600) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const oyente = { recursos, fn: () => { clearTimeout(t); t = setTimeout(fn, retraso); } };
    this.oyentes.add(oyente);
    inject(DestroyRef).onDestroy(() => { clearTimeout(t); this.oyentes.delete(oyente); });
  }

  iniciar() {
    if (this.control || !this.auth.usuario()) return;
    this.conectar();
    this.vigilarVersion();
  }

  detener() { this.control?.abort(); this.control = null; clearInterval(this.versionTimer); this.versionTimer = undefined; }

  private async conectar() {
    const control = this.control = new AbortController();
    try {
      const r = await fetch(`${environment.apiUrl}/eventos`, { credentials: 'include', signal: control.signal, cache: 'no-store' });
      if (r.status === 401 || r.status === 403) { this.control = null; return; }
      if (!r.ok || !r.body) throw new Error(String(r.status));
      this.espera = 1000;
      const lector = r.body.getReader();
      const dec = new TextDecoder();
      let resto = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const bloques = resto.split('\n\n');
        resto = bloques.pop() || '';
        for (const b of bloques) {
          const data = b.split('\n').find(l => l.startsWith('data: '));
          if (!b.includes('event: cambio') || !data) continue;
          try { this.repartir(JSON.parse(data.slice(6))); } catch { /* aviso ilegible */ }
        }
      }
    } catch { /* se reconecta abajo */ }
    if (this.control !== control || control.signal.aborted) return;
    // Reconexión con espera creciente (máx. 30 s)
    this.control = null;
    setTimeout(() => { if (this.auth.usuario()) this.conectar(); }, this.espera);
    this.espera = Math.min(this.espera * 2, 30000);
  }

  private repartir(c: Cambio) {
    if (c.origen === ID_PESTANA) return;
    for (const o of this.oyentes) if (o.recursos.includes(c.recurso)) o.fn(c);
  }

  // ── Versión nueva publicada: se recarga sola cuando no hay un formulario abierto ──
  private versionActual = this.scriptPrincipal(document);
  private vigilarVersion() {
    if (this.versionTimer) return;
    const revisar = async () => {
      try {
        const html = await (await fetch('/index.html', { cache: 'no-store' })).text();
        const nueva = this.scriptPrincipal(new DOMParser().parseFromString(html, 'text/html'));
        if (!nueva || !this.versionActual || nueva === this.versionActual) return;
        if (document.querySelector('dialog[open]')) return;          // se reintenta en la próxima revisión
        location.reload();
      } catch { /* sin conexión: se reintenta */ }
    };
    this.versionTimer = setInterval(revisar, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  }
  private scriptPrincipal(doc: Document) {
    return [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src') || '').find(s => /main[-.][\w]+\.js/.test(s)) || '';
  }
}

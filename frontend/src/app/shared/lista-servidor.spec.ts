import { ListaServidor, PeticionPagina, conPausa } from './lista-servidor';

interface Fila { _id: string }
const filas = (desde: number, n: number): Fila[] => Array.from({ length: n }, (_, i) => ({ _id: `id${desde + i}` }));

// Servidor simulado: 130 registros; el total solo llega en la primera página o con contar=1 (como el real)
function servidor() {
  const peticiones: PeticionPagina[] = [];
  const pedir = async (p: PeticionPagina) => {
    peticiones.push(p);
    const desde = (p.pagina - 1) * p.limite;
    return { items: filas(desde, Math.max(0, Math.min(p.limite, 130 - desde))), total: p.pagina === 1 || p.contar ? 130 : null };
  };
  return { peticiones, pedir };
}

describe('ListaServidor', () => {
  it('carga la primera página con su total', async () => {
    const s = servidor();
    const l = new ListaServidor<Fila>({ pedir: s.pedir });
    expect(await l.recargar()).toBe(true);
    expect(l.items().length).toBe(50);
    expect(l.total()).toBe(130);
    expect(s.peticiones[0]).toEqual({ pagina: 1, limite: 50 });
  });

  it('va a la página siguiente y a la anterior con cursor, y conserva el total', async () => {
    const s = servidor();
    const l = new ListaServidor<Fila>({ pedir: s.pedir });
    await l.recargar();
    await l.ir({ pagina: 2, porPagina: 50 });
    expect(s.peticiones[1]).toEqual({ pagina: 2, limite: 50, despuesDe: 'id49' });
    expect(l.total()).toBe(130);                 // la página 2 no trae total: se conserva
    expect(l.items()[0]._id).toBe('id50');
    await l.ir({ pagina: 3, porPagina: 50 });
    await l.ir({ pagina: 2, porPagina: 50 });
    expect(s.peticiones[3]).toEqual({ pagina: 2, limite: 50, antesDe: 'id100' });
    await l.ir({ pagina: 1, porPagina: 50 });
    expect(s.peticiones[4]).toEqual({ pagina: 1, limite: 50 });   // a la primera no se manda cursor
  });

  it('un salto o un cambio de tamaño no usa cursor', async () => {
    const s = servidor();
    const l = new ListaServidor<Fila>({ pedir: s.pedir });
    await l.recargar();
    await l.ir({ pagina: 3, porPagina: 50 });
    expect(s.peticiones[1]).toEqual({ pagina: 3, limite: 50 });
    await l.ir({ pagina: 5, porPagina: 25 });
    expect(s.peticiones[2]).toEqual({ pagina: 5, limite: 25 });
    expect(l.porPagina()).toBe(25);
  });

  it('pide el total si no lo tiene y refresca la misma página contándolo', async () => {
    const s = servidor();
    const l = new ListaServidor<Fila>({ pedir: s.pedir });
    await l.ir({ pagina: 2, porPagina: 50 });      // sin haber cargado la primera
    expect(s.peticiones[0].contar).toBe(1);
    await l.refrescar();
    expect(s.peticiones[1]).toEqual({ pagina: 2, limite: 50, contar: 1 });
    expect(l.pagina()).toBe(2);
  });

  it('descarta la respuesta que llega tarde (gana la última petición)', async () => {
    let soltar!: (v: any) => void;
    const lenta = new Promise((r) => { soltar = r; });
    let n = 0;
    const l = new ListaServidor<Fila>({ pedir: () => (++n === 1 ? lenta : Promise.resolve({ items: filas(500, 2), total: 2 })) as Promise<any> });
    const primera = l.recargar();
    await l.recargar();
    soltar({ items: filas(0, 50), total: 130 });
    expect(await primera).toBe(false);
    expect(l.items().map((x) => x._id)).toEqual(['id500', 'id501']);
    expect(l.total()).toBe(2);
  });

  it('marca «cargando» al recargar y «cambiando» al pasar de página', async () => {
    const s = servidor();
    const l = new ListaServidor<Fila>({ pedir: s.pedir });
    const p = l.recargar();
    expect(l.cargando()).toBe(true); expect(l.cambiando()).toBe(false);
    await p;
    expect(l.cargando()).toBe(false);
    const q = l.ir({ pagina: 2, porPagina: 50 });
    expect(l.cambiando()).toBe(true);
    await q;
    expect(l.cambiando()).toBe(false);
  });

  it('avisa el error y no cambia lo que se ve', async () => {
    const errores: unknown[] = [];
    const s = servidor();
    let fallar = false;
    const l = new ListaServidor<Fila>({ pedir: (p) => (fallar ? Promise.reject(new Error('sin red')) : s.pedir(p)), alError: (e) => errores.push(e) });
    await l.recargar();
    fallar = true;
    expect(await l.ir({ pagina: 2, porPagina: 50 })).toBe(false);
    expect(errores.length).toBe(1);
    expect(l.pagina()).toBe(1);
    expect(l.items()[0]._id).toBe('id0');
  });

  it('usa los extractores y alCargar con otros nombres de respuesta', async () => {
    const sumas: number[] = [];
    const l = new ListaServidor<Fila, { viajes: Fila[]; total: number; sumas: number }>({
      pedir: async () => ({ viajes: filas(0, 3), total: 3, sumas: 99 }),
      items: (r) => r.viajes, alCargar: (r) => sumas.push(r.sumas),
    });
    await l.recargar();
    expect(l.items().length).toBe(3);
    expect(sumas).toEqual([99]);
  });
});

describe('conPausa', () => {
  it('llama una sola vez después de dejar de escribir', () => {
    vi.useFakeTimers();
    let n = 0;
    const f = conPausa(() => n++, 300);
    f(); f(); f();
    vi.advanceTimersByTime(299);
    expect(n).toBe(0);
    vi.advanceTimersByTime(1);
    expect(n).toBe(1);
    f(); f.cancelar();
    vi.advanceTimersByTime(500);
    expect(n).toBe(1);
    vi.useRealTimers();
  });
});

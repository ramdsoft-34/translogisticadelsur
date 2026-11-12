import { signal } from '@angular/core';
import { PaginaLocal, enPagina } from './pagina-local';

describe('PaginaLocal', () => {
  it('muestra solo la página y cuenta toda la lista', () => {
    const l = signal(Array.from({ length: 60 }, (_, i) => i));
    const p = new PaginaLocal(() => l());
    expect(p.total()).toBe(60);
    expect(p.items()).toEqual(l().slice(0, 25));
    p.ir({ pagina: 3, porPagina: 25 });
    expect(p.items()).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
  });

  it('vuelve a la primera página cuando cambia el filtro, no cuando la lista solo se actualiza', () => {
    const q = signal('');
    const datos = signal(Array.from({ length: 80 }, (_, i) => ({ n: i, t: i % 2 ? 'impar' : 'par' })));
    const p = new PaginaLocal(() => datos().filter((x) => !q() || x.t === q()), { reiniciarCon: () => q() });
    p.ir({ pagina: 3, porPagina: 25 });
    datos.update((l) => [...l, { n: 80, t: 'par' }]);   // un registro nuevo (p. ej. otro usuario guardó)
    expect(p.pagina()).toBe(3);
    q.set('impar');
    expect(p.pagina()).toBe(1);
    expect(p.total()).toBe(40);
  });

  it('si la página quedó fuera de rango muestra la última que existe', () => {
    expect(enPagina([1, 2, 3, 4, 5], 9, 2)).toEqual([5]);
    expect(enPagina([], 2, 25)).toEqual([]);
  });
});

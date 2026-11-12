import { TestBed } from '@angular/core/testing';
import { CambioPagina, Paginador } from './paginador';

function crear(total: number, pagina = 1, porPagina = 50) {
  const f = TestBed.createComponent(Paginador);
  f.componentRef.setInput('total', total);
  f.componentRef.setInput('pagina', pagina);
  f.componentRef.setInput('porPagina', porPagina);
  f.componentRef.setInput('unidad', 'viajes');
  f.detectChanges();
  const cambios: CambioPagina[] = [];
  f.componentInstance.cambio.subscribe((c) => cambios.push(c));
  return { f, c: f.componentInstance, cambios, texto: () => (f.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ') };
}

describe('Paginador', () => {
  it('muestra el rango y el total con separador de miles', () => {
    const { texto } = crear(1209, 2, 50);
    expect(texto()).toContain('Mostrando 51–100 de 1.209 viajes');
  });

  it('no se muestra sin registros', () => {
    const { f } = crear(0);
    expect((f.nativeElement as HTMLElement).querySelector('nav')).toBeNull();
  });

  it('numera con saltos alrededor de la página actual', () => {
    expect(crear(1250, 1).c.numeros()).toEqual([1, 2, 3, 4, 0, 25]);
    expect(crear(1250, 12).c.numeros()).toEqual([1, 0, 11, 12, 13, 0, 25]);
    expect(crear(1250, 25).c.numeros()).toEqual([1, 0, 22, 23, 24, 25]);
    expect(crear(300, 3).c.numeros()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('si un filtro deja menos páginas, muestra la última que existe', () => {
    const { c, texto } = crear(60, 9, 50);
    expect(c.actual()).toBe(2);
    expect(texto()).toContain('Mostrando 51–60 de 60');
  });

  it('emite la página pedida y no repite la actual ni sale del rango', () => {
    const { c, cambios } = crear(130, 2, 50);
    c.ir(3); c.ir(2); c.ir(0); c.ir(4);
    expect(cambios).toEqual([{ pagina: 3, porPagina: 50 }]);
  });

  it('al cambiar el tamaño conserva a la vista el primer registro', () => {
    const { c, cambios } = crear(130, 3, 50);   // primer registro visible: el 101
    c.cambiarTamano('25');
    expect(cambios).toEqual([{ pagina: 5, porPagina: 25 }]);   // 101–125
  });

  it('desactiva los botones mientras carga', () => {
    const { f } = crear(130, 2, 50);
    f.componentRef.setInput('cargando', true);
    f.detectChanges();
    const botones = [...(f.nativeElement as HTMLElement).querySelectorAll('button')];
    expect(botones.length).toBeGreaterThan(0);
    expect(botones.every((b) => b.disabled)).toBe(true);
  });
});

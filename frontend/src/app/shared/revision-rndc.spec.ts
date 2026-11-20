import { TestBed } from '@angular/core/testing';
import { RevisionRndcVista, RevisionRndc, CorreccionRndc } from './revision-rndc';

const MAN092: RevisionRndc = {
  viaje: 'v1', nivel: 'error', ia: null,
  hallazgos: [
    { nivel: 'error', fuente: 'regla', codigo: 'MAN092', titulo: 'Viaje municipal o urbano entre municipios distintos', detalle: 'Debe ir como «General».',
      correccion: { documento: 'manifiesto', variable: 'CODOPERACIONTRANSPORTE', valor: 'G', antes: 'U', aplicable: true, texto: 'Cambiar el tipo de manifiesto a «General» (G)' } },
    { nivel: 'alerta', fuente: 'regla', titulo: 'Revise', detalle: 'El flete está en cero' },
  ],
};

function crear(r: RevisionRndc, modo: 'lista' | 'rechazo' = 'lista') {
  const f = TestBed.createComponent(RevisionRndcVista);
  f.componentRef.setInput('revision', r);
  f.componentRef.setInput('modo', modo);
  f.detectChanges();
  const aplicadas: CorreccionRndc[] = [];
  f.componentInstance.aplicar.subscribe((c) => aplicadas.push(c));
  const el = f.nativeElement as HTMLElement;
  return { f, el, aplicadas, texto: () => el.textContent!.replace(/\s+/g, ' ') };
}

describe('Revisión RNDC', () => {
  it('en la lista resume el estado y aplica la corrección con un clic', () => {
    const { el, texto, aplicadas } = crear(MAN092);
    expect(texto()).toContain('1 por corregir');
    expect(texto()).toContain('y 1 más');
    expect((el.querySelector('details') as HTMLDetailsElement).open).toBe(true);
    const b = [...el.querySelectorAll('button')].find((x) => /Aplicar corrección/.test(x.textContent!))!;
    b.click();
    expect(aplicadas).toEqual([MAN092.hallazgos[0].correccion!]);
  });

  it('sin nada por hacer muestra «Listo para enviar» (lo informativo no se muestra)', () => {
    const { el, texto } = crear({ viaje: 'v', nivel: 'ok', ia: null,
      hallazgos: [{ nivel: 'info', fuente: 'regla', titulo: 'Vehículo: datos incompletos en la plataforma', detalle: 'falta N° póliza SOAT' }] });
    expect(el.querySelector('details')).toBeNull();
    expect(texto()).toContain('Listo para enviar');
    expect(texto()).not.toContain('datos incompletos');
  });

  it('en Expedir muestra solo cómo corregir el rechazo: historial e IA', () => {
    const { texto } = crear({ viaje: 'v', nivel: 'error', hallazgos: [
      { nivel: 'error', fuente: 'historial', codigo: 'MAN354', titulo: 'El RNDC rechazó el manifiesto', detalle: 'x', mensajeRndc: 'MAN354 …',
        historial: { codigo: 'MAN354', cambios: [{ texto: 'Municipio de destino: 52001000 → 86885000', veces: 2, viajes: [1335, 1340] }], sinCambios: 0, viajesSin: [] } },
      { nivel: 'alerta', fuente: 'regla', titulo: 'Revise', detalle: 'El flete está en cero' },
    ], ia: { estado: 'listo', resultado: { causa: 'La sede no coincide', queHacer: 'Actualice la sede', confianza: 'media', correcciones: [] } } }, 'rechazo');
    expect(texto()).toContain('Antes se resolvió (MAN354)');
    expect(texto()).toContain('2 veces');
    expect(texto()).toContain('N° 1335, N° 1340');
    expect(texto()).toContain('La sede no coincide');
    expect(texto()).not.toContain('El flete está en cero');
  });

  it('IA sin facturación: lo explica; sin clave configurada: no muestra nada', () => {
    expect(crear({ viaje: 'v', nivel: 'error', hallazgos: [], ia: { estado: 'no_disponible', motivo: 'sin_plan' } }, 'rechazo').texto()).toContain('facturación');
    expect(crear({ viaje: 'v', nivel: 'error', hallazgos: [], ia: { estado: 'no_disponible', motivo: 'sin_clave' } }, 'rechazo').el.querySelector('details')).toBeNull();
  });
});

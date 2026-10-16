import { Pipe, PipeTransform } from '@angular/core';

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

@Pipe({ name: 'pesos' })
export class PesosPipe implements PipeTransform {
  transform(v: number | null | undefined) { return v === null || v === undefined ? '' : `$ ${fmt.format(v)}`; }
}

@Pipe({ name: 'miles' })
export class MilesPipe implements PipeTransform {
  transform(v: number | null | undefined) { return v === null || v === undefined ? '' : fmt.format(v); }
}

// Fechas guardadas como medianoche UTC (día calendario): se muestran sin desfase.
@Pipe({ name: 'dia' })
export class DiaPipe implements PipeTransform {
  transform(v: string | Date | null | undefined) {
    if (!v) return '';
    const f = new Date(v);
    return `${String(f.getUTCDate()).padStart(2, '0')}/${String(f.getUTCMonth() + 1).padStart(2, '0')}/${f.getUTCFullYear()}`;
  }
}

@Pipe({ name: 'fechaHora' })
export class FechaHoraPipe implements PipeTransform {
  transform(v: string | Date | null | undefined) {
    if (!v) return '';
    return new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  }
}

export const isoDia = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : '');

export function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function inicioMesIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export const FORMATOS = [PesosPipe, MilesPipe, DiaPipe, FechaHoraPipe];

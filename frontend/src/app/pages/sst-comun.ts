// Piezas comunes de las pantallas de SG-SST y PESV: estilos, textos de estados y fechas.
export type EstadoVence = 'vencido' | 'semana' | 'mes' | 'ok' | 'sin_dato';

export const CHIP_VENCE: Record<EstadoVence, string> = { vencido: 'error', semana: 'alerta', mes: 'alerta', ok: 'ok', sin_dato: '' };
export const TEXTO_GRUPO: Record<string, string> = { vencido: 'Vencidos', semana: 'Esta semana', mes: 'Próximos 30 días' };
export const EJES: Record<string, string> = { sst: 'SST', vial: 'Seguridad vial', ambos: 'SST y vial' };
export const CONCEPTOS: Record<string, string> = { apto: 'Apto', apto_restricciones: 'Apto con restricciones', no_apto: 'No apto', aplazado: 'Aplazado' };
export const TIPOS_EXAMEN: Record<string, string> = { ingreso: 'Ingreso', periodico: 'Periódico', retiro: 'Retiro', post_incapacidad: 'Post incapacidad', cambio_cargo: 'Cambio de cargo' };
export const VINCULOS: Record<string, string> = { directo: 'Directo', contratista: 'Contratista', temporal: 'Temporal', aprendiz: 'Aprendiz', '': '—' };
export const NIVELES_PESV: Record<string, string> = { basico: 'Básico', estandar: 'Estándar', avanzado: 'Avanzado' };

/** AAAA-MM-DD de hoy en Colombia. */
export const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
/** Fecha guardada → AAAA-MM-DD para un <input type="date">. */
export const aIso = (v: string | null | undefined) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(v)) : '');

export const ESTILOS_SST = `
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
  .kpi { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); min-width: 0; }
  .kpi header { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--gris-5); font-size: 13px; font-weight: 600; }
  .kpi strong { font-size: 26px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .kpi footer { font-size: 12px; color: var(--gris-5); }
  .kpi.destacado { background: var(--primario-claro); border-color: var(--primario-borde); }
  .kpi .vacio-kpi { font-size: 13px; color: var(--gris-5); font-weight: 500; }
  .barra-avance { height: 6px; border-radius: 999px; background: var(--gris-15); overflow: hidden; }
  .barra-avance > span { display: block; height: 100%; background: var(--primario); border-radius: inherit; }
  .seccion-cab { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .seccion-cab h2 { margin: 0; font-size: 16px; }
  .bloque { border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 14px 16px; background: var(--gris-0); margin-bottom: 14px; }
  .bloque > h3 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--gris-6); }
  .agregar { border: 1px dashed var(--gris-3); border-radius: var(--radio-l); padding: 12px 14px; margin-top: 10px; }
  .lista-simple { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .lista-simple li { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .d-bloque { display: block; }
  th.celda-acciones { text-align: right; }
  .celda-acciones .acciones { justify-content: flex-end; flex-wrap: wrap; }
  .tabla-caja table { min-width: 0; }
  .nota { font-size: 12px; color: var(--gris-5); }
  @media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 720px) { .kpis { gap: 10px; } .kpi strong { font-size: 20px; } }
`;

// Reglas de negocio configurables por empresa (Configuración → Reglas): porcentajes de
// retención, PBV del FOPAT, días de aviso de documentos, destinos del anticipo reconocido,
// siglas de liquidación y pesos por capacidad. Sin valores guardados se usan los de la plantilla.
import { Empresa } from '../../models/index.js';
import { normalizar } from '../../utils/texto.js';

export const REGLAS_BASE = Object.freeze({
  retefuenteConductorPct: 1, fopatPct: 0.1, pbvFopat: 10500, ciudadesSinFopat: ['Pasto'],
  ciudadesAnticipoCero: ['Pasto', 'Mayorista', 'Popayán'], diasAvisoDocumentos: 10, retefuenteFacturaPct: 1, siglasLiquidacion: 'LC',
  pesosPorTamano: [{ tamano: '1.0', kg: 800 }, { tamano: '3.0', kg: 1500 }, { tamano: '5.0', kg: 2500 }, { tamano: '6.0', kg: 5000 }],
});

export function completarReglas(r = {}) {
  const x = { ...REGLAS_BASE };
  for (const [k, v] of Object.entries(r || {})) if (v !== undefined && v !== null && k in REGLAS_BASE) x[k] = v;
  return x;
}

export async function reglasDe(empresaId) {
  const e = await Empresa.findById(empresaId).select('reglas').lean();
  return completarReglas(e?.reglas);
}

// El destino menciona alguna de las ciudades (sin tildes ni mayúsculas): «PASTO 3.0», «Popayan»…
export const destinoEn = (destino, ciudades = []) => {
  const d = ` ${normalizar(destino)} `;
  return ciudades.some(c => normalizar(c) && d.includes(` ${normalizar(c)} `));
};

// Peso según la capacidad escrita en el destino (ObtenerPesoPorDestino de la plantilla): «IPIALES 1.0» → 800 kg
export function pesoPorTamano(destino, reglas = REGLAS_BASE) {
  const t = String(destino || '');
  const f = (reglas.pesosPorTamano || []).find(p => p.tamano && new RegExp(`(^|[^\\d.])${p.tamano.replace('.', '[.,]')}($|[^\\d])`).test(t));
  return f ? Number(f.kg) || 0 : 0;
}

// Sede del cliente en el municipio de destino: la de ese municipio exacto; si no hay, la de un centro poblado
// del mismo municipio (ej. El Plateado en Argelia). Entre varias, la de código menor. Nunca la sede de cargue.
const txt = (v) => String(v ?? '').trim();

export function elegirSedeMunicipio(sedes, codDestino, sedeRemitente = '') {
  const cod = txt(codDestino);
  if (!/^\d{8}$/.test(cod)) return null;
  const candidatas = sedes.filter(s => txt(s.sede?.codigo) && txt(s.sede.codigo) !== txt(sedeRemitente) && txt(s.codMunicipio).startsWith(cod.slice(0, 5)));
  candidatas.sort((a, b) => (a.codMunicipio === cod ? 0 : 1) - (b.codMunicipio === cod ? 0 : 1) || (Number(a.sede.codigo) || 0) - (Number(b.sede.codigo) || 0));
  return candidatas[0] || null;
}

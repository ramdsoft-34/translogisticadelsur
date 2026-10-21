// Compara (SOLO LECTURA) los maestros de una empresa con la plantilla de Excel y lista
// faltantes, sobrantes y diferencias de conductores, vehículos, terceros, clientes y tarifas.
// Uso: node scripts/compararPlantilla.js "<empresa>" <archivo.xlsm>
import fs from 'node:fs';
import { conectar, desconectar } from '../src/db.js';
import { Empresa, Cliente, Tarifa, Tercero, Vehiculo } from '../src/models/index.js';
import { escaparRegex, normalizar, soloDigitos } from '../src/utils/texto.js';
import { leerLibro, filas, txt, entero, num, fecha } from '../src/services/importacion/excel.js';

const [nombre, archivo] = process.argv.slice(2);
const placaKey = (p) => txt(p).replace(/[\s-]/g, '').toUpperCase();
const ced = (v) => { const s = entero(v).replace(/[.\s,]/g, ''); return s === '0' ? '' : s; };
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const nombreT = (t) => normalizar([t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' '));

await conectar();
try {
  const [empresa] = await Empresa.find({ nombre: new RegExp(escaparRegex(nombre), 'i') }).lean();
  const E = empresa._id;
  const wb = await leerLibro(fs.readFileSync(archivo));
  const H = (n) => (wb.getWorksheet(n) ? filas(wb.getWorksheet(n)) : []);
  const fichas = H('RNDC_FICHAS').slice(5);
  const conductores = H('_CONDUCTORES').slice(1).filter(f => txt(f[0]) && txt(f[1]));
  const r = {};

  // ── Conductores (_CONDUCTORES + conductores de RNDC_FICHAS) ──
  const xCond = new Map();
  for (const f of fichas) if (ced(f[15]) && txt(f[16])) xCond.set(ced(f[15]), { nombre: txt(f[16]), lic: txt(f[19]) });
  const sinCedula = [];
  for (const f of conductores) {
    if (!ced(f[2])) { sinCedula.push(`${txt(f[0])} (${placaKey(f[1])})`); continue; }
    const x = xCond.get(ced(f[2])) || { nombre: txt(f[0]) };
    xCond.set(ced(f[2]), { ...x, placa: placaKey(f[1]), licVence: dia(fecha(f[5])), celular: soloDigitos(f[6]) });
  }
  const terceros = await Tercero.find({ empresa: E }).lean();
  const personas = terceros.filter(t => !t.sede?.codigo);
  const porDoc = new Map(personas.map(t => [soloDigitos(t.numId), t]));
  const bdCond = personas.filter(t => (t.roles || []).includes('conductor'));
  r.conductores = { excel: xCond.size, plataforma: bdCond.length, sinCedulaEnExcel: sinCedula,
    faltan: [...xCond].filter(([d]) => !porDoc.has(d)).map(([d, x]) => `${x.nombre} (C.C. ${d})`),
    sobran: bdCond.filter(t => !xCond.has(soloDigitos(t.numId))).map(t => `${nombreT(t)} (C.C. ${t.numId})${t.activo === false ? ' [inactivo]' : ''}`),
    diferentes: [] };
  for (const [d, x] of xCond) {
    const t = porDoc.get(d); if (!t) continue;
    const dif = [];
    if (x.licVence && dia(t.licencia?.vence) && x.licVence !== dia(t.licencia?.vence)) dif.push(`vence licencia Excel ${x.licVence} / plataforma ${dia(t.licencia?.vence)}`);
    if (!(t.roles || []).includes('conductor')) dif.push('en la plataforma no tiene el rol de conductor');
    if (dif.length) r.conductores.diferentes.push(`${x.nombre} (C.C. ${d}): ${dif.join('; ')}`);
  }

  // ── Terceros: titulares y tenedores (RNDC_FICHAS y _CONDUCTORES) y sedes de destinatarios (RNDC_SEDES) ──
  const xTer = new Map();
  for (const f of fichas) if (ced(f[9]) && txt(f[10])) xTer.set(ced(f[9]), { nombre: txt(f[10]), rol: 'titular' });
  for (const f of conductores) if (ced(f[9]) && txt(f[10]) && !xTer.has(ced(f[9]))) xTer.set(ced(f[9]), { nombre: txt(f[10]), rol: 'tenedor' });
  const otros = personas.filter(t => !(t.roles || []).includes('conductor') && (t.roles || []).some(x => ['titular', 'tenedor', 'propietario'].includes(x)));
  r.terceros = { excel: xTer.size, plataforma: otros.length,
    faltan: [...xTer].filter(([d]) => !porDoc.has(d)).map(([d, x]) => `${x.nombre} (${x.rol}, ${d})`),
    sobran: otros.filter(t => !xTer.has(soloDigitos(t.numId)) && !xCond.has(soloDigitos(t.numId))).map(t => `${nombreT(t)} (${t.tipoId} ${t.numId}, ${t.roles.join('/')})`) };
  const xSedes = new Set(H('RNDC_SEDES').slice(1).filter(f => entero(f[0]) && num(f[2])).map(f => `${entero(f[0])}|${String(num(f[2]))}`));
  const bdSedes = terceros.filter(t => t.sede?.codigo);
  r.sedesDestinatarios = { excel: xSedes.size, plataforma: bdSedes.length,
    faltan: [...xSedes].filter(k => !bdSedes.some(t => `${soloDigitos(t.numId)}|${t.sede.codigo}` === k)),
    sobran: bdSedes.filter(t => !xSedes.has(`${soloDigitos(t.numId)}|${t.sede.codigo}`)).map(t => `${t.numId} sede ${t.sede.codigo} ${t.sede.nombre || ''}`) };

  // ── Vehículos ──
  const xVeh = new Map();
  for (const f of fichas) { const p = placaKey(f[0]); if (/^[A-Z0-9]{5,6}$/.test(p)) xVeh.set(p, { pesoVacio: num(f[3]), soat: txt(f[6]), pbv: num(f[8]) }); }
  for (const f of conductores) { const p = placaKey(f[1]); if (/^[A-Z0-9]{5,6}$/.test(p)) xVeh.set(p, { ...(xVeh.get(p) || {}), soatC: dia(fecha(f[4])), tecno: dia(fecha(f[3])), pbvC: num(f[11]) }); }
  const veh = await Vehiculo.find({ empresa: E }).lean();
  const porPlaca = new Map(veh.map(v => [v.placa, v]));
  r.vehiculos = { excel: xVeh.size, plataforma: veh.length,
    faltan: [...xVeh.keys()].filter(p => !porPlaca.has(p)),
    sobran: veh.filter(v => !xVeh.has(v.placa)).map(v => `${v.placa}${v.activo === false ? ' [inactivo]' : ''}`), diferentes: [] };
  for (const [p, x] of xVeh) {
    const v = porPlaca.get(p); if (!v) continue;
    const dif = [];
    const pbv = x.pbv || x.pbvC;
    if (pbv && v.pbv && pbv !== v.pbv) dif.push(`PBV ${pbv} / ${v.pbv}`);
    if (x.pesoVacio && v.pesoVacio && x.pesoVacio !== v.pesoVacio) dif.push(`peso vacío ${x.pesoVacio} / ${v.pesoVacio}`);
    const soat = x.soatC || (x.soat ? x.soat.replace(/\//g, '-') : '');
    if (soat && dia(v.soat?.vence) && soat !== dia(v.soat?.vence)) dif.push(`vence SOAT ${soat} / ${dia(v.soat?.vence)}`);
    if (x.tecno && dia(v.venceTecnomecanica) && x.tecno !== dia(v.venceTecnomecanica)) dif.push(`vence tecnomecánica ${x.tecno} / ${dia(v.venceTecnomecanica)}`);
    if (dif.length) r.vehiculos.diferentes.push(`${p}: ${dif.join('; ')} (Excel / plataforma)`);
  }

  // ── Clientes ──
  const xCli = new Map(H('Empresas').slice(1).filter(f => txt(f[0])).map(f => [normalizar(f[0]), { nombre: txt(f[0]), nit: entero(f[2]) }]));
  const cli = await Cliente.find({ empresa: E }).lean();
  r.clientes = { excel: xCli.size, plataforma: cli.length,
    faltan: [...xCli.values()].filter(x => !cli.some(c => normalizar(c.nombre) === normalizar(x.nombre))).map(x => x.nombre),
    sobran: cli.filter(c => !xCli.has(normalizar(c.nombre))).map(c => c.nombre),
    diferentes: cli.filter(c => xCli.has(normalizar(c.nombre))).map(c => ({ c, x: xCli.get(normalizar(c.nombre)) }))
      .filter(({ c, x }) => x.nit && soloDigitos(`${c.nit}${c.tipoId === 'N' ? c.dv || '' : ''}`) !== x.nit && soloDigitos(c.nit) !== x.nit)
      .map(({ c, x }) => `${c.nombre}: NIT Excel ${x.nit} / plataforma ${c.nit}${c.dv ? `-${c.dv}` : ''}`) };

  // ── Tarifas ──
  const nombreCli = new Map(cli.map(c => [String(c._id), normalizar(c.nombre)]));
  const xTar = new Map();
  for (const f of H('Fletes').slice(1)) if (txt(f[0]) && txt(f[1]) && xCli.has(normalizar(f[0])))
    xTar.set(`${normalizar(f[0])}|${normalizar(f[1])}`, { txt: `${txt(f[0])} · ${txt(f[1])}`, v: [num(f[2]) || 0, num(f[3]) || 0, num(f[4]) || 0, num(f[5]) || 0, num(f[7]) || 0] });
  const tar = await Tarifa.find({ empresa: E }).lean();
  const tk = (t) => `${nombreCli.get(String(t.cliente))}|${normalizar(t.destino)}`;
  const campos = ['tarifa cliente', 'tarifa auxiliar', 'flete conductor', 'auxiliar pagado', 'anticipo habitual'];
  r.tarifas = { excel: xTar.size, plataforma: tar.length, activasPlataforma: tar.filter(t => t.activo !== false).length,
    faltan: [...xTar].filter(([k]) => !tar.some(t => tk(t) === k)).map(([, x]) => x.txt),
    sobran: tar.filter(t => !xTar.has(tk(t))).map(t => `${nombreCli.get(String(t.cliente))} · ${t.destino}${t.activo === false ? ' [inactiva]' : ''}`),
    diferentes: [] };
  for (const t of tar) {
    const x = xTar.get(tk(t)); if (!x) continue;
    const bd = [t.tarifaCliente, t.tarifaAuxiliar, t.fleteConductor, t.auxiliarPagado, t.anticipoHabitual].map(n => Number(n) || 0);
    const dif = campos.filter((_, i) => bd[i] !== x.v[i]).map((c) => { const i = campos.indexOf(c); return `${c} ${x.v[i]} / ${bd[i]}`; });
    if (dif.length) r.tarifas.diferentes.push(`${x.txt}: ${dif.join('; ')}`);
  }
  console.log(JSON.stringify(r, null, 1));
} finally {
  await desconectar();
}

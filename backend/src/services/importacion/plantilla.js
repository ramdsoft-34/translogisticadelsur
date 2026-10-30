// Importa la plantilla de Excel "PLANTILLA_DE_VIAJES_FORMULARIO.xlsm" a UNA empresa.
// Todo lo que se crea lleva `empresa` (aislamiento): la misma plantilla importada
// en otra empresa queda separada. Es idempotente: no borra ni sobrescribe datos;
// solo agrega lo que falta y completa campos vacíos.
//
// Hojas usadas:
//   Empresas, CORREOS ........ clientes (generadores de carga)
//   Fletes ................... destinos y tarifas
//   RNDC_SEDES ............... sedes de los destinatarios en el RNDC (terceros NIT con sede)
//   RNDC_FICHAS .............. vehículos, titulares, conductores y remitentes tal como están en el RNDC
//   _CONDUCTORES ............. conductores, placas, vencimientos, tenedores y cuentas
//   BITACORA ................. viajes
//   RNDC_VIAJES .............. remesas y manifiestos expedidos desde la plantilla (radicados y QR)
//   RELACION ................. cantidad y auxiliar de los viajes en la relación de fletes
//   RNDC_CONFIG, RNDC_FIJOS .. configuración RNDC de la empresa (solo si aún no está configurada)
//   RNDC_DANE, RNDC_ALIAS .... resolución del municipio de cada destino (misma regla de la plantilla)
import { Cliente, Tarifa, Tercero, Vehiculo, Viaje, Municipio, Empresa, Contador } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { normalizar, nombrePropio, soloDigitos } from '../../utils/texto.js';
import { leerLibro, filas, txt, entero, num, fecha, fechaHoraTexto, partirNombre, buscadorMunicipios, camposFaltantes } from './excel.js';
import { variablesTercero, variablesVehiculo, huella } from '../rndc/documentos.js';
import { importarGestion } from './gestion.js';

const NIT_CORBETA = '8909009431';
const telefonoValido = (t) => { const d = soloDigitos(t); return d && !/^0+$/.test(d) && !/^9+$/.test(d) ? d : ''; };
const placaKey = (p) => txt(p).replace(/[\s-]/g, '').toUpperCase();
const cedula = (v) => { const s = entero(v).replace(/[.\s,]/g, ''); return s === '0' ? '' : s; };
// Documento de 10 dígitos que empieza por 8 o 9 = NIT (con dígito de verificación); si no, cédula.
const tipoDoc = (doc) => (doc.length === 10 && /^[89]/.test(doc) ? 'N' : 'C');

// Peso según la capacidad escrita en el destino (ObtenerPesoPorDestino de la plantilla).
function pesoPorDestino(destino) {
  const t = txt(destino).toUpperCase();
  if (t.includes('1.0')) return 800;
  if (t.includes('5.0')) return 2500;
  if (t.includes('3.0')) return 1500;
  if (t.includes('6.0')) return 5000;
  return 0;
}
const esTat = (d) => /^(PASTO|IPIALES) TAT 1\.0$/i.test(txt(d));
const destinoUrbano = (d) => { const t = txt(d).toUpperCase(); return t.includes('ALKOSTO') || t.includes('ALCOSTO') || t.includes('URBANO') || t.includes('PASTO CLIENTE') || t === 'PASTO'; };

// Municipio del destino: alias de la plantilla y luego RNDC_DANE, priorizando
// Nariño (52), Putumayo (86) y Cauca (19) — misma regla que codigoDane() de la plantilla.
function resolvedorDestinos(dane, alias) {
  const porNombre = (nombre) => {
    for (const pR of ['52', '86', '19', '']) {
      const f = dane.find(d => (!pR || d.depto === pR) && (d.norm === nombre || d.corto === nombre));
      if (f) return f.codigo;
    }
    for (const pR of ['52', '86', '19', '']) {
      const f = dane.find(d => (!pR || d.depto === pR) && ` ${d.norm} `.includes(` ${nombre} `));
      if (f) return f.codigo;
    }
    return '';
  };
  return (destino) => {
    const t = ` ${normalizar(destino)} `;
    if (!t.trim()) return '';
    let bp = 0; let bl = 0; let bt = '';
    for (const a of alias) {
      const pos = t.lastIndexOf(` ${a.clave} `) + 1;
      if (pos > 0 && (pos > bp || (pos === bp && a.clave.length > bl))) { bp = pos; bl = a.clave.length; bt = a.municipio; }
    }
    if (bp > 0) { const c = porNombre(bt); if (c) return c; }
    for (const pR of ['52', '86', '19', '']) {
      bp = 0; bl = 0; let cand = '';
      for (const d of dane) {
        if (pR && d.depto !== pR) continue;
        for (const k of [d.norm, d.corto]) {
          if (!k) continue;
          const pos = t.lastIndexOf(` ${k} `) + 1;
          if (pos > 0 && (pos > bp || (pos === bp && k.length > bl))) { bp = pos; bl = k.length; cand = d.codigo; }
        }
      }
      if (cand) return cand;
    }
    return '';
  };
}

// Sede del destinatario según el destino (sedeDe() de la plantilla).
function sedeDe(sedes, idDest, destino) {
  const nd = normalizar(destino);
  let mejorEx = 0; let prefEx = 0; let mejorPa = 0; let nPa = 0; let prefPa = 0;
  for (const s of sedes) {
    if (s.id !== idDest) continue;
    const cod = Number(s.codigo) || 0;
    const nn = normalizar(s.nombre);
    if (cod <= 0 || !nn) continue;
    if (nn === nd) { if (cod > mejorEx) mejorEx = cod; if (s.preferida) prefEx = cod; } else if (nn.length >= 4 && (nn.includes(nd) || nd.includes(nn))) { nPa += 1; mejorPa = cod; if (s.preferida) prefPa = cod; }
  }
  return String(prefEx || mejorEx || prefPa || (nPa === 1 ? mejorPa : '') || '');
}

async function fijarMinimo(empresa, clave, valor) {
  if (!(valor > 0)) return;
  await Contador.updateOne({ empresa, clave, valor: { $lt: valor } }, { $set: { valor } }, { upsert: true })
    .catch(e => { if (e.code !== 11000) throw e; });
}

export async function importarPlantillaViajes(empresaId, buffer, { usuario = null, soloMaestros = false } = {}) {
  const wb = await leerLibro(buffer);
  const H = (n) => filas(wb.getWorksheet(n));
  if (!wb.getWorksheet('BITACORA') || !wb.getWorksheet('Empresas')) {
    throw new ErrorHttp(400, 'El archivo no tiene la estructura de la plantilla de viajes (faltan las hojas BITACORA y Empresas)');
  }
  const empresa = await Empresa.findById(empresaId).lean();
  const E = empresa._id;
  const res = { avisos: [] };
  const municipioDe = buscadorMunicipios(await Municipio.find().lean());

  // ── 1. Configuración RNDC (solo si la empresa aún no la tiene) ────────────
  const cfgFilas = H('RNDC_CONFIG');
  const fijos = H('RNDC_FIJOS').slice(3).filter(f => ['R', 'M'].includes(txt(f[0]).toUpperCase()) && txt(f[1]));
  const fichas = H('RNDC_FICHAS');
  if (!txt(empresa.rndc?.usuario) && cfgFilas.length) {
    const val = (fila) => txt(cfgFilas[fila - 1]?.[1]);
    const fijo = (p, v) => txt(fijos.find(f => txt(f[0]).toUpperCase() === p && txt(f[1]).toUpperCase() === v)?.[2]);
    const nitCompleto = `${soloDigitos(empresa.nit)}${soloDigitos(empresa.dv)}`;
    const nitPlantilla = soloDigitos(val(5));
    if (nitPlantilla && nitPlantilla !== nitCompleto) {
      res.avisos.push(`El NIT de la plantilla (${nitPlantilla}) no coincide con el de la empresa (${nitCompleto}). Verifique antes de enviar al RNDC.`);
    }
    const set = {
      'rndc.usuario': val(4), 'rndc.prefijoRemesa': val(7), 'rndc.prefijoManifiesto': val(9), 'rndc.codOrigen': val(14),
      'rndc.operacion': fijo('M', 'CODOPERACIONTRANSPORTE') || 'G', 'rndc.naturalezaCarga': fijo('R', 'CODNATURALEZACARGA') || '1',
      'rndc.unidadMedida': fijo('R', 'UNIDADMEDIDACAPACIDAD') || '1', 'rndc.tipoEmpaque': fijo('R', 'CODTIPOEMPAQUE') || '0',
      'rndc.mercancia.codigo': fijo('R', 'MERCANCIAREMESA'), 'rndc.mercancia.descripcion': fijo('R', 'DESCRIPCIONCORTAPRODUCTO'),
      'rndc.poliza.numero': fijo('R', 'NUMPOLIZATRANSPORTE'), 'rndc.poliza.vence': fecha(fijo('R', 'FECHAVENCIMIENTOPOLIZACARGA')),
      'rndc.poliza.aseguradoraNit': fijo('R', 'COMPANIASEGURO'), 'rndc.poliza.dueno': fijo('R', 'DUENOPOLIZA') || 'E',
      'rndc.horaCitaCargue': fijo('R', 'HORACITAPACTADACARGUE') || '08:00', 'rndc.horaCitaDescargue': fijo('R', 'HORACITAPACTADADESCARGUEREMESA') || '18:00',
      'rndc.horasPactoCargue': num(fijo('R', 'HORASPACTOCARGA')) ?? 1, 'rndc.horasPactoDescargue': num(fijo('R', 'HORASPACTODESCARGUE')) ?? 1,
      'rndc.reteIca': num(fijo('M', 'RETENCIONICAMANIFIESTOCARGA')) ?? 0,
      'rndc.responsablePagoCargue': fijo('M', 'CODRESPONSABLEPAGOCARGUE') || 'E', 'rndc.responsablePagoDescargue': fijo('M', 'CODRESPONSABLEPAGODESCARGUE') || 'E',
      'rndc.aplicarFopat': !!fijos.find(f => txt(f[1]).toUpperCase() === 'RETENCIONFOPAT'),
      'rndc.codMunicipioPagoSaldo': fijo('M', 'CODMUNICIPIOPAGOSALDO'),
      'rndc.aceptacionElectronica': fijo('M', 'ACEPTACIONELECTRONICA').toUpperCase() === 'SI',
      'rndc.nitMonitoreoFlota': fijo('M', 'NITMONITOREOFLOTA').includes('{NIT}') ? nitCompleto : fijo('M', 'NITMONITOREOFLOTA'),
      // Variables de la plantilla que no tienen campo propio
      'rndc.extras': fijo('R', 'TIPOCONSOLIDADA') ? [{ proceso: 3, variable: 'TIPOCONSOLIDADA', valor: fijo('R', 'TIPOCONSOLIDADA') }] : [],
    };
    if (!txt(empresa.direccion) && txt(fichas[1]?.[4])) set.direccion = txt(fichas[1][4]);
    if (!txt(empresa.telefono) && txt(fichas[1]?.[7])) set.telefono = entero(fichas[1][7]);
    if (!txt(empresa.ciudad) && txt(fichas[1]?.[10])) set.ciudad = nombrePropio(txt(fichas[1][10]));
    await Empresa.updateOne({ _id: E }, { $set: set }, { runValidators: true });
    // Consecutivos: la plantilla guarda el PRÓXIMO número; el contador guarda el último usado.
    await fijarMinimo(E, 'remesa', (num(cfgFilas[7]?.[1]) || 1) - 1);
    await fijarMinimo(E, 'manifiesto', (num(cfgFilas[9]?.[1]) || 1) - 1);
    res.configuracion = 'importada (el ambiente sigue en SIMULADO; cámbielo en Configuración cuando lo valide)';
  } else {
    res.configuracion = txt(empresa.rndc?.usuario) ? 'la empresa ya tenía configuración RNDC: no se modificó' : 'sin hoja RNDC_CONFIG';
  }
  const sedeRemitenteDef = txt(fijos.find(f => txt(f[1]).toUpperCase() === 'CODSEDEREMITENTE')?.[2]);

  // ── 2. Clientes (Empresas + CORREOS + remitentes de RNDC_FICHAS) ──────────
  const remitentes = new Map();
  for (const f of fichas.slice(5)) if (txt(f[25])) remitentes.set(entero(f[25]), { nombre: txt(f[26]), direccion: txt(f[27]) });
  const correos = new Map(H('CORREOS').slice(1).filter(f => txt(f[0])).map(f => [normalizar(f[0]), f]));
  const clientesExistentes = new Map((await Cliente.find({ empresa: E }).lean()).map(c => [normalizar(c.nombre), c]));
  const nombresClientes = new Map();
  for (const f of H('Empresas').slice(1)) if (txt(f[0])) nombresClientes.set(normalizar(f[0]), { nombre: txt(f[0]), nit: entero(f[2]) });
  for (const [k, f] of correos) if (!nombresClientes.has(k)) nombresClientes.set(k, { nombre: txt(f[0]), nit: '' });
  let cN = 0; let cA = 0;
  for (const [k, c] of nombresClientes) {
    const co = correos.get(k);
    const lista = co ? String(co[1] || '').split(/[,;]/).map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) : [];
    const datos = { nombre: c.nombre, tipoId: 'N', nit: c.nit, razonSocial: txt(co?.[2]) || remitentes.get(c.nit)?.nombre || '',
      sedeRemitente: sedeRemitenteDef, correos: lista };
    const ex = clientesExistentes.get(k);
    if (!ex) { clientesExistentes.set(k, await Cliente.create({ ...datos, empresa: E })); cN += 1; continue; }
    const set = camposFaltantes(ex, datos);
    if (Object.keys(set).length) { await Cliente.updateOne({ empresa: E, _id: ex._id }, { $set: set }); cA += 1; }
  }
  res.clientes = { nuevos: cN, completados: cA };
  const clientePorNombre = (n) => clientesExistentes.get(normalizar(n));

  // ── 3. Sedes de destinatarios (RNDC_SEDES) como terceros NIT con sede ────
  const sedes = H('RNDC_SEDES').slice(1).filter(f => entero(f[0]) && num(f[2]))
    .map(f => ({ id: entero(f[0]), nombre: txt(f[1]), codigo: String(num(f[2])), preferida: txt(f[3]).toUpperCase() === 'SI',
      codMunicipio: entero(f[4]), municipio: txt(f[5]), direccion: txt(f[6]) }));
  const nombreDeNit = (nit) => remitentes.get(nit)?.nombre || [...clientesExistentes.values()].find(c => soloDigitos(c.nit) === nit)?.razonSocial
    || [...clientesExistentes.values()].find(c => soloDigitos(c.nit) === nit)?.nombre || `NIT ${nit}`;

  // ── 4. Terceros: titulares y conductores de RNDC_FICHAS, luego _CONDUCTORES ─
  const terceros = new Map();   // clave tipo|doc|sede → datos
  const agregarTercero = (d, fuente) => {
    const k = `${d.tipoId}|${d.numId}|${d.sede?.codigo || ''}`;
    const prev = terceros.get(k);
    if (!prev) { terceros.set(k, { ...d, _fuente: fuente }); return; }
    // completa campos vacíos y une roles
    for (const [c, v] of Object.entries(d)) {
      if (c === 'roles') prev.roles = [...new Set([...prev.roles, ...v])];
      else if (v && typeof v === 'object' && !(v instanceof Date)) prev[c] = { ...v, ...Object.fromEntries(Object.entries(prev[c] || {}).filter(([, x]) => x)) };
      else if (!prev[c] && v) prev[c] = v;
    }
  };
  for (const s of sedes) {
    agregarTercero({ tipoId: 'N', numId: s.id, nombres: nombreDeNit(s.id), sede: { codigo: s.codigo, nombre: s.nombre.slice(0, 20) },
      direccion: s.direccion.slice(0, 60), codMunicipio: s.codMunicipio, roles: ['destinatario'] }, 'rndc');
  }
  for (const f of fichas.slice(5)) {
    const doc = cedula(f[9]);
    if (doc && txt(f[10])) {
      const tipo = tipoDoc(doc);
      const n = tipo === 'N' ? { nombres: txt(f[10]), apellido1: '', apellido2: '' } : partirNombre(f[10]);
      const tel = telefonoValido(f[12]);
      agregarTercero({ tipoId: tipo, numId: doc, ...n, direccion: txt(f[11]).slice(0, 60), telefono: tel.length <= 7 ? tel : '',
        celular: tel.length === 10 ? tel : '', codMunicipio: municipioDe(f[13]), roles: ['titular'] }, 'rndc');
    }
    const ced = cedula(f[15]);
    if (ced && txt(f[16])) {
      const lic = txt(f[19]).match(/^([A-Z]\d?)-?(\S*)$/i);
      agregarTercero({ tipoId: 'C', numId: ced, ...partirNombre(f[16]), direccion: txt(f[17]).slice(0, 60),
        celular: telefonoValido(f[18]).length === 10 ? telefonoValido(f[18]) : '', telefono: telefonoValido(f[18]).length <= 7 ? telefonoValido(f[18]) : '',
        licencia: lic ? { categoria: lic[1].toUpperCase(), numero: lic[2] || '' } : {}, codMunicipio: municipioDe(f[20]), roles: ['conductor'] }, 'rndc');
    }
  }
  const conductoresHoja = H('_CONDUCTORES').slice(1).filter(f => txt(f[0]) && txt(f[1]));
  const cedPorNombre = new Map(); const cedPorPlaca = new Map();
  const sinCedula = [];
  for (const f of conductoresHoja) {
    const ced = cedula(f[2]);
    const placa = placaKey(f[1]);
    if (!ced) { sinCedula.push(`${txt(f[0])} (${placa})`); continue; }
    cedPorNombre.set(normalizar(f[0]), ced);
    cedPorPlaca.set(placa, ced);
    const k = `C|${ced}|`;
    const existeOficial = terceros.has(k);
    agregarTercero({
      tipoId: 'C', numId: ced, ...(existeOficial ? {} : partirNombre(nombrePropio(txt(f[0])))),
      celular: telefonoValido(f[6]).slice(0, 10), fechaNacimiento: fecha(f[7]),
      licencia: { numero: entero(f[8]), categoria: txt(f[13]).toUpperCase().slice(0, 3), vence: fecha(f[5]) },
      direccion: txt(f[14]).slice(0, 60), codMunicipio: municipioDe(f[16], f[15]),
      banco: { cuenta: entero(f[17]), tipoCuenta: txt(f[18]), entidad: entero(f[19]) }, roles: ['conductor'],
    }, existeOficial ? 'rndc' : 'excel');
    const tenedor = cedula(f[9]);
    if (tenedor && txt(f[10])) {
      agregarTercero({ tipoId: tipoDoc(tenedor), numId: tenedor, ...(terceros.has(`${tipoDoc(tenedor)}|${tenedor}|`) ? {} : partirNombre(txt(f[10]))),
        celular: telefonoValido(f[20]).slice(0, 10), direccion: txt(f[21]).slice(0, 60), codMunicipio: municipioDe(f[23], f[22]), roles: ['tenedor'] }, 'excel');
    }
  }
  // Guardar terceros: nuevos en bloque, existentes solo completando campos vacíos.
  const existentesT = new Map((await Tercero.find({ empresa: E }).lean()).map(x => [`${x.tipoId}|${x.numId}|${x.sede?.codigo || ''}`, x]));
  // Una persona (no NIT) es única por documento, sin importar la sede
  const personas = new Map([...existentesT.values()].filter(x => x.tipoId !== 'N').map(x => [String(x.numId), x]));
  const nuevosT = []; let tA = 0; let tRevisar = 0;
  const ahora = new Date();
  for (const [k, d] of terceros) {
    const { _fuente, ...datos } = d;
    if (!datos.nombres) continue;
    const ex = existentesT.get(k) || (datos.tipoId !== 'N' ? personas.get(String(datos.numId)) : null);
    if (ex) {
      if (!ex._id) continue;
      const set = camposFaltantes(ex, datos);
      if (Object.keys(set).length) { await Tercero.updateOne({ empresa: E, _id: ex._id }, { $set: set }); tA += 1; }
      continue;
    }
    const doc = { ...datos, empresa: E, activo: true };
    // Los de RNDC_FICHAS/RNDC_SEDES ya están en el RNDC: se marcan sincronizados para no reenviarlos.
    if (_fuente === 'rndc') {
      doc.rndc = { estado: 'enviado', fecha: ahora, hash: huella(variablesTercero(empresa, doc)),
        mensaje: 'Importado de la plantilla (datos del RNDC). Revise nombres/apellidos antes de reenviar.' };
    } else {
      doc.rndc = { estado: 'sin_enviar', mensaje: 'Importado de la plantilla: verifique nombres, apellidos y municipio antes de enviar al RNDC.' };
      tRevisar += 1;
    }
    nuevosT.push(doc);
    if (doc.tipoId !== 'N') personas.set(String(doc.numId), doc);
  }
  for (let i = 0; i < nuevosT.length; i += 1000) await Tercero.insertMany(nuevosT.slice(i, i + 1000), { ordered: false });
  res.terceros = { nuevos: nuevosT.length, completados: tA, porRevisar: tRevisar, conductoresSinCedula: sinCedula.length };
  if (sinCedula.length) res.avisos.push(`Conductores sin cédula en _CONDUCTORES (no se crearon): ${sinCedula.slice(0, 15).join(', ')}${sinCedula.length > 15 ? '…' : ''}`);
  const idTercero = new Map((await Tercero.find({ empresa: E }).select('tipoId numId sede').lean())
    .filter(x => !x.sede?.codigo).map(x => [`${x.tipoId}|${x.numId}`, x._id]));

  // ── 5. Vehículos (RNDC_FICHAS + _CONDUCTORES) ────────────────────────────
  const vehiculos = new Map();
  for (const f of fichas.slice(5)) {
    const placa = placaKey(f[0]);
    if (!/^[A-Z0-9]{5,6}$/.test(placa)) continue;
    const aseg = txt(f[4]).match(/^(\d{6,11})\s+(.*)$/);
    const titular = cedula(f[7]);
    vehiculos.set(placa, {
      placa, marcaNombre: txt(f[1]).slice(0, 40), configuracionNombre: txt(f[2]).toUpperCase().slice(0, 4), pesoVacio: num(f[3]),
      soat: { numero: entero(f[5]).slice(0, 20), vence: fecha(f[6]), aseguradoraNit: aseg?.[1] || '' }, aseguradoraSoat: (aseg?.[2] || txt(f[4])).slice(0, 60),
      pbv: num(f[8]), titularHabitual: titular ? idTercero.get(`${tipoDoc(titular)}|${titular}`) || null : null, _rndc: true,
    });
  }
  for (const f of conductoresHoja) {
    const placa = placaKey(f[1]);
    if (!/^[A-Z0-9]{5,6}$/.test(placa)) continue;
    const ced = cedula(f[2]); const ten = cedula(f[9]);
    const v = vehiculos.get(placa) || { placa };
    v.venceTecnomecanica = v.venceTecnomecanica || fecha(f[3]);
    v.soat = { ...(v.soat || {}), vence: v.soat?.vence || fecha(f[4]) };
    if (!v.pbv && num(f[11])) v.pbv = num(f[11]);
    if (!v.pesoVacio && num(f[12])) v.pesoVacio = num(f[12]);
    if (ced && !v.conductorHabitual) v.conductorHabitual = idTercero.get(`C|${ced}`) || null;
    if (ten) v.tenedor = { tipoId: tipoDoc(ten), numId: ten };
    vehiculos.set(placa, v);
  }
  const existentesV = new Map((await Vehiculo.find({ empresa: E }).lean()).map(v => [v.placa, v]));
  const nuevosV = []; let vA = 0;
  for (const [placa, d] of vehiculos) {
    const { _rndc, ...datos } = d;
    const ex = existentesV.get(placa);
    if (ex) {
      const set = camposFaltantes(ex, datos);
      if (Object.keys(set).length) { await Vehiculo.updateOne({ empresa: E, _id: ex._id }, { $set: set }); vA += 1; }
      continue;
    }
    // Las fichas no traen los códigos RNDC (marca, línea, carrocería…): quedan pendientes de completar.
    nuevosV.push({ ...datos, empresa: E, activo: true,
      rndc: { estado: 'sin_enviar', mensaje: 'Importado de la plantilla: complete los códigos RNDC (marca, línea, configuración) o tráigalo del RNDC.' } });
  }
  for (let i = 0; i < nuevosV.length; i += 1000) await Vehiculo.insertMany(nuevosV.slice(i, i + 1000), { ordered: false });
  res.vehiculos = { nuevos: nuevosV.length, completados: vA };

  // ── 6. Destinos y tarifas (Fletes) ───────────────────────────────────────
  const dane = H('RNDC_DANE').slice(1).filter(f => txt(f[4]))
    .map(f => ({ depto: txt(f[0]).padStart(2, '0'), codigo: entero(f[4]).padStart(8, '0'), norm: normalizar(f[5] || f[3]), corto: normalizar(f[6]) }));
  const alias = H('RNDC_ALIAS').slice(1).filter(f => txt(f[0]) && txt(f[1])).map(f => ({ clave: normalizar(f[0]), municipio: normalizar(f[1]) }));
  const municipioDestino = dane.length ? resolvedorDestinos(dane, alias) : () => '';
  const existentesTar = new Map((await Tarifa.find({ empresa: E }).lean()).map(t => [`${t.cliente}|${normalizar(t.destino)}`, t]));
  let fN = 0; let fA = 0; let fSinMuni = 0;
  for (const f of H('Fletes').slice(1)) {
    const cli = clientePorNombre(f[0]); const destino = txt(f[1]);
    if (!cli || !destino) continue;
    const nitCli = soloDigitos(cli.nit);
    let codMunicipio = municipioDestino(destino);
    let operacion = '';
    if (nitCli === NIT_CORBETA && destinoUrbano(destino)) { codMunicipio = '52001000'; operacion = 'U'; }
    if (!codMunicipio) fSinMuni += 1;
    const sede = sedeDe(sedes, nitCli, destino);
    const datos = {
      cliente: cli._id, destino, codMunicipio, tipoCobro: esTat(destino) ? 'unidad' : 'viaje',
      tarifaCliente: num(f[2]) || 0, tarifaAuxiliar: num(f[3]) || 0, fleteConductor: num(f[4]) || 0, auxiliarPagado: num(f[5]) || 0,
      anticipoHabitual: num(f[7]) || 0, pesoKg: pesoPorDestino(destino), operacion,
      destinatario: sede ? { tipoId: 'N', numId: nitCli, sede } : { tipoId: '', numId: '', sede: '' },
    };
    const k = `${cli._id}|${normalizar(destino)}`;
    const ex = existentesTar.get(k);
    if (!ex) { existentesTar.set(k, await Tarifa.create({ ...datos, empresa: E })); fN += 1; continue; }
    const set = camposFaltantes(ex, datos);
    if (Object.keys(set).length) { await Tarifa.updateOne({ empresa: E, _id: ex._id }, { $set: set }); fA += 1; }
  }
  res.tarifas = { nuevas: fN, completadas: fA, sinMunicipio: fSinMuni };
  if (fSinMuni) res.avisos.push(`${fSinMuni} destino(s) sin municipio DIVIPOLA identificado: complételo en Clientes y tarifas.`);

  // La sincronización de maestros no toca los viajes
  if (soloMaestros) return res;

  // ── 7. Viajes (BITACORA + RNDC_VIAJES + RELACION) ────────────────────────
  const rndcViajes = new Map();
  for (const f of H('RNDC_VIAJES').slice(4)) if (num(f[0])) rndcViajes.set(`${num(f[0])}|${placaKey(f[3])}`, f);
  const fichasCond = fichas.slice(5).filter(f => cedula(f[15]) && txt(f[16])).map(f => ({ ced: cedula(f[15]), nom: ` ${normalizar(f[16])} ` }));
  const cedPorFichas = (nombre) => {
    const t = normalizar(nombre).split(' ').filter(x => x.length >= 2);
    if (t.length < 2) return '';
    const c = new Set(fichasCond.filter(x => t.every(w => x.nom.includes(` ${w} `))).map(x => x.ced));
    return c.size === 1 ? [...c][0] : '';
  };
  const relacion = H('RELACION').slice(10).filter(f => placaKey(f[3]) && txt(f[1]) && fecha(f[6]));
  const tarifasPorCliente = [...existentesTar.values()];
  const existentesVi = new Set((await Viaje.find({ empresa: E }).select('numero').lean()).map(v => v.numero));
  const nuevosVi = []; let maxNumero = 0; let conRndc = 0; let sinConductor = 0;
  for (const f of H('BITACORA').slice(2)) {
    const numero = num(f[0]);
    const cli = clientePorNombre(f[1]);
    if (!numero || !cli) continue;
    maxNumero = Math.max(maxNumero, numero);
    if (existentesVi.has(numero)) continue;
    const placa = placaKey(f[4]) || 'SINPLA';
    const nombreCond = nombrePropio(txt(f[3]));
    const rv = rndcViajes.get(`${numero}|${placa}`);
    const ced = cedPorNombre.get(normalizar(f[3])) || cedula(rv?.[8]) || cedPorPlaca.get(placa) || cedPorFichas(f[3]);
    const conductor = ced ? idTercero.get(`C|${ced}`) || null : null;
    if (!conductor) sinConductor += 1;
    const destino = txt(f[6]) || '(sin destino)';
    const tarifa = tarifasPorCliente.find(t => String(t.cliente) === String(cli._id) && normalizar(t.destino) === normalizar(destino));
    const fechaViaje = fecha(f[5]);
    const rel = relacion.find(r => placaKey(r[3]) === placa && fecha(r[6])?.getTime() === fechaViaje?.getTime() && normalizar(r[5]) === normalizar(destino));
    const v = {
      empresa: E, numero, fecha: fechaViaje || new Date(), cliente: cli._id, tarifaRef: tarifa?._id || null, destino,
      codOrigen: cedula(rv?.[9]) || '', codDestino: cedula(rv?.[10]) || tarifa?.codMunicipio || '',
      placa, conductor, conductorNombre: nombreCond, pesoKg: num(f[7]) || num(rv?.[18]) || 0,
      tarifa: num(f[8]) || 0, flete: num(f[9]) || 0, anticipo: num(f[10]) || 0,
      conAuxiliar: rel ? txt(rel[9]) !== 'No' : (num(f[11]) || 0) > 0, cantidad: rel ? num(rel[7]) || 1 : 1,
      observaciones: txt(f[14]).slice(0, 500), creadoPor: usuario, historico: true, estado: 'registrado',
      reporteWhatsapp: { fecha: fechaHoraTexto(f[12]), usuario: null },
      // Con soporte interno (MC…) en la columna MANIFIESTO: el viaje no lleva manifiesto del RNDC
      ...(/^MC\d+$/i.test(txt(f[2])) ? { requiereManifiesto: false } : {}),
      ...(num(f[19]) >= 1 ? { conAuxiliar: true, diasAuxiliar: Math.min(5, Math.round(num(f[19]))) } : {}),
    };
    if (rv && cedula(rv[16]) && /OK/i.test(txt(rv[15]))) {
      const fAcept = fechaHoraTexto(rv[17]);
      v.remesa = { numero: txt(rv[11]), radicado: cedula(rv[14]), estado: 'aceptado', fecha: fAcept, mensaje: 'Importado de la plantilla' };
      v.manifiesto = { numero: txt(rv[12]), radicado: cedula(rv[16]), qr: txt(rv[24]), estado: 'aceptado', fecha: fAcept, mensaje: txt(rv[17]) };
      v.destinatario = { tipoId: txt(rv[21]).toUpperCase(), numId: cedula(rv[22]), sede: cedula(rv[23]) };
      if (cedula(rv[19])) v.titular = idTercero.get(`${tipoDoc(cedula(rv[19]))}|${cedula(rv[19])}`) || null;
      v.estado = 'manifestado';
      v.historico = false;   // tiene radicado y QR: se puede cumplir y descargar desde la plataforma
      conRndc += 1;
    }
    nuevosVi.push(v);
  }
  if (nuevosVi.length) await Viaje.insertMany(nuevosVi, { ordered: false });
  await fijarMinimo(E, 'viaje', maxNumero);
  res.viajes = { nuevos: nuevosVi.length, conManifiestoRndc: conRndc, historicos: nuevosVi.length - conRndc, sinConductorEnMaestro: sinConductor };
  if (sinConductor) res.avisos.push(`${sinConductor} viaje(s) sin conductor identificado en los maestros: conservan el nombre escrito en la bitácora.`);
  // Préstamos, contabilidad, liquidaciones, soportes internos, correos, autorizaciones y registro del RNDC
  res.gestion = await importarGestion(E, wb);
  return res;
}

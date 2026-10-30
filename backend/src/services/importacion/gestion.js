// Datos de gestión de la plantilla de Excel que complementan los viajes y maestros:
//   _PRESTAMOS (+ cuotas y abonos) ..... préstamos a conductores
//   _CONT_ASIENTOS ..................... asientos contables
//   _CONT_FACTURAS ..................... facturas a clientes (cobradas según sus asientos)
//   _LIQUIDACIONES ..................... liquidaciones de conductores (NP-0001…) y sus viajes (columna LIQUIDACION de la BITACORA)
//   _SOPORTES .......................... soportes internos MC/RC de cada viaje, con su código de verificación
//   BITACORA ........................... días de auxiliar de los viajes que no los tienen
//   CORREOS ............................ destinatarios de manifiestos y de relaciones de cada cliente
//   _CONFIG_CORREO ..................... cuenta de correo de la empresa (queda desactivada hasta probarla)
//   _AUTORIZACIONES .................... autorizaciones del administrador
//   REGISTRO_ENVIOS, _PDF_ENVIADOS ..... historial de correos enviados
//   RNDC_LOG ........................... registro técnico de los envíos al RNDC
// No duplica: lo que ya existe (por número, viaje o fecha) se deja igual. Con `aplicar: false` solo cuenta.
import { Empresa, Cliente, Tercero, Viaje, Prestamo, Asiento, FacturaCont, LiquidacionConductor, Contador, Usuario, Autorizacion,
  EnvioCorreo, TransaccionRndc } from '../../models/index.js';
import { normalizar } from '../../utils/texto.js';
import { cifrar } from '../../utils/cifrado.js';
import { filas, txt, entero, num, fecha, fechaHoraTexto } from './excel.js';
import { asegurarPuc } from '../gestion/contabilidad.js';

const correosDe = (t) => [...new Set(String(t || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))];
const fechaTexto = (v) => (v instanceof Date ? v : fechaHoraTexto(txt(v)) || fecha(v));

export async function importarGestion(empresaId, wb, { aplicar = true } = {}) {
  const E = empresaId;
  const H = (n) => (wb.getWorksheet(n) ? filas(wb.getWorksheet(n)).slice(1) : []);
  const res = { prestamos: 0, asientos: 0, facturas: 0, liquidaciones: 0, viajesLiquidados: 0, soportes: 0, diasAuxiliar: 0,
    correosClientes: 0, cuentaCorreo: '', autorizaciones: 0, correosEnviados: 0, transaccionesRndc: 0, contadores: {} };
  const clientes = await Cliente.find({ empresa: E }).lean();
  const clientePorNombre = (n) => clientes.find(c => normalizar(c.nombre) === normalizar(n));
  const bitacora = H('BITACORA').slice(1);     // la plantilla tiene dos filas de encabezado

  // ── Préstamos con sus cuotas y abonos ──
  const cuotas = H('_PRESTAMOS_CUOTAS'); const abonos = H('_PRESTAMOS_ABONOS');
  for (const f of H('_PRESTAMOS').filter(x => txt(x[0]))) {
    const numero = txt(f[0]);
    if (await Prestamo.exists({ empresa: E, numero })) continue;
    const cedula = entero(f[2]);
    const t = await Tercero.findOne({ empresa: E, numId: cedula }).lean();
    const estado = txt(f[11]).toUpperCase();
    if (aplicar) await Prestamo.create({
      empresa: E, numero, fecha: fecha(f[1]), conductor: t?._id || null, cedula, conductorNombre: txt(f[3]), placa: txt(f[4]).toUpperCase(),
      concepto: txt(f[5]), capital: num(f[6]) || 0, tasaMensual: num(f[7]) || 0, nCuotas: num(f[8]) || 1, valorCuota: num(f[9]) || 0,
      primeraCuota: fecha(f[10]), estado: ['VIGENTE', 'PAGADO', 'ANULADO'].includes(estado) ? estado : 'VIGENTE', observacion: txt(f[12]),
      cuotas: cuotas.filter(c => txt(c[0]) === numero).map(c => ({ n: num(c[1]), fecha: fecha(c[2]), valor: num(c[3]) || 0, capital: num(c[4]) || 0, interes: num(c[5]) || 0,
        saldoCapital: num(c[6]) || 0, abonado: num(c[7]) || 0, fechaAbono: fecha(c[8]), liquidacion: txt(c[9]) })),
      abonos: abonos.filter(a => txt(a[0]) === numero).map(a => ({ fecha: fecha(a[1]), valor: num(a[2]) || 0, origen: txt(a[3]), liquidacion: txt(a[4]), nota: txt(a[5]) })),
    });
    res.prestamos += 1;
  }

  // ── Asientos contables (una fila por línea; se agrupan por ID) ──
  if (aplicar) await asegurarPuc(E);
  const ORIGEN = { FACT: 'FAC', COBRO: 'COB', PAGO: 'PAG' };
  const porId = new Map();
  for (const f of H('_CONT_ASIENTOS').filter(x => txt(x[0]))) {
    const id = txt(f[0]);
    if (!porId.has(id)) porId.set(id, { numero: id, fecha: fecha(f[1]), terceroDoc: entero(f[4]), tercero: txt(f[5]), documento: txt(f[6]), centroCosto: txt(f[7]),
      concepto: txt(f[10]), origen: ORIGEN[txt(f[11]).toUpperCase()] || txt(f[11]).toUpperCase(), estado: txt(f[12]).toUpperCase() === 'ANULADO' ? 'ANULADO' : 'ACTIVO', lineas: [] });
    porId.get(id).lineas.push({ cuenta: txt(f[2]), nombre: txt(f[3]), debito: num(f[8]) || 0, credito: num(f[9]) || 0 });
  }
  for (const a of porId.values()) {
    if (await Asiento.exists({ empresa: E, numero: a.numero })) continue;
    if (aplicar) await Asiento.create({ ...a, empresa: E });
    res.asientos += 1;
  }
  // Lo pagado o cobrado de un documento según sus asientos activos
  const movido = (documento, origen, cuenta, lado) => [...porId.values()].filter(a => a.documento === documento && a.origen === origen && a.estado === 'ACTIVO')
    .reduce((s, a) => s + a.lineas.filter(l => l.cuenta === cuenta).reduce((x, l) => x + l[lado], 0), 0);

  // ── Facturas ──
  for (const f of H('_CONT_FACTURAS').filter(x => txt(x[0]))) {
    const numero = txt(f[0]);
    if (await FacturaCont.exists({ empresa: E, numero })) continue;
    const cli = clientePorNombre(f[2]);
    if (!cli) continue;
    const neto = num(f[10]) || 0; const estado = txt(f[11]).toUpperCase();
    const cobrado = Math.min(neto, movido(numero, 'COB', '1305', 'credito') || (estado === 'COBRADA' ? neto : 0));
    if (aplicar) await FacturaCont.create({ empresa: E, numero, fecha: fecha(f[1]), cliente: cli._id, desde: fecha(f[4]), hasta: fecha(f[5]), viajes: num(f[6]) || 0,
      total: num(f[7]) || 0, retefuentePct: num(f[8]) || 0, retefuente: num(f[9]) || 0, icaPct: num(f[13]) || 0, ica: num(f[14]) || 0, neto, cobrado,
      estado: estado === 'ANULADA' ? 'ANULADA' : cobrado >= neto ? 'COBRADA' : 'PENDIENTE', asiento: txt(f[12]) });
    res.facturas += 1;
  }

  // ── Liquidaciones de conductores y sus viajes ──
  const viajesDeLiq = new Map();
  for (const f of bitacora) if (/^[A-Z]+-\d+$/i.test(txt(f[18]))) {
    const k = txt(f[18]).toUpperCase();
    viajesDeLiq.set(k, [...(viajesDeLiq.get(k) || []), num(f[0])]);
  }
  const siglasUsadas = {};
  for (const f of H('_LIQUIDACIONES').filter(x => /^[A-Z]+-\d+$/i.test(txt(x[0])))) {
    const numero = txt(f[0]).toUpperCase();
    const [siglas, n] = numero.split('-');
    siglasUsadas[siglas] = Math.max(siglasUsadas[siglas] || 0, Number(n));
    if (await LiquidacionConductor.exists({ empresa: E, numero })) continue;
    const cli = clientePorNombre(txt(f[12]).split(',')[0]);
    // Los viajes marcados con esta liquidación en la bitácora; si no hay, los de la placa y el cliente en el periodo
    let viajes = viajesDeLiq.has(numero) ? await Viaje.find({ empresa: E, numero: { $in: viajesDeLiq.get(numero) } }).lean() : [];
    if (!viajes.length && cli) viajes = await Viaje.find({ empresa: E, placa: txt(f[2]).toUpperCase(), cliente: cli._id, fecha: { $gte: fecha(f[5]), $lte: fecha(f[6]) } }).lean();
    viajes = viajes.filter(v => !v.liquidacionConductor);
    const cedula = entero(f[4]);
    const t = cedula ? await Tercero.findOne({ empresa: E, numId: cedula }).select('_id').lean() : null;
    const neto = num(f[11]) || 0;
    if (aplicar) {
      const l = await LiquidacionConductor.create({ empresa: E, numero, fecha: fecha(f[1]), placa: txt(f[2]).toUpperCase(), conductor: t?._id || null, conductorNombre: txt(f[3]), cedula,
        desde: fecha(f[5]), hasta: fecha(f[6]), viajes: viajes.map(v => v._id),
        lineas: viajes.map(v => ({ viaje: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: v.conductorNombre, cedula, destino: v.destino,
          empresa: cli?.nombre || '', manifiesto: v.manifiesto?.numero || v.soporteInterno?.mc || '', flete: v.flete || 0, anticipo: v.anticipo || 0 })),
        flete: num(f[7]) || 0, auxiliar: Math.max(0, neto - ((num(f[7]) || 0) - (num(f[8]) || 0) - (num(f[9]) || 0) - (num(f[10]) || 0))),
        anticipo: num(f[8]) || 0, anticipoReconocido: num(f[8]) || 0, retefuente: num(f[9]) || 0, fopat: num(f[10]) || 0, descuentoPrestamos: 0, interesPrestamos: 0, neto,
        pagado: Math.min(neto, movido(numero, 'PAG', '2205', 'debito')), empresas: txt(f[12]), agrupacion: 'placa_empresa' });
      await Viaje.updateMany({ empresa: E, _id: { $in: l.viajes } }, { $set: { liquidacionConductor: l._id } });
      // Las siglas de la liquidación son las del cliente (NP-0001 → Nutrisur Pasto)
      if (cli && !cli.siglas) { await Cliente.updateOne({ empresa: E, _id: cli._id }, { $set: { siglas } }); cli.siglas = siglas; }
    }
    res.liquidaciones += 1; res.viajesLiquidados += viajes.length;
  }

  // ── Soportes internos MC/RC (el código de verificación se conserva: los QR impresos siguen sirviendo) ──
  const soportes = H('_SOPORTES').filter(x => /^MC\d+$/.test(txt(x[0])) && num(x[2]));
  for (const f of soportes) {
    const filtro = { empresa: E, numero: num(f[2]), $or: [{ 'soporteInterno.mc': { $in: ['', null] } }, { soporteInterno: null }] };
    if (!(await Viaje.exists(filtro))) continue;
    if (aplicar) await Viaje.updateOne(filtro, { $set: { soporteInterno: { mc: txt(f[0]), rc: txt(f[1]), codigo: txt(f[9]).toUpperCase(), fecha: fechaTexto(f[8]) || fecha(f[4]) },
      requiereManifiesto: false } });
    res.soportes += 1;
  }

  // ── Días de auxiliar de la bitácora (de 1 a 5) en los viajes que no los tienen ──
  for (const f of bitacora) {
    const dias = Math.min(5, Math.round(num(f[19]) || 0));
    if (!num(f[0]) || dias < 1) continue;
    const filtro = { empresa: E, numero: num(f[0]), diasAuxiliar: { $in: [0, null] }, liquidacion: null };
    if (!(await Viaje.exists(filtro))) continue;
    if (aplicar) await Viaje.updateOne(filtro, { $set: { conAuxiliar: true, diasAuxiliar: dias } });
    res.diasAuxiliar += 1;
  }

  // ── Destinatarios de cada cliente: manifiestos (columnas A-C) y relaciones (columnas E-G) ──
  const correos = H('CORREOS');
  for (const cli of clientes) {
    const man = correos.find(f => normalizar(f[0]) === normalizar(cli.nombre));
    const rel = correos.find(f => normalizar(f[4]) === normalizar(cli.nombre));
    const set = {};
    if (man && !cli.envios?.destinatarios?.length && correosDe(man[1]).length) {
      set.envios = { ...(cli.envios || {}), activo: true, destinatarios: correosDe(man[1]), cc: cli.envios?.cc || [],
        documentos: { manifiesto: true, salida: !!cli.envios?.documentos?.salida } };
    }
    if (rel && !cli.enviosRelaciones?.destinatarios?.length && correosDe(rel[5]).length) set.enviosRelaciones = { destinatarios: correosDe(rel[5]), cc: [] };
    if (!Object.keys(set).length) continue;
    if (aplicar) await Cliente.updateOne({ empresa: E, _id: cli._id }, { $set: set });
    res.correosClientes += 1;
  }

  // ── Cuenta de correo (Gmail) de la plantilla: se guarda desactivada; se activa tras «Enviar prueba» ──
  // Esta hoja no tiene encabezado: cada fila es «dato: valor»
  const cfg = new Map((wb.getWorksheet('_CONFIG_CORREO') ? filas(wb.getWorksheet('_CONFIG_CORREO')) : []).map(f => [normalizar(f[0]), txt(f[1])]));
  const remitente = (cfg.get(normalizar('Correo remitente (Gmail):')) || '').toLowerCase();
  const empresa = await Empresa.findById(E).select('smtp').lean();
  if (remitente && !empresa?.smtp?.host) {
    const clave = (cfg.get(normalizar('Contrasena de aplicacion:')) || '').replace(/\s+/g, '');
    if (aplicar) await Empresa.updateOne({ _id: E }, { $set: { 'smtp.activo': false, 'smtp.host': 'smtp.gmail.com', 'smtp.puerto': 587, 'smtp.seguridad': 'starttls',
      'smtp.usuario': remitente, 'smtp.remitenteCorreo': remitente, 'smtp.remitenteNombre': cfg.get(normalizar('Nombre a mostrar:')) || '',
      ...(clave ? { 'smtp.claveCifrada': cifrar(clave) } : {}) } });
    res.cuentaCorreo = `${remitente} (desactivada: pruébela y actívela en Configuración → Correo)`;
  }

  // ── Autorizaciones del administrador ──
  const admin = await Usuario.findOne({ empresa: E, rol: 'admin' }).select('_id nombre').lean();
  if (admin) {
    for (const f of H('_AUTORIZACIONES').filter(x => txt(x[0]))) {
      const cuando = fechaTexto(f[0]);
      if (!cuando || await Autorizacion.exists({ empresa: E, createdAt: cuando, motivo: { $regex: /^Plantilla Excel/ } })) continue;
      const [cond, placa] = txt(f[3]).split('/').map(s => s.trim());
      const vencidos = txt(f[4]).split(/\r?\n/).map(s => s.replace(/^[\s-]+/, '').trim()).filter(s => s && !/^Viaje con documentos/i.test(s));
      const viaje = placa ? await Viaje.findOne({ empresa: E, placa: placa.toUpperCase(), fecha: { $lte: cuando } }).sort({ fecha: -1 }).select('_id numero').lean() : null;
      if (aplicar) await Autorizacion.collection.insertOne({ empresa: E, tipo: 'documentos_vencidos', viaje: viaje?._id || null, viajeNumero: viaje?.numero || null,
        placa: (placa || '').toUpperCase(), conductorNombre: cond || '', vencidos, motivo: `Plantilla Excel (autorizó ${txt(f[2]) || 'admin'})`,
        admin: admin._id, adminNombre: admin.nombre, solicitante: null, solicitanteNombre: txt(f[1]), createdAt: cuando, updatedAt: cuando });
      res.autorizaciones += 1;
    }
  }

  // ── Historial de correos: un registro por correo (REGISTRO_ENVIOS) y por manifiesto enviado (_PDF_ENVIADOS) ──
  const nuevosEnvios = [];
  for (const f of H('REGISTRO_ENVIOS').filter(x => txt(x[0]) && txt(x[3]))) {
    const cuando = fechaTexto(f[3]); const cli = clientePorNombre(f[0]);
    if (!cuando || await EnvioCorreo.exists({ empresa: E, asunto: txt(f[1]), enviadoEn: cuando })) continue;
    nuevosEnvios.push({ empresa: E, viaje: null, cliente: cli?._id || null, tipo: 'manifiesto', documento: '', destinatarios: correosDe(f[2]), cc: [],
      asunto: txt(f[1]), estado: 'enviado', intentos: 1, enviadoEn: cuando, origen: 'manual', respuesta: 'Enviado desde la plantilla de Excel', createdAt: cuando, updatedAt: cuando });
  }
  for (const f of H('_PDF_ENVIADOS').filter(x => txt(x[2]) && /enviado/i.test(txt(x[4])))) {
    const documento = txt(f[2]).replace(/\.pdf$/i, '').toUpperCase(); const cuando = fechaTexto(f[3]);
    if (!cuando || await EnvioCorreo.exists({ empresa: E, documento, enviadoEn: cuando })) continue;
    const v = await Viaje.findOne({ empresa: E, $or: [{ 'manifiesto.numero': documento }, { 'soporteInterno.mc': documento }] }).select('_id cliente').lean();
    const cli = clientePorNombre(f[1]);
    nuevosEnvios.push({ empresa: E, viaje: v?._id || null, cliente: v?.cliente || cli?._id || null, tipo: 'manifiesto', documento, destinatarios: cli?.correos || [], cc: [],
      asunto: `Manifiesto ${documento}`, adjuntos: [txt(f[2])], estado: 'enviado', intentos: 1, enviadoEn: cuando, origen: 'manual',
      respuesta: 'Enviado desde la plantilla de Excel', createdAt: cuando, updatedAt: cuando });
  }
  if (aplicar && nuevosEnvios.length) await EnvioCorreo.collection.insertMany(nuevosEnvios);
  res.correosEnviados = nuevosEnvios.length;

  // ── Registro técnico del RNDC (la plantilla ya lo guardaba sin la clave) ──
  const nuevasTx = [];
  for (const f of H('RNDC_LOG').filter(x => txt(x[0]) && txt(x[3]))) {
    const cuando = fechaTexto(f[0]);
    if (!cuando || await TransaccionRndc.exists({ empresa: E, createdAt: cuando, referencia: 'Plantilla Excel' })) continue;
    const solicitud = txt(f[3]).replace(/<clave>[^<]*<\/clave>/gi, '<clave>****</clave>'); const respuesta = txt(f[4]);
    const proceso = Number(solicitud.match(/<procesoid>(\d+)<\/procesoid>/i)?.[1]) || null;
    const tipo = Number(solicitud.match(/<tipo>(\d+)<\/tipo>/i)?.[1]) || null;
    const ingreso = respuesta.match(/ingresoid[^\d]*(\d+)/i)?.[1] || '';
    nuevasTx.push({ empresa: E, usuario: null, ambiente: /pruebas|plc\./i.test(txt(f[1])) ? 'PRUEBAS' : 'PRODUCCION', url: txt(f[1]), tipo, proceso,
      referencia: 'Plantilla Excel', viaje: null, solicitud, respuesta: respuesta.slice(0, 20000), ok: !!ingreso && !/error/i.test(respuesta.slice(0, 2000)),
      radicado: ingreso, mensaje: (respuesta.match(/<ErrorMSG>([^<]*)/i)?.[1] || '').slice(0, 500), duracionMs: 0, createdAt: cuando, updatedAt: cuando });
  }
  if (aplicar && nuevasTx.length) await TransaccionRndc.collection.insertMany(nuevasTx);
  res.transaccionesRndc = nuevasTx.length;

  // ── Numeraciones: continúan después de lo último usado en la plantilla ──
  const ultimo = (lista, re) => Math.max(0, ...lista.map(x => Number(String(x).match(re)?.[1] || 0)));
  const contadores = {
    prestamo: ultimo(H('_PRESTAMOS').map(f => txt(f[0])), /^PR-(\d+)$/),
    asiento: ultimo([...porId.keys()], /^A-(\d+)$/),
    factura: ultimo(H('_CONT_FACTURAS').map(f => txt(f[0])), /^FV-(\d+)$/),
    soporteInterno: ultimo(soportes.map(f => txt(f[0])), /^MC(\d+)$/),
    ...Object.fromEntries(Object.entries(siglasUsadas).map(([s, n]) => [s === 'LC' ? 'liqConductor' : `liqConductor:${s}`, n])),
  };
  for (const [clave, valor] of Object.entries(contadores)) {
    if (!valor) continue;
    res.contadores[clave] = valor;
    if (aplicar) await Contador.updateOne({ empresa: E, clave }, { $max: { valor } }, { upsert: true });
  }
  return res;
}

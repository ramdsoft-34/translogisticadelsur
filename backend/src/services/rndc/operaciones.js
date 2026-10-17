// Operaciones de negocio con el RNDC: despachar (remesa + manifiesto),
// cumplir, anular, registrar maestros y consultar. Cada envío queda en
// TransaccionRndc. La clave del usuario web service se recibe en cada
// operación y nunca se guarda.
import { Empresa, Viaje, Vehiculo, Tercero, Municipio, TransaccionRndc, siguiente, pob } from '../../models/index.js';
import { buscadorMunicipios } from '../importacion/excel.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { enviar, registrarTransaccion } from './cliente.js';
import { xmlRegistro, xmlConsulta, bloqueRemesas, interpretarRegistro, interpretarConsulta, validarVariables, ocultarClave } from './xml.js';
import {
  contextoViaje, variablesRemesa, variablesManifiesto, variablesCumplidoRemesa, variablesCumplidoManifiesto,
  variablesAnulacion, variablesTercero, variablesVehiculo, huella, idCliente, destinoIgualOrigen, PROBLEMA_DESTINO,
} from './documentos.js';
import { TIPOS_ID_CONDUCTOR, MOTIVOS_REEMPLAZO } from './catalogos.js';
import { txt, hoyColombia } from '../../utils/texto.js';

const BLOQUEO_MS = 3 * 60 * 1000;

export async function empresaConRndc(empresaId) {
  const empresa = await Empresa.findById(empresaId).lean();
  if (!empresa) throw new ErrorHttp(404, 'Empresa no encontrada');
  return empresa;
}

function credenciales(empresa, clave) {
  const usuario = txt(empresa.rndc?.usuario);
  if (empresa.rndc?.ambiente !== 'SIMULADO' && !usuario) {
    throw new ErrorHttp(400, 'Configure el usuario del web service del RNDC (Configuración > RNDC)');
  }
  if (!txt(clave)) throw new ErrorHttp(400, 'Escriba la contraseña del usuario RNDC');
  return { usuario: usuario || 'SIMULADO', clave };
}

export async function cargarViaje(empresaId, viajeId) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId })
    .populate(['cliente', 'conductor', 'titular', 'tarifaRef'].map(x => pob(empresaId, x))).lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  const vehiculo = await Vehiculo.findOne({ empresa: empresaId, placa: v.placa }).lean();
  // Sin destinatario en el viaje ni en la tarifa: la sede del cliente en el municipio de destino
  if (!v.destinatario?.numId && !v.tarifaRef?.destinatario?.numId && v.cliente) {
    const codDestino = v.codDestino || v.tarifaRef?.codMunicipio;
    if (codDestino) {
      const sedes = await Tercero.find({ empresa: empresaId, tipoId: v.cliente.tipoId || 'N', numId: idCliente(v.cliente), codMunicipio: codDestino })
        .select('tipoId numId sede codMunicipio').lean();
      sedes.sort((a, b) => (Number(a.sede?.codigo) || 0) - (Number(b.sede?.codigo) || 0));
      const s = sedes.find(x => txt(x.sede?.codigo) && txt(x.sede.codigo) !== txt(v.cliente.sedeRemitente));
      if (s) v.destinatarioAuto = { tipoId: s.tipoId, numId: s.numId, sede: s.sede.codigo, nombreSede: s.sede.nombre || '' };
    }
  }
  // Municipio de la sede del destinatario: será el destino del manifiesto
  const dest = v.destinatario?.numId ? v.destinatario : v.tarifaRef?.destinatario?.numId ? v.tarifaRef.destinatario : v.destinatarioAuto;
  if (dest?.numId && txt(dest.sede)) {
    const sede = await Tercero.findOne({ empresa: empresaId, tipoId: dest.tipoId || 'N', numId: dest.numId, 'sede.codigo': txt(dest.sede) })
      .select('codMunicipio sede').lean();
    if (sede?.codMunicipio) { v.codDestinoSede = sede.codMunicipio; v.nombreSedeDestino = sede.sede?.nombre || ''; }
  }
  return { v, vehiculo };
}

// Bloqueo optimista: evita que dos personas envíen el mismo viaje a la vez.
async function bloquear(empresaId, viajeId) {
  const ahora = new Date();
  const ok = await Viaje.findOneAndUpdate(
    { empresa: empresaId, _id: viajeId, $or: [{ enviandoRndc: null }, { enviandoRndc: { $lt: new Date(ahora - BLOQUEO_MS) } }] },
    { $set: { enviandoRndc: ahora } });
  if (!ok) throw new ErrorHttp(409, 'Este viaje se está enviando al RNDC en este momento');
}
const desbloquear = (empresaId, viajeId) => Viaje.updateOne({ empresa: empresaId, _id: viajeId }, { $set: { enviandoRndc: null } });

// Envía un registro (tipo 1) y lo deja en el log.
async function registrar(empresa, cred, proceso, variables, meta, anexos = '') {
  const xml = xmlRegistro({ usuario: cred.usuario, clave: cred.clave, proceso, variables, anexos });
  const m = { ...meta, empresa: empresa._id, ambiente: empresa.rndc?.ambiente || 'SIMULADO', tipo: 1, proceso };
  const resp = await enviar(xml, m);
  const resultado = resp.conectado ? interpretarRegistro(resp.texto)
    : { ok: false, radicado: '', qr: '', mensaje: `No hubo conexión con el RNDC: ${resp.texto}` };
  await registrarTransaccion(m, xml, resp, resultado);
  return resultado;
}

// Revisiones de la plataforma antes de enviar (además del diccionario oficial).
function avisosViaje(v, vehiculo) {
  const avisos = [];
  const hoy = hoyColombia();
  if (!vehiculo) avisos.push(`La placa ${v.placa} no está en el maestro de vehículos`);
  if (vehiculo?.soat?.vence && new Date(vehiculo.soat.vence) < hoy) avisos.push('El SOAT del vehículo está vencido');
  const lic = v.conductor?.licencia;
  if (!lic?.numero) avisos.push('El conductor no tiene licencia registrada');
  else if (lic.vence && new Date(lic.vence) < hoy) avisos.push('La licencia del conductor está vencida');
  if (v.conductor && !TIPOS_ID_CONDUCTOR.includes(v.conductor.tipoId)) avisos.push('El conductor debe tener C, E o U como tipo de identificación');
  if (!(Number(v.flete) > 0)) avisos.push('El flete está en cero');
  return avisos;
}

// ── Datos de maestros que exige el RNDC ─────────────────────────────────────
// Variable del RNDC → [campo del formulario, etiqueta para el usuario].
const CAMPOS_TERCERO = {
  NOMIDTERCERO: ['nombres', 'Nombres o razón social'], PRIMERAPELLIDOIDTERCERO: ['apellido1', 'Primer apellido'],
  CODSEDETERCERO: ['sede.codigo', 'Código de sede'], NOMSEDETERCERO: ['sede.nombre', 'Nombre de sede'],
  NUMTELEFONOCONTACTO: ['telefono', 'Teléfono fijo'], NUMCELULARPERSONA: ['celular', 'Celular'],
  NOMENCLATURADIRECCION: ['direccion', 'Dirección'], CODMUNICIPIORNDC: ['codMunicipio', 'Municipio'],
  CODCATEGORIALICENCIACONDUCCION: ['licencia.categoria', 'Categoría de la licencia'], NUMLICENCIACONDUCCION: ['licencia.numero', 'Número de licencia'],
  FECHAVENCIMIENTOLICENCIA: ['licencia.vence', 'Vencimiento de la licencia'],
};
const CAMPOS_VEHICULO = {
  CODCONFIGURACIONUNIDADCARGA: ['configuracion', 'Código de configuración'], CODMARCAVEHICULOCARGA: ['marca', 'Código de marca'],
  CODLINEAVEHICULOCARGA: ['linea', 'Código de línea'], NUMEJES: ['ejes', 'Ejes'], ANOFABRICACIONVEHICULOCARGA: ['modelo', 'Modelo (año)'],
  CODCOLORVEHICULOCARGA: ['color', 'Código de color'], PESOVEHICULOVACIO: ['pesoVacio', 'Peso vacío'], CAPACIDADUNIDADCARGA: ['capacidad', 'Capacidad'],
  CODTIPOCARROCERIA: ['carroceria', 'Código de carrocería'], CODTIPOCOMBUSTIBLE: ['combustible', 'Código de combustible'],
  NUMSEGUROSOAT: ['soat.numero', 'N° póliza SOAT'], FECHAVENCIMIENTOSOAT: ['soat.vence', 'Vencimiento del SOAT'],
  NUMNITASEGURADORASOAT: ['soat.aseguradoraNit', 'NIT aseguradora SOAT'],
  CODTIPOIDPROPIETARIO: ['propietario.tipoId', 'Tipo de documento del propietario'], NUMIDPROPIETARIO: ['propietario.numId', 'Documento del propietario'],
  CODTIPOIDTENEDOR: ['tenedor.tipoId', 'Tipo de documento del tenedor'], NUMIDTENEDOR: ['tenedor.numId', 'Documento del tenedor'],
};

// Problemas según el diccionario oficial, más dos condiciones del manual:
// los conductores llevan número y categoría de licencia, y las personas naturales, apellido.
export function problemasMaestro(proceso, variables, doc) {
  let problemas = validarVariables(proceso, variables);
  if (proceso === 11) {
    // El diccionario marca la fecha de la licencia como obligatoria, pero el RNDC registra
    // terceros sin licencia (titulares, propietarios): solo se exige a quien conduce o la tiene.
    const conLicencia = (doc.roles || []).includes('conductor') || txt(doc.licencia?.numero);
    if (!conLicencia) problemas = problemas.filter(p => !/LICENCIA/.test(p));
    if ((doc.roles || []).includes('conductor')) {
      if (!txt(doc.licencia?.numero)) problemas.push('NUMLICENCIACONDUCCION: es obligatorio para conductores');
      if (!txt(doc.licencia?.categoria)) problemas.push('CODCATEGORIALICENCIACONDUCCION: es obligatorio para conductores');
    }
    if (doc.tipoId !== 'N' && !txt(doc.apellido1)) problemas.push('PRIMERAPELLIDOIDTERCERO: es obligatorio');
  }
  return [...new Set(problemas)];
}

// Campos que faltan para registrar el tercero/vehículo en el RNDC, con su etiqueta.
export function faltantesMaestro(empresa, tipo, doc) {
  const esTercero = tipo === 'tercero';
  const vars = esTercero ? variablesTercero(empresa, doc) : variablesVehiculo(empresa, doc);
  const mapa = esTercero ? CAMPOS_TERCERO : CAMPOS_VEHICULO;
  return problemasMaestro(esTercero ? 11 : 12, vars, doc).map(p => {
    const variable = p.split(':')[0];
    const [campo, etiqueta] = mapa[variable] || ['', variable];
    return { variable, campo, etiqueta, problema: p.slice(variable.length + 1).trim() };
  });
}

const nombreDe = (t) => [t?.nombres, t?.apellido1, t?.apellido2].filter(Boolean).join(' ');
function estadoMaestro(empresa, tipo, rol, doc) {
  if (!doc) return null;
  const importado = doc.rndc?.estado === 'enviado' && /^Importado/i.test(doc.rndc?.mensaje || '');
  return { tipo, rol, id: doc._id, referencia: tipo === 'vehiculo' ? doc.placa : `${nombreDe(doc)} (${doc.tipoId} ${doc.numId})`,
    estado: importado ? 'importado' : (doc.rndc?.estado || 'sin_enviar'), mensaje: doc.rndc?.mensaje || '', faltantes: faltantesMaestro(empresa, tipo, doc) };
}

// Vista previa de lo que se enviaría (sin clave y sin consumir consecutivos), con el
// estado de los documentos, la última respuesta real del RNDC y los maestros del viaje.
export async function vistaPrevia(empresaId, viajeId) {
  const empresa = await empresaConRndc(empresaId);
  const { v, vehiculo } = await cargarViaje(empresaId, viajeId);
  const ctx = contextoViaje(empresa, v, vehiculo);
  const numR = v.remesa?.numero || `${empresa.rndc?.prefijoRemesa || ''}(siguiente)`;
  const numM = v.manifiesto?.numero || `${empresa.rndc?.prefijoManifiesto || ''}(siguiente)`;
  const remesa = variablesRemesa(empresa, v, ctx, numR);
  const manifiesto = variablesManifiesto(empresa, v, ctx, numM);
  const remolque = v.remolque ? await Vehiculo.findOne({ empresa: empresaId, placa: v.remolque }).lean() : null;
  const ultimo = await TransaccionRndc.findOne({ empresa: empresaId, viaje: v._id, tipo: 1, ok: false }).sort({ createdAt: -1 }).lean();
  const remesaAceptada = v.remesa?.estado === 'aceptado';
  return {
    ambiente: empresa.rndc?.ambiente,
    estado: v.estado, requiereManifiesto: v.requiereManifiesto !== false,
    documentos: { remesa: v.remesa || {}, manifiesto: v.manifiesto || {} },
    remesaAceptada,
    // Respuesta textual del RNDC en el último rechazo (para corregir y reenviar)
    ultimoError: ultimo && !(v.manifiesto?.estado === 'aceptado')
      ? { proceso: ultimo.proceso, mensaje: ultimo.mensaje, fecha: ultimo.createdAt, referencia: ultimo.referencia } : null,
    avisos: avisosViaje(v, vehiculo),
    maestros: [
      vehiculo ? estadoMaestro(empresa, 'vehiculo', 'Vehículo', vehiculo) : { tipo: 'vehiculo', rol: 'Vehículo', referencia: v.placa, estado: 'no_existe', faltantes: [] },
      v.remolque ? (remolque ? estadoMaestro(empresa, 'vehiculo', 'Remolque', remolque) : { tipo: 'vehiculo', rol: 'Remolque', referencia: v.remolque, estado: 'no_existe', faltantes: [] }) : null,
      estadoMaestro(empresa, 'tercero', 'Conductor', v.conductor),
      v.titular && String(v.titular._id) !== String(v.conductor?._id) ? estadoMaestro(empresa, 'tercero', 'Titular', v.titular) : null,
    ].filter(Boolean),
    destinatario: {
      tipoId: ctx.DEST_TIPO, numId: ctx.DEST_ID, sede: ctx.DEST_SEDE,
      origen: v.destinatario?.numId ? 'viaje' : v.tarifaRef?.destinatario?.numId ? 'tarifa' : v.destinatarioAuto ? 'municipio' : 'cliente',
      nombreSede: v.nombreSedeDestino || v.destinatarioAuto?.nombreSede || '',
      municipio: v.codDestinoSede || '',
    },
    destinoManifiesto: ctx.COD_DESTINO,
    remesa: { variables: remesa, problemas: remesaAceptada ? [] : [
      ...validarVariables(3, remesa.map(([n, x]) => [n, n === 'CONSECUTIVOREMESA' ? 'X' : x])),
      ...(destinoIgualOrigen(ctx) ? [PROBLEMA_DESTINO] : []),
    ] },
    manifiesto: { variables: manifiesto, problemas: validarVariables(4, manifiesto.map(([n, x]) => [n, n === 'NUMMANIFIESTOCARGA' ? 'X' : x])) },
  };
}

// Número que ya tiene algún viaje (aceptado, anulado o rechazado): el RNDC no admite repetirlo.
export async function numeroUsado(empresaId, clave, numero) {
  const campo = clave === 'remesa' ? 'remesa.numero' : 'manifiesto.numero';
  const f = { empresa: empresaId, $or: [{ [campo]: numero }, ...(clave === 'manifiesto' ? [{ manifiestoReemplazado: numero }] : [])] };
  return Viaje.findOne(f).select('numero').lean();
}

// Siguiente consecutivo libre: si la numeración se bajó, salta los números ya usados.
async function numeroDocumento(empresa, clave, prefijo) {
  for (let i = 0; i < 5000; i += 1) {
    const numero = `${prefijo || ''}${await siguiente(empresa._id, clave)}`;
    if (!(await numeroUsado(empresa._id, clave, numero))) return numero;
  }
  throw new ErrorHttp(409, `No se encontró un consecutivo de ${clave} libre; revise la numeración en Configuración`);
}

// Expide la remesa (proceso 3) y luego el manifiesto (proceso 4) con esa remesa.
// Si la remesa ya fue aceptada, solo envía el manifiesto (reintento).
export async function despachar(empresaId, viajeId, clave, usuarioId) {
  const empresa = await empresaConRndc(empresaId);
  const cred = credenciales(empresa, clave);
  await bloquear(empresaId, viajeId);
  try {
    const { v, vehiculo } = await cargarViaje(empresaId, viajeId);
    if (v.estado === 'anulado' || v.estado === 'cumplido') throw new ErrorHttp(409, `El viaje está ${v.estado}`);
    if (v.historico) throw new ErrorHttp(409, 'Viaje histórico importado del Excel: sus documentos se gestionaron fuera de la plataforma. Habilítelo en Viajes si debe enviarse.');
    if (v.requiereManifiesto === false) throw new ErrorHttp(409, 'Este viaje está marcado como «no requiere manifiesto». Cámbielo si debe expedirse.');
    if (v.manifiesto?.estado === 'aceptado') throw new ErrorHttp(409, 'El viaje ya tiene manifiesto aceptado');
    const ctx = contextoViaje(empresa, v, vehiculo);
    const meta = { usuario: usuarioId, viaje: v._id, referencia: `Viaje ${v.numero}` };
    const resultado = { remesa: null, manifiesto: null };

    // 1. Remesa
    let numR = v.remesa?.numero;
    if (v.remesa?.estado !== 'aceptado') {
      // Se valida antes de tomar el consecutivo: un rechazo por datos no deja saltos en la numeración
      const problemas = validarVariables(3, variablesRemesa(empresa, v, ctx, numR || 'X'));
      if (destinoIgualOrigen(ctx)) problemas.push(PROBLEMA_DESTINO);
      if (problemas.length) throw new ErrorHttp(422, 'Faltan datos para la remesa', problemas);
      if (!numR || v.remesa?.estado === 'anulado') numR = await numeroDocumento(empresa, 'remesa', empresa.rndc?.prefijoRemesa);
      const vars = variablesRemesa(empresa, v, ctx, numR);
      const res = await registrar(empresa, cred, 3, vars, meta);
      const doc = { numero: numR, radicado: res.radicado, fecha: new Date(), estado: res.ok ? 'aceptado' : 'rechazado', mensaje: res.mensaje, qr: '' };
      await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { remesa: doc, ...(res.ok ? { estado: 'remesa' } : {}) } });
      resultado.remesa = doc;
      if (!res.ok) return resultado;
      ctx.REMESA = numR;
    }

    // 2. Manifiesto con la remesa
    let numM = v.manifiesto?.numero;
    if (!numM || v.manifiesto?.estado === 'anulado') numM = await numeroDocumento(empresa, 'manifiesto', empresa.rndc?.prefijoManifiesto);
    const vars = variablesManifiesto(empresa, v, ctx, numM);
    const problemas = validarVariables(4, vars);
    if (problemas.length) {
      resultado.manifiesto = { numero: numM, estado: 'rechazado', mensaje: `Faltan datos: ${problemas.join('; ')}` };
      await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { 'manifiesto.numero': numM, 'manifiesto.estado': 'rechazado', 'manifiesto.mensaje': resultado.manifiesto.mensaje } });
      return resultado;
    }
    const res = await registrar(empresa, cred, 4, vars, meta, bloqueRemesas([numR]));
    const doc = { numero: numM, radicado: res.radicado, qr: res.qr, qrObs: res.qrObs || '', fecha: new Date(), estado: res.ok ? 'aceptado' : 'rechazado', mensaje: res.mensaje };
    await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { manifiesto: doc, ...(res.ok ? { estado: 'manifestado' } : {}) } });
    resultado.manifiesto = doc;
    return resultado;
  } finally {
    await desbloquear(empresaId, viajeId);
  }
}

// Cumplido de remesa (5) y luego de manifiesto (6).
export async function cumplir(empresaId, viajeId, clave, usuarioId, datos) {
  const empresa = await empresaConRndc(empresaId);
  const cred = credenciales(empresa, clave);
  await bloquear(empresaId, viajeId);
  try {
    const { v } = await cargarViaje(empresaId, viajeId);
    if (v.manifiesto?.estado !== 'aceptado') throw new ErrorHttp(409, 'El viaje no tiene un manifiesto aceptado para cumplir');
    const meta = { usuario: usuarioId, viaje: v._id, referencia: `Viaje ${v.numero}` };
    const resultado = { cumplidoRemesa: null, cumplidoManifiesto: null };

    if (v.cumplidoRemesa?.estado !== 'aceptado') {
      const vars = variablesCumplidoRemesa(empresa, v, datos.remesa || {});
      const problemas = validarVariables(5, vars);
      if (problemas.length) throw new ErrorHttp(422, 'Faltan datos para el cumplido de la remesa', problemas);
      const res = await registrar(empresa, cred, 5, vars, meta);
      const doc = { numero: v.remesa.numero, radicado: res.radicado, fecha: new Date(), estado: res.ok ? 'aceptado' : 'rechazado', mensaje: res.mensaje, qr: '' };
      await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { cumplidoRemesa: doc } });
      resultado.cumplidoRemesa = doc;
      if (!res.ok) return resultado;
    }
    const vars = variablesCumplidoManifiesto(empresa, v, datos.manifiesto || {});
    const problemas = validarVariables(6, vars);
    if (problemas.length) throw new ErrorHttp(422, 'Faltan datos para el cumplido del manifiesto', problemas);
    const res = await registrar(empresa, cred, 6, vars, meta);
    const doc = { numero: v.manifiesto.numero, radicado: res.radicado, fecha: new Date(), estado: res.ok ? 'aceptado' : 'rechazado', mensaje: res.mensaje, qr: '' };
    await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { cumplidoManifiesto: doc, ...(res.ok ? { estado: 'cumplido' } : {}) } });
    resultado.cumplidoManifiesto = doc;
    return resultado;
  } finally {
    await desbloquear(empresaId, viajeId);
  }
}

// Anulación de un documento del viaje (procesos 9, 32, 28, 29).
export async function anular(empresaId, viajeId, clave, usuarioId, datos) {
  const empresa = await empresaConRndc(empresaId);
  const cred = credenciales(empresa, clave);
  await bloquear(empresaId, viajeId);
  try {
    const { v } = await cargarViaje(empresaId, viajeId);
    const doc = datos.documento;
    const requisitos = {
      remesa: [v.remesa?.estado === 'aceptado', 'La remesa no está aceptada'],
      manifiesto: [v.manifiesto?.estado === 'aceptado', 'El manifiesto no está aceptado'],
      cumplidoRemesa: [v.cumplidoRemesa?.estado === 'aceptado', 'El cumplido de la remesa no está aceptado'],
      cumplidoManifiesto: [v.cumplidoManifiesto?.estado === 'aceptado', 'El cumplido del manifiesto no está aceptado'],
    };
    if (!requisitos[doc]) throw new ErrorHttp(400, 'Documento inválido');
    if (!requisitos[doc][0]) throw new ErrorHttp(409, requisitos[doc][1]);
    // Orden que exige el RNDC: no se anula una remesa ligada a un manifiesto vigente
    if (doc === 'remesa' && v.manifiesto?.estado === 'aceptado') throw new ErrorHttp(409, 'Primero anule el manifiesto que contiene esta remesa');
    if (doc === 'manifiesto' && v.cumplidoManifiesto?.estado === 'aceptado') throw new ErrorHttp(409, 'El manifiesto ya está cumplido; anule primero el cumplido');
    const a = variablesAnulacion(empresa, v, doc, datos);
    const problemas = validarVariables(a.proceso, a.variables);
    if (problemas.length) throw new ErrorHttp(422, 'Faltan datos para la anulación', problemas);
    const res = await registrar(empresa, cred, a.proceso, a.variables, { usuario: usuarioId, viaje: v._id, referencia: `Viaje ${v.numero}` });
    if (res.ok) {
      const set = { [`${doc}.estado`]: 'anulado', [`${doc}.mensaje`]: `Anulado (radicado ${res.radicado})` };
      if (doc === 'manifiesto') {
        set.estado = 'remesa';
        if (MOTIVOS_REEMPLAZO.includes(datos.motivo)) set.manifiestoReemplazado = v.manifiesto.numero;
      }
      if (doc === 'remesa') set.estado = 'registrado';
      if (doc === 'cumplidoManifiesto') set.estado = 'manifestado';
      await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: set });
    }
    return { ok: res.ok, radicado: res.radicado, mensaje: res.mensaje };
  } finally {
    await desbloquear(empresaId, viajeId);
  }
}

// Registro de un tercero (11) o vehículo (12). Solo envía si hubo cambios.
export async function registrarMaestro(empresaId, clave, usuarioId, modelo, doc, forzar = false) {
  const empresa = await empresaConRndc(empresaId);
  const cred = credenciales(empresa, clave);
  const esTercero = modelo.modelName === 'Tercero';
  const proceso = esTercero ? 11 : 12;
  const vars = esTercero ? variablesTercero(empresa, doc) : variablesVehiculo(empresa, doc);
  const h = huella(vars);
  if (!forzar && doc.rndc?.estado === 'enviado' && doc.rndc?.hash === h) {
    return { ok: true, sinCambios: true, mensaje: 'Sin cambios desde el último envío; no se reenvía (el RNDC lo rechazaría como DUPLICADO)' };
  }
  const problemas = problemasMaestro(proceso, vars, doc);
  if (problemas.length) throw new ErrorHttp(422, `Faltan datos del ${esTercero ? 'tercero' : 'vehículo'}`, problemas);
  const referencia = esTercero ? `Tercero ${doc.tipoId} ${doc.numId}` : `Placa ${doc.placa}`;
  const res = await registrar(empresa, cred, proceso, vars, { usuario: usuarioId, referencia });
  // DUPLICADO significa que el RNDC ya tiene esos mismos datos.
  const duplicado = !res.ok && /DUPLICADO/i.test(res.mensaje);
  const rndc = (res.ok || duplicado)
    ? { hash: h, radicado: res.radicado, fecha: new Date(), estado: 'enviado', mensaje: duplicado ? 'El RNDC ya tenía estos datos' : '' }
    : { ...(doc.rndc || {}), fecha: new Date(), estado: 'error', mensaje: res.mensaje };
  await modelo.updateOne({ empresa: empresaId, _id: doc._id }, { $set: { rndc } });
  return { ok: res.ok || duplicado, radicado: res.radicado, mensaje: res.mensaje };
}

// Consultas permitidas (tipo 2 maestros / tipo 3 documentos).
const CONSULTAS = {
  // Manual 9.1 (tipo 2, proceso 11): los campos son los nombres de las variables del tercero;
  // MUNICIPIORNDC es el nombre que usa el ejemplo oficial de consulta.
  tercero:   { tipo: 2, proceso: 11, campos: ['NOMIDTERCERO', 'PRIMERAPELLIDOIDTERCERO', 'SEGUNDOAPELLIDOIDTERCERO', 'CODSEDETERCERO', 'NOMSEDETERCERO',
    'NUMTELEFONOCONTACTO', 'NUMCELULARPERSONA', 'NOMENCLATURADIRECCION', 'MUNICIPIORNDC', 'CODCATEGORIALICENCIACONDUCCION', 'NUMLICENCIACONDUCCION', 'FECHAVENCIMIENTOLICENCIA'] },
  // Manual 9.2 (tipo 3, proceso 12): historia de modificaciones del vehículo; se toma el último registro.
  vehiculo:  { tipo: 3, proceso: 12, campos: ['NUMPLACA', 'CODCONFIGURACIONUNIDADCARGA', 'CODMARCAVEHICULOCARGA', 'CODLINEAVEHICULOCARGA', 'NUMEJES',
    'ANOFABRICACIONVEHICULOCARGA', 'CODCOLORVEHICULOCARGA', 'PESOVEHICULOVACIO', 'CAPACIDADUNIDADCARGA', 'UNIDADMEDIDACAPACIDAD', 'CODTIPOCARROCERIA',
    'CODTIPOCOMBUSTIBLE', 'CODTIPOIDPROPIETARIO', 'NUMIDPROPIETARIO', 'CODTIPOIDTENEDOR', 'NUMIDTENEDOR', 'NUMSEGUROSOAT', 'FECHAVENCIMIENTOSOAT', 'NUMNITASEGURADORASOAT'] },
  remesa:    { tipo: 3, proceso: 3, campos: ['INGRESOID', 'FECHAING', 'CONSECUTIVOREMESA', 'CANTIDADCARGADA', 'NUMIDREMITENTE', 'NUMIDDESTINATARIO'] },
  manifiesto:{ tipo: 3, proceso: 4, campos: ['INGRESOID', 'FECHAING', 'NUMMANIFIESTOCARGA', 'FECHAEXPEDICIONMANIFIESTO', 'CODMUNICIPIOORIGENMANIFIESTO', 'CODMUNICIPIODESTINOMANIFIESTO', 'NUMIDTITULARMANIFIESTO', 'NUMPLACA', 'NUMIDCONDUCTOR', 'VALORFLETEPACTADOVIAJE'] },
  cumplidoRemesa:    { tipo: 3, proceso: 5, campos: ['INGRESOID', 'FECHAING', 'CONSECUTIVOREMESA', 'TIPOCUMPLIDOREMESA', 'CANTIDADCARGADA', 'CANTIDADENTREGADA'] },
  cumplidoManifiesto:{ tipo: 3, proceso: 6, campos: ['INGRESOID', 'FECHAING', 'NUMMANIFIESTOCARGA', 'TIPOCUMPLIDOMANIFIESTO', 'VALORADICIONALFLETE', 'VALORDESCUENTOFLETE'] },
};
const FILTROS = {
  tercero: ['CODTIPOIDTERCERO', 'NUMIDTERCERO'], vehiculo: ['NUMPLACA'], remesa: ['CONSECUTIVOREMESA', 'INGRESOID'],
  manifiesto: ['NUMMANIFIESTOCARGA', 'INGRESOID', 'NUMPLACA'], cumplidoRemesa: ['CONSECUTIVOREMESA', 'INGRESOID'],
  cumplidoManifiesto: ['NUMMANIFIESTOCARGA', 'INGRESOID'],
};
export const TIPOS_CONSULTA = Object.keys(CONSULTAS);

// ── Traer maestros desde el RNDC ────────────────────────────────────────────
// Consulta el RNDC y crea o actualiza el tercero/vehículo de la empresa con esos
// datos. Queda marcado como sincronizado (no se reenvía lo que ya está en el RNDC).
const fechaRndc = (v) => { const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };
const numero = (v) => (txt(v) === '' ? null : Number(txt(v).replace(',', '.')));

export async function traerTercero(empresaId, clave, usuarioId, { tipoId, numId, roles = [] }) {
  const r = await consultar(empresaId, clave, usuarioId, { que: 'tercero', filtros: { CODTIPOIDTERCERO: tipoId, NUMIDTERCERO: numId } });
  if (!r.ok) return { ok: false, mensaje: r.mensaje };
  if (!r.documentos.length) return { ok: false, mensaje: 'El RNDC no tiene registrado ese tercero para su empresa' };
  const empresa = await empresaConRndc(empresaId);
  const municipioDe = buscadorMunicipios(await Municipio.find().lean());
  const guardados = [];
  for (const d of r.documentos) {
    const datos = {
      tipoId, numId, nombres: txt(d.nomidtercero), apellido1: txt(d.primerapellidoidtercero), apellido2: txt(d.segundoapellidoidtercero),
      sede: { codigo: txt(d.codsedetercero), nombre: txt(d.nomsedetercero) },
      telefono: txt(d.numtelefonocontacto), celular: txt(d.numcelularpersona), direccion: txt(d.nomenclaturadireccion),
      codMunicipio: municipioDe(txt(d.municipiorndc || d.codmunicipiorndc)),
      licencia: { categoria: txt(d.codcategorialicenciaconduccion), numero: txt(d.numlicenciaconduccion), vence: fechaRndc(d.fechavencimientolicencia) },
    };
    if (!datos.nombres) continue;
    const existente = await Tercero.findOne({ empresa: empresaId, tipoId, numId, 'sede.codigo': datos.sede.codigo });
    const doc = existente || new Tercero({ empresa: empresaId, tipoId, numId, roles: [] });
    doc.set(datos);
    doc.roles = [...new Set([...(doc.roles || []), ...roles, ...(datos.licencia.numero ? ['conductor'] : [])])];
    doc.rndc = { estado: 'enviado', fecha: new Date(), hash: huella(variablesTercero(empresa, doc.toObject())), radicado: '', mensaje: 'Datos traídos del RNDC' };
    await doc.save({ validateBeforeSave: true });
    guardados.push({ id: doc._id, nuevo: !existente, nombre: [datos.nombres, datos.apellido1, datos.apellido2].filter(Boolean).join(' '), sede: datos.sede.codigo });
  }
  return { ok: true, guardados };
}

// Datos del vehículo según la respuesta del RNDC (último registro de su historia).
function datosVehiculoRndc(d) {
  return {
    configuracion: txt(d.codconfiguracionunidadcarga), marca: txt(d.codmarcavehiculocarga), linea: txt(d.codlineavehiculocarga),
    ejes: numero(d.numejes), modelo: numero(d.anofabricacionvehiculocarga), color: txt(d.codcolorvehiculocarga),
    pesoVacio: numero(d.pesovehiculovacio), capacidad: numero(d.capacidadunidadcarga), unidadMedida: txt(d.unidadmedidacapacidad),
    carroceria: txt(d.codtipocarroceria), combustible: txt(d.codtipocombustible),
    propietario: { tipoId: txt(d.codtipoidpropietario), numId: txt(d.numidpropietario) },
    tenedor: { tipoId: txt(d.codtipoidtenedor), numId: txt(d.numidtenedor) },
    soat: { numero: txt(d.numsegurosoat), vence: fechaRndc(d.fechavencimientosoat), aseguradoraNit: txt(d.numnitaseguradorasoat) },
  };
}

// Aplica solo los campos que el RNDC devolvió con valor (nunca borra datos con vacíos).
// Devuelve los campos que realmente cambiaron.
const comparable = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? '' : String(v));
function aplicarDatos(doc, datos) {
  const cambiados = [];
  const poner = (ruta, v) => {
    if (v === '' || v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return;
    if (comparable(doc.get(ruta)) === comparable(v)) return;
    doc.set(ruta, v); cambiados.push(ruta);
  };
  for (const [k, v] of Object.entries(datos)) {
    if (v && typeof v === 'object' && !(v instanceof Date)) for (const [k2, v2] of Object.entries(v)) poner(`${k}.${k2}`, v2);
    else poner(k, v);
  }
  return cambiados;
}

function marcarSincronizado(empresa, doc) {
  doc.rndc = { estado: 'enviado', fecha: new Date(), hash: huella(variablesVehiculo(empresa, doc.toObject())), radicado: '', mensaje: 'Datos traídos del RNDC' };
}

export async function traerVehiculo(empresaId, clave, usuarioId, { placa }) {
  const r = await consultar(empresaId, clave, usuarioId, { que: 'vehiculo', filtros: { NUMPLACA: placa } });
  if (!r.ok) return { ok: false, mensaje: r.mensaje };
  const d = r.documentos.at(-1);
  if (!d) return { ok: false, mensaje: 'El RNDC no tiene registrado ese vehículo para su empresa' };
  const empresa = await empresaConRndc(empresaId);
  const existente = await Vehiculo.findOne({ empresa: empresaId, placa });
  const doc = existente || new Vehiculo({ empresa: empresaId, placa });
  if (!existente && !txt(d.unidadmedidacapacidad)) doc.unidadMedida = '1';
  aplicarDatos(doc, datosVehiculoRndc(d));
  marcarSincronizado(empresa, doc);
  await doc.save();
  return { ok: true, nuevo: !existente, id: doc._id, placa };
}

// Actualiza un vehículo YA registrado en la empresa con lo que tenga el RNDC.
// resultado.estado: actualizado | sin_cambios | no_encontrado (en el RNDC) | no_registrado (en la empresa) | error
export async function actualizarVehiculo(empresaId, clave, usuarioId, placa) {
  const doc = await Vehiculo.findOne({ empresa: empresaId, placa });
  if (!doc) return { placa, estado: 'no_registrado', mensaje: 'La placa no está registrada en su empresa' };
  const r = await consultar(empresaId, clave, usuarioId, { que: 'vehiculo', filtros: { NUMPLACA: placa } });
  if (!r.ok) {
    const sinDatos = /no (se )?encontr|no existe|no hay|sin registros|no tiene/i.test(r.mensaje || '');
    return { placa, estado: sinDatos ? 'no_encontrado' : 'error', mensaje: r.mensaje || 'El RNDC no respondió', conexion: /No hubo conexión/.test(r.mensaje || '') };
  }
  const d = r.documentos.at(-1);
  if (!d) return { placa, estado: 'no_encontrado', mensaje: 'El RNDC no tiene registrado ese vehículo para su empresa' };
  const empresa = await empresaConRndc(empresaId);
  const campos = aplicarDatos(doc, datosVehiculoRndc(d));
  marcarSincronizado(empresa, doc);
  await doc.save();
  return { placa, id: doc._id, estado: campos.length ? 'actualizado' : 'sin_cambios', campos,
    mensaje: campos.length ? `Actualizado: ${campos.join(', ')}` : 'Ya coincidía con el RNDC' };
}

// ── Verificar antes de crear un vehículo o tercero ───────────────────────────
// 1) Si ya existe en la empresa, se devuelve (no se duplica).
// 2) Si no, y hay contraseña, se consulta el RNDC: si lo tiene, se crea con esos datos
//    (queda sincronizado) y se indican solo los campos que faltan.
// 3) Si tampoco está en el RNDC, es nuevo: el usuario completa el registro.
export async function verificarVehiculo(empresaId, usuarioId, { placa, clave }) {
  const empresa = await empresaConRndc(empresaId);
  const local = await Vehiculo.findOne({ empresa: empresaId, placa }).lean();
  if (local) return { origen: 'local', registro: local, faltantes: faltantesMaestro(empresa, 'vehiculo', local) };
  if (!clave) return { origen: 'nuevo', consultado: false };
  const r = await traerVehiculo(empresaId, clave, usuarioId, { placa });
  if (!r.ok) return { origen: 'nuevo', consultado: true, mensaje: r.mensaje };
  const registro = await Vehiculo.findOne({ empresa: empresaId, _id: r.id }).lean();
  return { origen: 'rndc', registro, faltantes: faltantesMaestro(empresa, 'vehiculo', registro) };
}

export async function verificarTercero(empresaId, usuarioId, { tipoId, numId, clave, roles = [] }) {
  const empresa = await empresaConRndc(empresaId);
  const local = await Tercero.findOne({ empresa: empresaId, tipoId, numId }).lean();
  if (local) return { origen: 'local', registro: local, faltantes: faltantesMaestro(empresa, 'tercero', local) };
  if (!clave) return { origen: 'nuevo', consultado: false };
  const r = await traerTercero(empresaId, clave, usuarioId, { tipoId, numId, roles });
  if (!r.ok || !r.guardados?.length) return { origen: 'nuevo', consultado: true, mensaje: r.mensaje || 'El RNDC no devolvió datos de ese tercero' };
  const registro = await Tercero.findOne({ empresa: empresaId, _id: r.guardados[0].id }).lean();
  return { origen: 'rndc', registro, faltantes: faltantesMaestro(empresa, 'tercero', registro), sedes: r.guardados.length };
}

export async function consultar(empresaId, clave, usuarioId, { que, filtros = {}, desde, hasta }) {
  const def = CONSULTAS[que];
  if (!def) throw new ErrorHttp(400, 'Consulta no disponible');
  const empresa = await empresaConRndc(empresaId);
  const cred = credenciales(empresa, clave);
  const f = { NUMNITEMPRESATRANSPORTE: `${empresa.nit}${empresa.dv || ''}` };
  for (const k of FILTROS[que]) if (txt(filtros[k])) f[k] = txt(filtros[k]).toUpperCase();
  const rango = desde && hasta ? { desde: desde.replace(/-/g, '/'), hasta: hasta.replace(/-/g, '/') } : {};
  if (Object.keys(f).length < 2 && !rango.desde) throw new ErrorHttp(400, 'Indique un filtro o un rango de fechas');
  const xml = xmlConsulta({ usuario: cred.usuario, clave: cred.clave, tipo: def.tipo, proceso: def.proceso, campos: def.campos, filtros: f, ...rango });
  const meta = { empresa: empresa._id, usuario: usuarioId, ambiente: empresa.rndc?.ambiente, tipo: def.tipo, proceso: def.proceso, referencia: `Consulta ${que}` };
  const resp = await enviar(xml, meta);
  const r = resp.conectado ? interpretarConsulta(resp.texto) : { ok: false, mensaje: `No hubo conexión con el RNDC: ${resp.texto}`, documentos: [] };
  await registrarTransaccion(meta, xml, resp, { ok: r.ok, mensaje: r.mensaje || `${r.documentos.length} resultado(s)` });
  return { ...r, ambiente: meta.ambiente, url: resp.url, solicitud: ocultarClave(xml) };
}

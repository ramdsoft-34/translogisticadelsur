// Fase 8: SG-SST (Decreto 1072 de 2015, Res. 0312 de 2019) y PESV (Res. 40595 de 2022).
// Tablero, perfil único de colaboradores (SST + PESV), flota y mantenimiento, capacitaciones, inspecciones
// preoperacionales desde el celular, formatos con auto-llenado y membrete de la empresa.
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa, Vehiculo, Tercero, Empleado, Viaje, CapacitacionSst, Mantenimiento, InspeccionSst, RegistroSst, FormatoSst, siguiente } from '../models/index.js';
import { autenticar, soloEmpresa, permitir, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P, tienePermiso } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { parseFecha } from '../utils/texto.js';
import * as Cat from '../services/sst/catalogo.js';
import * as A from '../services/sst/autollenado.js';
import { alertas, resumen, proximoMantenimiento, kmRecorridos, kmEstimado } from '../services/sst/vencimientos.js';
import * as Pesv from '../services/sst/pesv.js';
import * as Ck from '../services/sst/checklistSurTrack.js';
import * as FR from '../services/sst/firmaRemota.js';
import rutasPlanillas from './sstPlanillas.js';

const r = Router();
r.use(autenticar, soloEmpresa);
r.use(rutasPlanillas);   // planillas de seguridad social de los conductores (main)
const ver = permitir(P.SST_VER, P.SST_GESTIONAR);
const gestionar = permitir(P.SST_GESTIONAR);
const puedeGestionar = (req) => tienePermiso(req.usuario.rol, P.SST_GESTIONAR);

const oid = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const fechaZ = z.union([z.literal(''), z.null(), z.string()]).optional().transform(v => (v ? parseFecha(v) : null));
const texto = (max = 150) => z.string().trim().max(max).optional().default('');
const imagenZ = z.string().max(400_000).regex(/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/, 'Debe ser una imagen PNG o JPG');
const firmaZ = z.object({ rol: texto(60), nombre: texto(120), documento: texto(20), imagen: z.string().max(200_000).refine(v => !v || Cat.firmaValida(v), 'Firma inválida').optional().default('') });
const mime = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };
function enviar(res, buffer, nombre, tipo, enLinea = false) {
  res.setHeader('Content-Type', mime[tipo]);
  res.setHeader('Content-Disposition', `${enLinea ? 'inline' : 'attachment'}; filename="${nombre.replace(/[^\w.-]/g, '_')}"`);
  res.send(buffer);
}

// Empresa con lo necesario para el auto-llenado y el membrete
async function empresaCompleta(req) {
  const e = await Empresa.findById(req.empresaId).select('+logo +membrete.encabezado +membrete.pie').lean();
  const numVehiculos = await Vehiculo.countDocuments({ empresa: req.empresaId, activo: true, clase: 'vehiculo' });
  return { e, numVehiculos };
}
const ctxDe = (req, e, numVehiculos, formato) => A.contexto(e, { usuario: req.usuario, numVehiculos, formato });

// ── Tablero ─────────────────────────────────────────────────────────────────
r.get('/resumen', ver, async (req, res) => {
  await Pesv.sincronizarChecklists(req.empresaId).catch(() => null);   // copia de los checklists de Sur Track (cada 15 min como mucho)
  res.json(await resumen(req.empresaId));
});
// Indicadores del PESV del mes con Sur Track (velocidad, conducción continua, checklist, km) y reportes de incidentes
r.get('/indicadores', ver, async (req, res) => {
  const { mes } = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
  const c = new Date(Date.now() - 5 * 3600e3);
  res.json(await Pesv.indicadores(req.empresaId, mes || `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}`));
});
r.get('/alertas', ver, async (req, res) => res.json(await alertas(req.empresaId, { aviso: Math.min(120, Number(req.query.dias) || 30) })));

// ── Datos de la empresa para los formatos y membrete ───────────────────────
const sstEmpresa = z.object({
  representanteLegal: texto(120), documentoRepresentante: texto(20), responsableSst: texto(120), licenciaSst: texto(60), liderPesv: texto(120),
  arl: texto(60), claseRiesgo: z.coerce.number().int().min(1).max(5).nullable().optional().default(null), actividad: texto(200),
  numTrabajadores: z.coerce.number().int().min(0).max(100000).optional().default(0), nivelPesv: z.enum(['', 'basico', 'estandar', 'avanzado']).optional().default(''),
  horasConduccionContinua: z.coerce.number().min(1).max(12).optional().default(4), minutosPausa: z.coerce.number().int().min(5).max(120).optional().default(15),
  puntaje0312: z.coerce.number().min(0).max(100).nullable().optional().default(null), fechaEvaluacion0312: fechaZ,
  puntajePesv: z.coerce.number().min(0).max(100).nullable().optional().default(null), fechaEvaluacionPesv: fechaZ,
});
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
r.get('/empresa', ver, async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('nombre nit dv direccion ciudad telefono correo rndc.razonSocial sst membrete +membrete.encabezado +membrete.pie').lean();
  res.json({ ...e, marcadores: A.MARCADORES, nivelSugerido: nivelPesvSugerido(await Vehiculo.countDocuments({ empresa: req.empresaId, activo: true, clase: 'vehiculo' })) });
});
r.put('/empresa', gestionar, async (req, res) => {
  const d = z.object({ sst: sstEmpresa, membrete: z.object({ colorPrimario: color, colorSecundario: color, textoPie: texto(300) }).partial().optional() }).parse(req.body);
  const set = { sst: d.sst };
  for (const [k, v] of Object.entries(d.membrete || {})) set[`membrete.${k}`] = v;
  await Empresa.updateOne({ _id: req.empresaId }, { $set: set });
  await auditar(req, 'sst_empresa', { entidad: 'Empresa', entidadId: req.empresaId });
  res.json({ ok: true });
});
// Franja de encabezado o de pie (imagen); vacío = quitarla
r.put('/empresa/membrete/:parte', gestionar, async (req, res) => {
  const parte = z.enum(['encabezado', 'pie']).parse(req.params.parte);
  const { imagen } = z.object({ imagen: imagenZ.or(z.literal('')) }).parse(req.body);
  await Empresa.updateOne({ _id: req.empresaId }, { $set: { [`membrete.${parte}`]: imagen, 'membrete.actualizado': new Date() } });
  await auditar(req, 'sst_membrete', { entidad: 'Empresa', entidadId: req.empresaId, detalle: { parte, quitado: !imagen } });
  res.json({ ok: true });
});
// Vista previa del membrete aplicado a un formato del catálogo (en blanco, autollenado)
r.get('/plantillas/:codigo/pdf', ver, async (req, res) => {
  const p = Cat.plantilla(req.params.codigo);
  if (!p) throw new ErrorHttp(404, 'Formato no encontrado');
  const { e, numVehiculos } = await empresaCompleta(req);
  const ctx = ctxDe(req, e, numVehiculos, p);
  const datos = prellenar(p, ctx);
  enviar(res, await A.pdfFormato({ plantilla: p, datos, ctx, membrete: e.membrete || {}, logo: e.logo }), `${p.codigo}.pdf`, 'pdf', true);
});
// PESV: nivel por tamaño de flota (Res. 40595 de 2022: 11 a 19 vehículos básico, 20 a 50 estándar, más de 50 avanzado)
export function nivelPesvSugerido(n) { return n > 50 ? 'avanzado' : n >= 20 ? 'estandar' : n >= 11 ? 'basico' : ''; }

// ── Catálogo de formatos y registros diligenciados ─────────────────────────
function prellenar(p, ctx) {
  const datos = {};
  for (const s of p.secciones) for (const c of s.campos) if (c.auto) datos[c.id] = String(c.auto.split('.').reduce((o, k) => o?.[k], ctx) ?? '');
  return datos;
}
r.get('/plantillas', ver, async (req, res) => {
  const { e, numVehiculos } = await empresaCompleta(req);
  const ctx = ctxDe(req, e, numVehiculos);
  res.json(Cat.PLANTILLAS.map(p => ({ ...p, prellenado: prellenar(p, ctx) })));
});
r.get('/registros', ver, async (req, res) => {
  const q = z.object({ codigo: z.string().max(20).optional(), limite: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
  res.json(await RegistroSst.find(deEmpresa(req, q.codigo ? { codigo: q.codigo } : {})).select('-datos -firmas.imagen').sort({ createdAt: -1 }).limit(q.limite).lean());
});
r.get('/registros/:id', ver, async (req, res) => {
  const reg = await RegistroSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).lean();
  if (!reg) throw new ErrorHttp(404, 'Registro no encontrado');
  res.json(reg);
});
const registroZ = z.object({ codigo: z.string().max(20), datos: z.record(z.any()).default({}), estado: z.enum(['borrador', 'diligenciado']).default('diligenciado') });
r.post('/registros', gestionar, async (req, res) => {
  const d = registroZ.parse(req.body);
  const p = Cat.plantilla(d.codigo);
  if (!p) throw new ErrorHttp(404, 'Formato no encontrado');
  const consecutivo = await siguiente(req.empresaId, `sst:${p.codigo}`);
  const reg = await RegistroSst.create({ empresa: req.empresaId, codigo: p.codigo, version: p.version, titulo: p.titulo, consecutivo,
    datos: Cat.limpiarDatos(p, d.datos), estado: estadoDe(p, d), creadoPor: req.usuario._id });
  await auditar(req, 'sst_registro', { entidad: 'RegistroSst', entidadId: reg._id, detalle: { codigo: p.codigo, consecutivo } });
  res.status(201).json(reg);
});
// Firmado cuando todas las firmas del formato están puestas
function estadoDe(p, d) {
  const firmas = p.secciones.flatMap(s => s.campos).filter(c => c.tipo === 'firma');
  const datos = Cat.limpiarDatos(p, d.datos);
  return d.estado === 'borrador' ? 'borrador' : firmas.length && firmas.every(c => datos[c.id]) ? 'firmado' : 'diligenciado';
}
r.put('/registros/:id', gestionar, async (req, res) => {
  const d = registroZ.omit({ codigo: true }).parse(req.body);
  const reg = await RegistroSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) }));
  if (!reg) throw new ErrorHttp(404, 'Registro no encontrado');
  if (reg.estado === 'anulado') throw new ErrorHttp(409, 'El registro está anulado');
  const p = Cat.plantilla(reg.codigo);
  reg.datos = Cat.limpiarDatos(p, d.datos); reg.estado = estadoDe(p, d); reg.markModified('datos');
  await reg.save();
  await auditar(req, 'sst_registro_editar', { entidad: 'RegistroSst', entidadId: reg._id });
  res.json(reg);
});
r.post('/registros/:id/anular', gestionar, async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().min(5).max(200) }).parse(req.body);
  const reg = await RegistroSst.findOneAndUpdate(deEmpresa(req, { _id: oid.parse(req.params.id) }), { $set: { estado: 'anulado' } }, { new: true });
  if (!reg) throw new ErrorHttp(404, 'Registro no encontrado');
  await auditar(req, 'sst_registro_anular', { entidad: 'RegistroSst', entidadId: reg._id, detalle: { motivo } });
  res.json(reg);
});
r.get('/registros/:id/pdf', ver, async (req, res) => {
  const reg = await RegistroSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).lean();
  if (!reg) throw new ErrorHttp(404, 'Registro no encontrado');
  const p = Cat.plantilla(reg.codigo);
  const { e, numVehiculos } = await empresaCompleta(req);
  const ctx = ctxDe(req, e, numVehiculos, { ...p, consecutivo: reg.consecutivo });
  const pdf = await A.pdfFormato({ plantilla: p, datos: reg.datos, ctx, membrete: e.membrete || {}, logo: e.logo, firmas: reg.firmas || [] });
  enviar(res, pdf, `${reg.codigo}_${reg.consecutivo}.pdf`, 'pdf', req.query.ver === '1');
});

// ── Formatos propios en Word o Excel (con marcadores) ──────────────────────
const binario = express.raw({ type: () => true, limit: '8mb' });
const tipoArchivo = (buf) => (buf?.length > 4 && buf.readUInt32BE(0) === 0x504b0304 ? 'zip' : '');
r.get('/formatos', ver, async (req, res) => res.json(await FormatoSst.find(deEmpresa(req)).sort({ codigo: 1, version: -1 }).lean()));
r.post('/formatos', gestionar, binario, async (req, res) => {
  const q = z.object({ codigo: z.string().trim().min(2).max(20), nombre: z.string().trim().min(3).max(150), estandar: texto(40), convertir: z.enum(['0', '1']).default('0') }).parse(req.query);
  const nombreArchivo = decodeURIComponent(String(req.get('X-Nombre-Archivo') || 'formato')).slice(0, 120);
  const tipo = /\.xlsx$/i.test(nombreArchivo) ? 'xlsx' : /\.docx$/i.test(nombreArchivo) ? 'docx' : '';
  if (!tipo || tipoArchivo(req.body) !== 'zip') throw new ErrorHttp(400, 'Suba un archivo de Word (.docx) o de Excel (.xlsx)');
  let archivo = req.body; let cambios = [];
  // Convertir un formato ya diligenciado: los datos de la empresa escritos se vuelven marcadores
  if (q.convertir === '1' && tipo === 'docx') {
    const { e, numVehiculos } = await empresaCompleta(req);
    const equivalencias = z.array(z.object({ texto: z.string().max(200), marcador: z.string().max(60) })).max(30)
      .parse(JSON.parse(decodeURIComponent(String(req.get('X-Equivalencias') || '%5B%5D'))));
    ({ buffer: archivo, cambios } = await A.plantillaDesdeDocumento(req.body, ctxDe(req, e, numVehiculos), equivalencias));
  }
  const marcadores = tipo === 'docx' ? await A.marcadoresDocx(archivo) : [];
  const ultima = await FormatoSst.findOne(deEmpresa(req, { codigo: q.codigo.toUpperCase() })).sort({ version: -1 }).select('version').lean();
  const f = await FormatoSst.create({ empresa: req.empresaId, codigo: q.codigo, nombre: q.nombre, estandar: q.estandar, tipo, archivo, nombreArchivo, marcadores,
    version: (ultima?.version || 0) + 1, creadoPor: req.usuario._id });
  const conocidos = new Set(A.MARCADORES.map(m => m[0]));
  await auditar(req, 'sst_formato', { entidad: 'FormatoSst', entidadId: f._id, detalle: { codigo: f.codigo, version: f.version, convertido: q.convertir === '1' } });
  res.status(201).json({ _id: f._id, codigo: f.codigo, version: f.version, marcadores, desconocidos: marcadores.filter(m => !conocidos.has(m)), cambios });
});
r.get('/formatos/:id/generar', ver, async (req, res) => {
  const f = await FormatoSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).select('+archivo').lean();
  if (!f) throw new ErrorHttp(404, 'Formato no encontrado');
  const { e, numVehiculos } = await empresaCompleta(req);
  const ctx = ctxDe(req, e, numVehiculos, f);
  const conMembrete = req.query.membrete !== '0';
  const r2 = f.tipo === 'docx'
    ? await A.llenarDocx(f.archivo.buffer ? Buffer.from(f.archivo.buffer) : f.archivo, ctx, { membrete: conMembrete ? e.membrete : null })
    : await A.llenarXlsx(f.archivo.buffer ? Buffer.from(f.archivo.buffer) : f.archivo, ctx, { logo: e.logo, membrete: e.membrete });
  if (r2.faltantes.length) res.setHeader('X-Marcadores-Sin-Dato', r2.faltantes.join(','));
  await auditar(req, 'sst_formato_generar', { entidad: 'FormatoSst', entidadId: f._id });
  enviar(res, r2.buffer, `${f.codigo}_v${f.version}_${ctx.fecha.iso}.${f.tipo}`, f.tipo);
});
r.get('/formatos/:id/plantilla', gestionar, async (req, res) => {
  const f = await FormatoSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).select('+archivo').lean();
  if (!f) throw new ErrorHttp(404, 'Formato no encontrado');
  enviar(res, f.archivo.buffer ? Buffer.from(f.archivo.buffer) : f.archivo, `${f.codigo}_v${f.version}_plantilla.${f.tipo}`, f.tipo);
});
r.delete('/formatos/:id', gestionar, async (req, res) => {
  const f = await FormatoSst.findOneAndDelete(deEmpresa(req, { _id: oid.parse(req.params.id) }));
  if (!f) throw new ErrorHttp(404, 'Formato no encontrado');
  await auditar(req, 'sst_formato_borrar', { entidad: 'FormatoSst', entidadId: f._id, detalle: { codigo: f.codigo, version: f.version } });
  res.json({ ok: true });
});

// ── Personas: el perfil SST va dentro de la ficha que ya existe (conductor del RNDC o empleado de nómina) ──
const MODELO = { tercero: Tercero, empleado: Empleado };
const tipoZ = z.enum(['tercero', 'empleado']);
const nombreDe = (x) => [x.nombres, x.apellido1, x.apellido2, x.apellidos].filter(Boolean).join(' ');
const dias = (d) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / 864e5) : null);
// Conductores y empleados con su estado SST (sin datos médicos: solo si algo vence)
r.get('/personas', ver, async (req, res) => {
  const [ts, es] = await Promise.all([
    Tercero.find(deEmpresa(req, { roles: 'conductor', activo: true })).select('tipoId numId nombres apellido1 apellido2 celular licencia placaPrincipal +sst').sort({ nombres: 1 }).lean(),
    Empleado.find(deEmpresa(req, { activo: true })).select('tipoId numId nombres apellidos cargo telefono eps afp nivelRiesgoArl conductor +sst').sort({ nombres: 1 }).lean(),
  ]);
  const estado = (p, licencia) => {
    const ultimo = [...(p?.examenes || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
    const fechas = [licencia?.vence, ultimo?.vence, ...(p?.epp || []).map(e => e.reposicion)].filter(Boolean).map(dias);
    const peor = fechas.length ? Math.min(...fechas) : null;
    return { estado: peor == null ? 'sin_datos' : peor < 0 ? 'vencido' : peor <= 30 ? 'por_vencer' : 'al_dia', examen: !!ultimo,
      epp: (p?.epp || []).length, comparendos: (p?.comparendos || []).filter(c => c.estado === 'pendiente').length };
  };
  const conEmpleado = new Set(es.map(e => String(e.conductor || '')));
  res.json([
    ...ts.filter(t => !conEmpleado.has(String(t._id))).map(t => ({ tipo: 'tercero', _id: t._id, documento: `${t.tipoId} ${t.numId}`, nombre: nombreDe(t), cargo: 'Conductor',
      placa: t.placaPrincipal, licencia: t.licencia, ...estado(t.sst, t.licencia) })),
    ...es.map(e => ({ tipo: 'empleado', _id: e._id, documento: `${e.tipoId} ${e.numId}`, nombre: nombreDe(e), cargo: e.cargo, conductor: e.conductor, ...estado(e.sst, null) })),
  ]);
});
r.get('/personas/:tipo/:id', ver, async (req, res) => {
  const tipo = tipoZ.parse(req.params.tipo); const id = oid.parse(req.params.id);
  const x = await MODELO[tipo].findOne(deEmpresa(req, { _id: id })).select('+sst').lean();
  if (!x) throw new ErrorHttp(404, 'No encontrado');
  const sst = { ...(x.sst || {}) };
  if (!puedeGestionar(req)) delete sst.examenes;           // historia clínica ocupacional: reservada
  const terceroId = tipo === 'tercero' ? x._id : x.conductor;
  const emp = await Empresa.findById(req.empresaId).select('rastreo.velocidadMaxima').lean();
  const [capacitaciones, checklists, excesos] = await Promise.all([
    CapacitacionSst.find(deEmpresa(req, { 'asistentes.persona.id': x._id })).select('tema fecha horas eje estado').sort({ fecha: -1 }).lean(),
    terceroId ? InspeccionSst.find(deEmpresa(req, { tercero: terceroId })).select('placa fecha apto delDia numeroViaje').sort({ fecha: -1 }).limit(30).lean() : [],
    terceroId ? Viaje.find(deEmpresa(req, { conductor: terceroId, 'rastreo.resumen.velocidadMaxima': { $gt: emp?.rastreo?.velocidadMaxima || 80 } }))
      .select('numero fecha placa rastreo.resumen.velocidadMaxima').sort({ fecha: -1 }).limit(20).lean() : [],
  ]);
  res.json({ tipo, _id: x._id, nombre: nombreDe(x), documento: `${x.tipoId} ${x.numId}`, cargo: tipo === 'tercero' ? 'Conductor' : x.cargo,
    licencia: x.licencia || null, eps: x.eps, afp: x.afp, sst, capacitaciones, checklists, limiteVelocidad: emp?.rastreo?.velocidadMaxima || 80,
    excesos: excesos.map(v => ({ numero: v.numero, fecha: v.fecha, placa: v.placa, velocidad: Math.round(v.rastreo.resumen.velocidadMaxima) })) });
});
// Sub-registros del perfil: exámenes, EPP, comparendos y control mensual de seguridad social
const SUB = {
  examenes: z.object({ tipo: z.enum(['ingreso', 'periodico', 'retiro', 'post_incapacidad']), fecha: fechaZ, ips: texto(120),
    concepto: z.enum(['apto', 'apto_con_restricciones', 'no_apto', 'aplazado']), restricciones: texto(300), vence: fechaZ }),
  epp: z.object({ elemento: z.string().trim().min(2).max(100), cantidad: z.coerce.number().int().min(1).max(999).default(1), entrega: fechaZ, reposicion: fechaZ, firma: firmaZ.nullable().optional().default(null) }),
  comparendos: z.object({ numero: texto(30), fecha: fechaZ, codigo: texto(10), descripcion: texto(300), valor: z.coerce.number().min(0).default(0),
    estado: z.enum(['pendiente', 'pagado', 'curso', 'impugnado']).default('pendiente'), placa: texto(8) }),
  ssi: z.object({ periodo: z.string().regex(/^\d{4}-\d{2}$/), eps: z.boolean(), afp: z.boolean(), arl: z.boolean(), planilla: texto(30) }),
};
r.post('/personas/:tipo/:id/:sub', gestionar, async (req, res) => {
  const tipo = tipoZ.parse(req.params.tipo); const sub = z.enum(Object.keys(SUB)).parse(req.params.sub);
  const d = { ...SUB[sub].parse(req.body), _id: new mongoose.Types.ObjectId() };
  const r2 = await MODELO[tipo].updateOne(deEmpresa(req, { _id: oid.parse(req.params.id) }), { $push: { [`sst.${sub}`]: d } });
  if (!r2.matchedCount) throw new ErrorHttp(404, 'No encontrado');
  await auditar(req, `sst_${sub}`, { entidad: tipo === 'tercero' ? 'Tercero' : 'Empleado', entidadId: req.params.id });
  res.status(201).json(d);
});
r.delete('/personas/:tipo/:id/:sub/:item', gestionar, async (req, res) => {
  const tipo = tipoZ.parse(req.params.tipo); const sub = z.enum(Object.keys(SUB)).parse(req.params.sub);
  const r2 = await MODELO[tipo].updateOne(deEmpresa(req, { _id: oid.parse(req.params.id) }), { $pull: { [`sst.${sub}`]: { _id: new mongoose.Types.ObjectId(oid.parse(req.params.item)) } } });
  if (!r2.modifiedCount) throw new ErrorHttp(404, 'No encontrado');
  await auditar(req, `sst_${sub}_borrar`, { entidad: tipo === 'tercero' ? 'Tercero' : 'Empleado', entidadId: req.params.id });
  res.json({ ok: true });
});

// ── Vehículo: hoja de vida del PESV (dentro de la ficha del vehículo) ──────
r.get('/flota/:id', ver, async (req, res) => {
  const v = await Vehiculo.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).select('placa marcaNombre modelo soat venceTecnomecanica sst').lean();
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const km = await kmRecorridos(req.empresaId, [v]);
  const estimado = kmEstimado(v, km);
  const c = new Date(Date.now() - 5 * 3600e3); const inicioMes = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1));
  const [mantenimientos, checklists, kmMes] = await Promise.all([
    Mantenimiento.find(deEmpresa(req, { vehiculo: v._id })).sort({ fecha: -1 }).limit(100).lean(),
    InspeccionSst.find(deEmpresa(req, { placa: v.placa })).select('conductor fecha apto delDia numeroViaje').sort({ fecha: -1 }).limit(30).lean(),
    Pesv.kmDesde(req.empresaId, v.placa, inicioMes),
  ]);
  res.json({ ...v, kmSurTrack: Math.round(km[v.placa] || 0), kmEstimado: estimado, kmMes, mantenimientos, checklists,
    plan: (v.sst?.plan || []).map(p => ({ ...p, ...proximoMantenimiento(p, estimado) })) });
});
const planZ = z.object({
  kmActual: z.coerce.number().int().min(0).nullable().optional().default(null), venceRcContractual: fechaZ, venceRcExtracontractual: fechaZ,
  plan: z.array(z.object({ actividad: z.string().trim().min(2).max(120), cadaKm: z.coerce.number().int().min(0).nullable().optional().default(null),
    cadaDias: z.coerce.number().int().min(0).nullable().optional().default(null), ultimoKm: z.coerce.number().int().min(0).nullable().optional().default(null), ultimaFecha: fechaZ })).max(40),
});
r.put('/flota/:id', gestionar, async (req, res) => {
  const d = planZ.parse(req.body);
  const antes = await Vehiculo.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).select('sst.kmActual').lean();
  if (!antes) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const set = { 'sst.venceRcContractual': d.venceRcContractual, 'sst.venceRcExtracontractual': d.venceRcExtracontractual, 'sst.plan': d.plan };
  // Una lectura nueva del odómetro reinicia la suma de km de Sur Track
  if (d.kmActual !== (antes.sst?.kmActual ?? null)) { set['sst.kmActual'] = d.kmActual; set['sst.kmFecha'] = new Date(); }
  const v = await Vehiculo.findOneAndUpdate(deEmpresa(req, { _id: req.params.id }), { $set: set }, { new: true });
  await auditar(req, 'sst_plan_mantenimiento', { entidad: 'Vehiculo', entidadId: v._id, detalle: { placa: v.placa } });
  res.json(v.sst);
});
r.post('/flota/:id/mantenimientos', gestionar, async (req, res) => {
  const d = z.object({ tipo: z.enum(['preventivo', 'correctivo']), actividad: z.string().trim().min(2).max(120), fecha: fechaZ, km: z.coerce.number().int().min(0).nullable().optional().default(null),
    taller: texto(120), descripcion: texto(500), costo: z.coerce.number().min(0).default(0) }).parse(req.body);
  if (!d.fecha) throw new ErrorHttp(400, 'Indique la fecha');
  const v = await Vehiculo.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) }));
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const m = await Mantenimiento.create({ ...d, empresa: req.empresaId, vehiculo: v._id, placa: v.placa });
  // Un preventivo del plan actualiza su último km y fecha; el km del taller es una lectura del odómetro
  const it = (v.sst?.plan || []).find(p => p.actividad.toLowerCase() === d.actividad.toLowerCase());
  if (it && d.tipo === 'preventivo') { it.ultimaFecha = d.fecha; if (d.km != null) it.ultimoKm = d.km; }
  if (d.km != null && (v.sst?.kmActual == null || d.km >= v.sst.kmActual)) { v.set('sst.kmActual', d.km); v.set('sst.kmFecha', d.fecha); }
  await v.save();
  await auditar(req, 'sst_mantenimiento', { entidad: 'Vehiculo', entidadId: v._id, detalle: { placa: v.placa, actividad: d.actividad } });
  res.status(201).json(m);
});

// ── Capacitaciones ──────────────────────────────────────────────────────────
const capZ = z.object({ tema: z.string().trim().min(3).max(200), eje: z.enum(['sst', 'pesv', 'ambos']).default('sst'), dirigidoA: texto(150), fecha: fechaZ,
  horas: z.coerce.number().min(0.5).max(200).default(1), facilitador: texto(150), estado: z.enum(['programada', 'ejecutada', 'cancelada']).default('programada'),
  asistentes: z.array(z.object({ _id: oid.optional(), persona: z.object({ tipo: tipoZ, id: oid.nullable() }).optional().default({ tipo: 'tercero', id: null }), nombre: texto(120), documento: texto(20),
    asistio: z.boolean().default(true), firma: firmaZ.nullable().optional().default(null) })).max(300).default([]) });
r.get('/capacitaciones', ver, async (req, res) => res.json(await CapacitacionSst.find(deEmpresa(req)).select('-asistentes.firma').sort({ fecha: 1 }).lean()));
r.get('/capacitaciones/:id', ver, async (req, res) => {
  const c = await CapacitacionSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).lean();
  if (!c) throw new ErrorHttp(404, 'Capacitación no encontrada');
  res.json(c);
});
r.post('/capacitaciones', gestionar, async (req, res) => {
  const d = capZ.parse(req.body);
  if (!d.fecha) throw new ErrorHttp(400, 'Indique la fecha');
  const c = await CapacitacionSst.create({ ...d, empresa: req.empresaId });
  await auditar(req, 'sst_capacitacion', { entidad: 'CapacitacionSst', entidadId: c._id });
  res.status(201).json(c);
});
r.put('/capacitaciones/:id', gestionar, async (req, res) => {
  const d = capZ.parse(req.body);
  const antes = await CapacitacionSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).select('asistentes').lean();
  if (!antes) throw new ErrorHttp(404, 'Capacitación no encontrada');
  d.asistentes = FR.conservarRemotas(antes.asistentes, d.asistentes);   // las firmas que llegaron por WhatsApp no se pierden
  const c = await CapacitacionSst.findOneAndUpdate(deEmpresa(req, { _id: req.params.id }), { $set: d }, { new: true });
  if (!c) throw new ErrorHttp(404, 'Capacitación no encontrada');
  await auditar(req, 'sst_capacitacion_editar', { entidad: 'CapacitacionSst', entidadId: c._id });
  res.json(c);
});
// Fase 10: firma de la asistencia desde el celular (enlace por WhatsApp)
r.post('/capacitaciones/:id/firma-remota', gestionar, async (req, res) => {
  const { asistentes } = z.object({ asistentes: z.array(oid).max(300).optional() }).parse(req.body || {});
  res.json(await FR.prepararEnvios(req.empresaId, oid.parse(req.params.id), asistentes || null));
});
r.put('/capacitaciones/:id/firma-remota/:aid/enviado', gestionar, async (req, res) => {
  const r2 = await CapacitacionSst.updateOne(deEmpresa(req, { _id: oid.parse(req.params.id), asistentes: { $elemMatch: { _id: oid.parse(req.params.aid), 'remota.token': { $gt: '' } } } }),
    { $set: { 'asistentes.$.remota.enviado': new Date() } });
  if (!r2.matchedCount) throw new ErrorHttp(404, 'Primero genere el enlace');
  await auditar(req, 'sst_firma_whatsapp', { entidad: 'CapacitacionSst', entidadId: req.params.id, detalle: { asistente: req.params.aid } });
  res.json({ enviado: new Date() });
});

// La planilla de asistencia (SST-FOR-07) sale de la capacitación, con el membrete y las firmas de los asistentes
r.get('/capacitaciones/:id/asistencia.pdf', ver, async (req, res) => {
  const c = await CapacitacionSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).lean();
  if (!c) throw new ErrorHttp(404, 'Capacitación no encontrada');
  const p = Cat.plantilla('SST-FOR-07');
  const { e, numVehiculos } = await empresaCompleta(req);
  const ctx = ctxDe(req, e, numVehiculos, p);
  const datos = { tema: c.tema, fecha: c.fecha?.toISOString().slice(0, 10), duracion: c.horas, facilitador: c.facilitador, dirigido: c.dirigidoA,
    asistentes: c.asistentes.filter(a => a.asistio).map(a => ({ nombre: a.nombre, documento: a.documento, cargo: '', firma: a.firma?.imagen || '' })),
    firmasElectronicas: FR.evidenciaFirmas(c.asistentes) };
  enviar(res, await A.pdfFormato({ plantilla: p, datos, ctx, membrete: e.membrete || {}, logo: e.logo }), `Asistencia_${c.fecha?.toISOString().slice(0, 10)}.pdf`, 'pdf', true);
});

// ── Preoperacionales: copia de los checklists de Sur Track ─────────────────
r.get('/preoperacionales', ver, async (req, res) => {
  const q = z.object({ placa: z.string().max(8).optional(), desde: z.string().optional(), hasta: z.string().optional(), noAptos: z.enum(['0', '1']).default('0') }).parse(req.query);
  const f = deEmpresa(req);
  if (q.placa) f.placa = q.placa.toUpperCase();
  if (q.noAptos === '1') f.apto = false;
  const d = parseFecha(q.desde); const h = parseFecha(q.hasta);
  if (d || h) f.fecha = { ...(d ? { $gte: new Date(d.getTime() + 5 * 3600e3) } : {}), ...(h ? { $lte: new Date(h.getTime() + 86_399_999 + 5 * 3600e3) } : {}) };
  res.json(await InspeccionSst.find(f).select('-firma.imagen').sort({ fecha: -1 }).limit(500).lean());
});
r.post('/preoperacionales/sincronizar', ver, async (req, res) => res.json(await Pesv.sincronizarChecklists(req.empresaId, { forzar: true, dias: 7 })));
// Lo que hizo la empresa con un checklist (sobre todo con un no apto)
r.put('/preoperacionales/:id/revision', gestionar, async (req, res) => {
  const d = z.object({ accion: z.string().trim().min(3).max(500) }).parse(req.body);
  const i = await InspeccionSst.findOneAndUpdate(deEmpresa(req, { _id: oid.parse(req.params.id) }), { $set: { revision: { por: req.usuario.nombre, fecha: new Date(), accion: d.accion } } }, { new: true });
  if (!i) throw new ErrorHttp(404, 'No encontrado');
  await auditar(req, 'sst_revision_checklist', { entidad: 'InspeccionSst', entidadId: i._id });
  res.json(i.revision);
});
// PDF de la copia guardada (formato SST-FOR-06 con membrete); varios en un solo PDF con ?ids=a,b,c o por placa y rango
async function pdfDeCopia(req, i, e, numVehiculos) {
  const [vehiculo, conductor] = await Promise.all([
    Vehiculo.findOne(deEmpresa(req, { placa: i.placa })).select('soat venceTecnomecanica sst.kmActual').lean(),
    i.tercero ? Tercero.findOne(deEmpresa(req, { _id: i.tercero })).select('nombres apellido1 apellido2 numId licencia').lean() : null,
  ]);
  const checklist = { checklistId: i.checklistId, fecha: i.fecha, completo: i.completo, venceRevisionTecnica: i.venceRtmDeclarada, ubicacion: i.ubicacion,
    firma: i.firma ? { nombre: i.firma.nombre, cedula: i.firma.documento, imagenBase64: i.firma.imagen } : null };
  for (const it of i.items) { checklist[it.grupo] ||= {}; checklist[it.grupo][it.codigo] = it.cumple; }
  const viaje = i.viaje ? await Viaje.findOne(deEmpresa(req, { _id: i.viaje })).select('numero fecha placa destino conductorNombre cliente rastreo.resumen.km')
    .populate({ path: 'cliente', select: 'nombre', match: { empresa: req.empresaId } }).lean() : null;
  const datos = Ck.datosSurTrack({ viaje: { numero: viaje?.numero ?? i.numeroViaje, fecha: viaje?.fecha || i.fechaViaje, placa: i.placa, destino: viaje?.destino, cliente: viaje?.cliente?.nombre,
    conductor: i.conductor, km: viaje?.rastreo?.resumen?.km ?? null }, conductor, vehiculo, checklist });
  if (i.revision?.accion) { datos.revisado = i.revision.por; datos.fechaRevision = i.revision.fecha ? new Date(i.revision.fecha).toISOString().slice(0, 10).split('-').reverse().join('/') : '';
    datos.novedades = `${datos.novedades}. Acción: ${i.revision.accion}`; }
  return { plantilla: Ck.plantillaSurTrack(), datos, ctx: ctxDe(req, e, numVehiculos), membrete: e.membrete || {}, logo: e.logo, firmas: [{ campo: 'firma_conductor', nombre: datos.conductor }] };
}
r.get('/preoperacionales/:id/pdf', ver, async (req, res) => {
  const i = await InspeccionSst.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).lean();
  if (!i) throw new ErrorHttp(404, 'No encontrado');
  const { e, numVehiculos } = await empresaCompleta(req);
  enviar(res, await A.pdfFormato(await pdfDeCopia(req, i, e, numVehiculos)), Ck.nombreChecklist(i.placa, i.fecha), 'pdf', req.query.ver === '1');
});
// Todos los de una placa (o de la flota) en un periodo, en un solo PDF para la auditoría
r.get('/preoperacionales.pdf', ver, async (req, res) => {
  const q = z.object({ placa: z.string().max(8).optional(), desde: z.string(), hasta: z.string() }).parse(req.query);
  const d = parseFecha(q.desde); const h = parseFecha(q.hasta);
  if (!d || !h) throw new ErrorHttp(400, 'Indique desde y hasta');
  const f = deEmpresa(req, { fecha: { $gte: new Date(d.getTime() + 5 * 3600e3), $lte: new Date(h.getTime() + 86_399_999 + 5 * 3600e3) } });
  if (q.placa) f.placa = q.placa.toUpperCase();
  const lista = await InspeccionSst.find(f).sort({ placa: 1, fecha: 1 }).limit(400).lean();
  if (!lista.length) throw new ErrorHttp(404, 'No hay checklists en ese periodo');
  const { e, numVehiculos } = await empresaCompleta(req);
  const { PDFDocument } = await import('pdf-lib');
  const unido = await PDFDocument.create();
  for (const i of lista) {
    const uno = await PDFDocument.load(await A.pdfFormato(await pdfDeCopia(req, i, e, numVehiculos)));
    for (const pg of await unido.copyPages(uno, uno.getPageIndices())) unido.addPage(pg);
  }
  await auditar(req, 'sst_checklists_pdf', { detalle: { placa: q.placa || 'todas', desde: q.desde, hasta: q.hasta, n: lista.length } });
  enviar(res, Buffer.from(await unido.save()), `checklists_${q.placa || 'flota'}_${q.desde}_${q.hasta}.pdf`, 'pdf');
});

export default r;

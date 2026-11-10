// Importación desde Excel. El archivo se envía como cuerpo binario
// (application/octet-stream o tipo de Excel). Cada importación queda auditada
// con el nombre y la huella SHA-256 del archivo (evidencia de qué se cargó).
import { Router } from 'express';
import express from 'express';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { generarPlantilla, importarMaestros, PLANTILLAS } from '../services/importacion/maestros.js';
import { importarPlantillaViajes } from '../services/importacion/plantilla.js';
import { huellaArchivo, MAX_BYTES } from '../services/importacion/excel.js';
import { completarViajes, ponerConductor } from '../services/importacion/completarViajes.js';
import { analizarViajes, plantillaViajes, registrarViajes } from '../services/importacion/viajesExcel.js';
import { z } from 'zod';

const r = Router();
r.use(autenticar, soloEmpresa);
const binario = express.raw({ type: () => true, limit: MAX_BYTES });
const nombreArchivo = (req) => {
  let n = String(req.headers['x-nombre-archivo'] || 'archivo.xlsx');
  try { n = decodeURIComponent(n); } catch { /* se deja como llegó */ }
  return n.replace(/[^\p{L}\p{N}_.\- ]/gu, '_').slice(0, 120);
};

const PERMISO = { vehiculos: [P.MAESTROS_EDITAR], terceros: [P.MAESTROS_EDITAR], tarifas: [P.MAESTROS_EDITAR, P.TARIFAS_EDITAR] };
const tipoValido = (req) => {
  if (!PLANTILLAS[req.params.tipo]) throw new ErrorHttp(404, 'Tipo de importación no disponible');
  return req.params.tipo;
};

r.get('/plantillas/:tipo', permitir(P.MAESTROS_VER), async (req, res) => {
  const tipo = tipoValido(req);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Plantilla_${tipo}.xlsx"`);
  res.send(await generarPlantilla(tipo));
});

// El permiso depende del tipo (las tarifas también las puede cargar Contabilidad).
const permisoPorTipo = (req, res, next) => permitir(...PERMISO[tipoValido(req)])(req, res, next);

r.post('/maestros/:tipo', permisoPorTipo, binario, async (req, res) => {
  const tipo = req.params.tipo;
  const simular = req.query.simular !== '0';
  const resultado = await importarMaestros(tipo, req.empresaId, req.body, { simular });
  if (!simular) {
    await auditar(req, 'importar_excel', { entidad: tipo, detalle: { archivo: nombreArchivo(req), sha256: huellaArchivo(req.body),
      total: resultado.total, nuevos: resultado.nuevos, actualizados: resultado.actualizados, errores: resultado.errores.length } });
  }
  res.json(resultado);
});

// Plantilla completa de viajes (Excel de la operación anterior). Solo administradores.
r.post('/plantilla-viajes', permitir(P.CONFIG_GESTIONAR), binario, async (req, res) => {
  const resultado = await importarPlantillaViajes(req.empresaId, req.body, { usuario: req.usuario._id });
  await auditar(req, 'importar_plantilla_viajes', { detalle: { archivo: nombreArchivo(req), sha256: huellaArchivo(req.body), resultado } });
  res.json(resultado);
});

// ── Viajes desde Excel (relación de fletes o plantilla), como si se hubieran registrado ──
r.get('/viajes/plantilla', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_viajes.xlsx"');
  res.send(await plantillaViajes());
});

// Revisa el archivo: no guarda nada
r.post('/viajes/analizar', permitir(P.CONFIG_GESTIONAR), binario, async (req, res) => {
  const cliente = /^[a-f0-9]{24}$/i.test(String(req.query.cliente || '')) ? String(req.query.cliente) : '';
  res.json(await analizarViajes(req.empresaId, req.body, { cliente, manifiesto: req.query.manifiesto !== '0', auxiliarPagado: req.query.auxiliarPagado !== '0' }));
});

const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const filaViaje = z.object({
  fila: z.number().int().min(1), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cliente: oid, tarifaRef: oid, conductor: oid,
  placa: z.string().trim().max(8), cantidad: z.coerce.number().min(0).max(100000).optional().default(1), planilla: z.string().trim().max(30).optional().default(''),
  tarifa: z.coerce.number().min(0).optional().default(0), flete: z.coerce.number().min(0).optional().default(0), anticipo: z.coerce.number().min(0).optional().default(0),
  diasAuxiliar: z.coerce.number().int().min(0).max(5).optional().default(0), auxiliarPagado: z.boolean().optional().default(false),
  requiereManifiesto: z.boolean().optional().default(true), observaciones: z.string().max(500).optional().default(''), confirmarRepetido: z.boolean().optional().default(false),
  completarDeTarifa: z.boolean().optional().default(false),
});
// Registra los viajes elegidos y aprobados en la revisión
r.post('/viajes/registrar', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const { filas, archivo } = z.object({ filas: z.array(filaViaje).min(1).max(3000), archivo: z.string().max(120).optional().default('') }).parse(req.body);
  const resultado = await registrarViajes(req.empresaId, req.usuario._id, filas);
  await auditar(req, 'importar_viajes_excel', { detalle: { archivo, enviados: filas.length, creados: resultado.creados.length, fallidos: resultado.fallidos.length,
    numeros: resultado.creados.map((x) => x.numero), repetidosAprobados: filas.filter((x) => x.confirmarRepetido).length } });
  res.json(resultado);
});

// Completar los datos que les faltan a los viajes (importados del Excel): revisar (sin cambios) o aplicar.
r.post('/completar-viajes', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const aplicar = req.query.aplicar === '1';
  const resultado = await completarViajes(req.empresaId, { aplicar });
  if (aplicar) await auditar(req, 'completar_viajes', { detalle: { revisados: resultado.revisados, viajes: resultado.viajesConCambios, cambios: resultado.cambios, pendientes: resultado.pendientes.length } });
  res.json(resultado);
});

// Conductor elegido a mano para un viaje que no lo tiene (aunque ya tenga manifiesto)
r.post('/completar-viajes/:id/conductor', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id) || !/^[a-f0-9]{24}$/i.test(String(req.body?.conductor || ''))) throw new ErrorHttp(400, 'Datos no válidos');
  const r2 = await ponerConductor(req.empresaId, req.params.id, req.body.conductor);
  if (!r2.ok) throw new ErrorHttp(409, r2.error);
  await auditar(req, 'poner_conductor_viaje', { entidad: 'Viaje', entidadId: req.params.id, detalle: { conductor: req.body.conductor } });
  res.json(r2);
});

export default r;

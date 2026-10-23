// Rastreo GPS de viajes con Sur Track: activar/finalizar por viaje, monitoreo en vivo,
// recorrido, enlace con viajes rastreados desde Cooespatrans y vehículos de Sur Track.
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import * as st from '../services/rastreo/surtrack.js';
import { leerLibro, filas, txt, num } from '../services/importacion/excel.js';
import { libroExcel } from '../services/reportes/comun.js';
import { checklistPdf } from '../services/reportes/checklist.js';
import { normalizar, parseFecha } from '../utils/texto.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const id = (v) => { if (!mongoose.isValidObjectId(v)) throw new ErrorHttp(400, 'Identificador inválido'); return v; };

// Estado de la integración para la empresa (la interfaz muestra u oculta el rastreo con esto)
r.get('/estado', permitir(P.VIAJES_VER), async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('rastreo').lean();
  res.json({ habilitado: !!e?.rastreo?.surTrack && st.configurado(), configuradoServidor: st.configurado(),
    velocidadMaxima: e?.rastreo?.velocidadMaxima ?? 80, minutosSinSenal: e?.rastreo?.minutosSinSenal ?? 10, surTrack: !!e?.rastreo?.surTrack });
});

r.put('/configuracion', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const d = z.object({ surTrack: z.boolean(), velocidadMaxima: z.coerce.number().min(20).max(150), minutosSinSenal: z.coerce.number().min(2).max(240) }).parse(req.body);
  await Empresa.updateOne({ _id: req.empresaId }, { $set: { rastreo: d } });
  await auditar(req, 'configurar_rastreo', { detalle: d });
  res.json(d);
});

r.get('/en-vivo', permitir(P.VIAJES_VER), async (req, res) => res.json(await st.enVivo(req.empresaId)));

r.get('/viajes/:id/recorrido', permitir(P.VIAJES_VER), async (req, res) => res.json(await st.recorrido(req.empresaId, id(req.params.id))));

r.post('/viajes/:id/activar', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const rastreo = await st.activar(req.empresaId, id(req.params.id), req.usuario._id, req.body || {});
  await auditar(req, 'activar_rastreo', { entidad: 'Viaje', entidadId: req.params.id, detalle: { codigo: rastreo.codigoExterno, modalidad: rastreo.modalidad, clientes: rastreo.clientes?.length || 0 } });
  res.json(rastreo);
});

// Cambiar el destino o los clientes mientras el conductor no haya aceptado el viaje en Sur Track
r.put('/viajes/:id/paradas', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const rastreo = await st.actualizarParadas(req.empresaId, id(req.params.id), req.body || {});
  await auditar(req, 'paradas_rastreo', { entidad: 'Viaje', entidadId: req.params.id, detalle: { modalidad: rastreo.modalidad, clientes: rastreo.clientes?.length || 0 } });
  res.json(rastreo);
});

// Búsqueda de direcciones / municipios para el destino (OpenStreetMap)
r.get('/geocodificar', permitir(P.VIAJES_VER), async (req, res) => res.json(await st.geocodificar(req.query.q)));

// Ruta sugerida entre puntos [{lat,lng}...] (vista previa al elegir destino o clientes)
r.post('/ruta', permitir(P.VIAJES_VER), async (req, res) => res.json(await st.rutaSugerida(Array.isArray(req.body?.puntos) ? req.body.puntos : [])));

// Clientes del viaje desde Excel: devuelve las filas leídas para revisarlas antes de guardar
const COLUMNAS_CLIENTES = [
  ['nombre', ['nombre', 'cliente', 'razon social', 'nombre cliente']], ['direccion', ['direccion', 'dir']], ['ciudad', ['ciudad', 'municipio']],
  ['telefono', ['telefono', 'celular', 'tel']], ['documento', ['documento', 'cedula', 'nit', 'identificacion']],
  ['factura', ['factura', 'n factura', 'numero factura', 'no factura']], ['valor', ['valor', 'valor a recibir', 'total']],
  ['lat', ['latitud', 'lat']], ['lng', ['longitud', 'lng', 'lon']],
];
r.post('/clientes/importar', permitir(P.VIAJES_REGISTRAR), express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  if (!req.body?.length) throw new ErrorHttp(400, 'Adjunte el archivo de Excel');
  let libro;
  try { libro = await leerLibro(req.body); } catch { throw new ErrorHttp(400, 'No se pudo leer el archivo: use un Excel (.xlsx)'); }
  const hoja = libro.worksheets[0];
  const todas = hoja ? filas(hoja) : [];
  const iCab = todas.findIndex(f => f.some(c => /nombre|cliente/i.test(txt(c))));
  if (iCab < 0) throw new ErrorHttp(400, 'No se encontró la fila de títulos (debe tener una columna «Nombre»)');
  const cab = todas[iCab].map(c => normalizar(txt(c)).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim());
  const col = Object.fromEntries(COLUMNAS_CLIENTES.map(([k, alias]) => [k, cab.findIndex(c => alias.includes(c))]));
  const clientes = todas.slice(iCab + 1).map(f => Object.fromEntries(COLUMNAS_CLIENTES.map(([k]) => {
    const v = col[k] >= 0 ? f[col[k]] : '';
    return [k, ['valor', 'lat', 'lng'].includes(k) ? (num(v) ?? null) : txt(v)];
  }))).filter(c => c.nombre).slice(0, 200);
  res.json({ clientes, omitidas: Math.max(0, todas.length - iCab - 1 - clientes.length) });
});

r.get('/clientes/plantilla', permitir(P.VIAJES_VER), async (req, res) => {
  const buf = await libroExcel({ empresa: await Empresa.findById(req.empresaId).lean(), titulo: 'Clientes del viaje',
    subtitulo: 'Una fila por cliente. Latitud y longitud son opcionales.',
    columnas: ['Nombre', 'Dirección', 'Ciudad', 'Teléfono', 'Documento', 'Factura', 'Valor', 'Latitud', 'Longitud'].map(t => ({ titulo: t, ancho: t === 'Dirección' ? 34 : 16 })),
    filas: [['Tienda La Esquina', 'Calle 18 # 25-30', 'Pasto', '3001234567', '900123456', 'F-001', 150000, '', '']] });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_clientes_viaje.xlsx"');
  res.send(buf);
});

// Historial de monitoreo: viajes con el rastreo terminado, con filtros
r.get('/historial', permitir(P.VIAJES_VER), async (req, res) => {
  const q = req.query;
  const hasta = parseFecha(q.hasta);
  res.json(await st.historial(req.empresaId, { desde: parseFecha(q.desde), hasta: hasta ? new Date(hasta.getTime() + 86399999) : null,
    placa: q.placa, conductor: mongoose.isValidObjectId(q.conductor) ? q.conductor : null, modalidad: ['destino', 'clientes'].includes(q.modalidad) ? q.modalidad : '',
    pagina: q.pagina, limite: q.limite }));
});

// Checklist preoperacional del día del conductor del viaje: ver (con la firma) y descargar en PDF
r.get('/viajes/:id/checklist', permitir(P.VIAJES_VER), async (req, res) => res.json(await st.checklistDelViaje(req.empresaId, id(req.params.id), { conFirma: true })));
r.get('/viajes/:id/checklist/pdf', permitir(P.VIAJES_VER), async (req, res) => {
  const d = await st.checklistDelViaje(req.empresaId, id(req.params.id), { conFirma: true });
  if (!d.checklist) throw new ErrorHttp(404, 'El conductor no tiene checklist registrado en Sur Track');
  const buf = await checklistPdf(await Empresa.findById(req.empresaId).lean(), d);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.ver === '1' ? 'inline' : 'attachment'}; filename="checklist_${d.viaje.placa}_${new Date(d.checklist.fecha).toISOString().slice(0, 10)}.pdf"`);
  res.send(buf);
});

r.post('/viajes/:id/finalizar', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const rastreo = await st.finalizar(req.empresaId, id(req.params.id));
  await auditar(req, 'finalizar_rastreo', { entidad: 'Viaje', entidadId: req.params.id });
  res.json(rastreo);
});

r.post('/viajes/:id/enlazar', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const { externoId } = z.object({ externoId: z.string().regex(/^[a-f0-9]{24}$/i, 'Rastreo inválido') }).parse(req.body);
  const rastreo = await st.enlazar(req.empresaId, id(req.params.id), externoId);
  await auditar(req, 'enlazar_rastreo', { entidad: 'Viaje', entidadId: req.params.id, detalle: { externoId, codigo: rastreo.codigoExterno } });
  res.json(rastreo);
});

// Vehículos y conductores de Sur Track: plan (qué se crea o vincula) y aplicar
r.get('/vehiculos/plan', permitir(P.MAESTROS_EDITAR), async (req, res) => { await st.exigirHabilitado(req.empresaId); res.json(await st.planVehiculos(req.empresaId)); });
r.post('/vehiculos/sincronizar', permitir(P.MAESTROS_EDITAR), async (req, res) => {
  await st.exigirHabilitado(req.empresaId);
  const resultado = await st.sincronizarVehiculos(req.empresaId);
  await auditar(req, 'sincronizar_surtrack', { detalle: resultado });
  res.json(resultado);
});

export default r;

// Rastreo GPS de viajes con Sur Track: activar/finalizar por viaje, monitoreo en vivo,
// recorrido, enlace con viajes rastreados desde Cooespatrans y vehículos de Sur Track.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import * as st from '../services/rastreo/surtrack.js';

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
  const rastreo = await st.activar(req.empresaId, id(req.params.id), req.usuario._id);
  await auditar(req, 'activar_rastreo', { entidad: 'Viaje', entidadId: req.params.id, detalle: { codigo: rastreo.codigoExterno } });
  res.json(rastreo);
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

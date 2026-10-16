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

export default r;

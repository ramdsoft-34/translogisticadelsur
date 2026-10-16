// Importación de maestros desde Excel con plantillas descargables.
// Cada fila pasa por las MISMAS reglas que los formularios (validaciones/maestros.js).
// Flujo: 1) simular → muestra nuevos, actualizados y errores por fila; 2) aplicar.
// Solo se escriben datos de la empresa del usuario; las filas existentes se
// actualizan únicamente con las celdas que traen valor (no se borra nada).
import ExcelJS from 'exceljs';
import { Cliente, Tarifa, Tercero, Vehiculo, Municipio, Empresa } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { normalizar, soloDigitos } from '../../utils/texto.js';
import { clienteSchema, tarifaSchema, terceroSchema, vehiculoSchema, ROLES_TERCERO } from '../../validaciones/maestros.js';
import { leerLibro, filas, txt, entero, num, fecha, indiceEncabezados, buscadorMunicipios } from './excel.js';
import { variablesTercero, variablesVehiculo, huella } from '../rndc/documentos.js';
import { TIPOS_ID } from '../rndc/catalogos.js';

const fechaIso = (v) => { const f = fecha(v); return f ? f.toISOString().slice(0, 10) : null; };
const doc = (v) => entero(v).replace(/[.\s,-]/g, '');

// Columnas: [título, campo, obligatoria, ayuda]
export const PLANTILLAS = {
  vehiculos: {
    titulo: 'Vehículos',
    columnas: [
      ['Placa', 'placa', true, 'ABC123'], ['Clase', 'clase', false, 'vehiculo o remolque'],
      ['Configuración', 'configuracionNombre', false, 'Para el QR: 2, 3, 2S2, 3S3…'], ['Código configuración RNDC', 'configuracion', false, 'Tabla del RNDC'],
      ['Marca', 'marcaNombre', false, ''], ['Código marca RNDC', 'marca', false, ''], ['Código línea RNDC', 'linea', false, ''],
      ['Modelo', 'modelo', false, 'Año'], ['Código color RNDC', 'color', false, ''], ['Código carrocería RNDC', 'carroceria', false, ''],
      ['Código combustible RNDC', 'combustible', false, ''], ['Ejes', 'ejes', false, ''], ['Peso vacío kg', 'pesoVacio', false, ''],
      ['PBV kg', 'pbv', false, 'Peso bruto vehicular'], ['Capacidad kg', 'capacidad', false, ''],
      ['Número SOAT', 'soat.numero', false, ''], ['Vence SOAT', 'soat.vence', false, 'dd/mm/aaaa'], ['NIT aseguradora SOAT', 'soat.aseguradoraNit', false, ''],
      ['Aseguradora SOAT', 'aseguradoraSoat', false, 'Nombre'], ['Vence tecnomecánica', 'venceTecnomecanica', false, 'dd/mm/aaaa'],
      ['Tipo doc propietario', 'propietario.tipoId', false, 'C, N, E…'], ['Documento propietario', 'propietario.numId', false, ''],
      ['Tipo doc tenedor', 'tenedor.tipoId', false, 'C, N, E…'], ['Documento tenedor', 'tenedor.numId', false, ''],
      ['Cédula conductor habitual', '_conductor', false, 'Debe existir como tercero'],
    ],
  },
  terceros: {
    titulo: 'Conductores y terceros',
    columnas: [
      ['Tipo documento', 'tipoId', true, 'C, N, P, E, T, U'], ['Número documento', 'numId', true, 'NIT con dígito de verificación, sin guion'],
      ['Nombres o razón social', 'nombres', true, ''], ['Primer apellido', 'apellido1', false, 'Obligatorio para personas'],
      ['Segundo apellido', 'apellido2', false, ''], ['Código sede', 'sede.codigo', false, 'Solo empresas con varias sedes'],
      ['Nombre sede', 'sede.nombre', false, ''], ['Celular', 'celular', false, '10 dígitos'], ['Teléfono fijo', 'telefono', false, '7 dígitos'],
      ['Dirección', 'direccion', false, ''], ['Municipio', '_municipio', false, 'Código DIVIPOLA de 8 dígitos o "PASTO NARIÑO"'],
      ['Correo', 'correo', false, ''], ['Roles', 'roles', false, 'conductor, titular, propietario, tenedor, remitente, destinatario'],
      ['Categoría licencia', 'licencia.categoria', false, 'C1, C2, C3…'], ['Número licencia', 'licencia.numero', false, ''],
      ['Vence licencia', 'licencia.vence', false, 'dd/mm/aaaa'], ['Fecha nacimiento', 'fechaNacimiento', false, 'dd/mm/aaaa'],
      ['Banco', 'banco.entidad', false, ''], ['Tipo cuenta', 'banco.tipoCuenta', false, 'Ahorros o Corriente'], ['Número cuenta', 'banco.cuenta', false, ''],
    ],
  },
  tarifas: {
    titulo: 'Clientes y tarifas',
    columnas: [
      ['Cliente', '_cliente', true, 'Nombre corto; si no existe se crea'], ['Tipo documento cliente', '_clienteTipo', false, 'N (por defecto) o C'],
      ['NIT cliente', '_clienteNit', false, 'Tal como lo registra el RNDC'], ['Sede remitente RNDC', '_clienteSede', false, ''],
      ['Destino', 'destino', true, 'Nombre del destino'], ['Municipio destino', '_municipio', false, 'Código DIVIPOLA o nombre'],
      ['Cobro', 'tipoCobro', false, 'viaje o unidad'], ['Tarifa cliente', 'tarifaCliente', false, 'Pesos (COP)'],
      ['Flete conductor', 'fleteConductor', false, 'Pesos (COP)'], ['Anticipo habitual', 'anticipoHabitual', false, 'Pesos (COP)'],
      ['Auxiliar cobro', 'tarifaAuxiliar', false, 'Pesos (COP)'], ['Auxiliar pago', 'auxiliarPagado', false, 'Pesos (COP)'],
      ['Peso kg', 'pesoKg', false, ''], ['Tipo manifiesto', 'operacion', false, 'G general, U urbano; vacío = el de la empresa'],
      ['Destinatario tipo', 'destinatario.tipoId', false, 'Vacío = el cliente'], ['Destinatario documento', 'destinatario.numId', false, ''],
      ['Destinatario sede', 'destinatario.sede', false, ''],
    ],
  },
};

export async function generarPlantilla(tipo) {
  const def = PLANTILLAS[tipo];
  if (!def) throw new ErrorHttp(404, 'Plantilla no disponible');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(def.titulo);
  const h = ws.addRow(def.columnas.map(([t, , obl]) => (obl ? `${t} *` : t)));
  h.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFF5B800' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
    c.alignment = { wrapText: true, vertical: 'middle' };
  });
  ws.columns.forEach(c => { c.width = 20; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const ayuda = wb.addWorksheet('Instrucciones');
  ayuda.addRow(['Columna', 'Obligatoria', 'Formato / ayuda']).font = { bold: true };
  for (const [t, , obl, a] of def.columnas) ayuda.addRow([t, obl ? 'Sí' : 'No', a]);
  ayuda.addRow([]);
  ayuda.addRow(['Escriba los datos en la primera hoja, desde la fila 2. Las filas existentes se actualizan solo con las celdas que tengan valor.']);
  ayuda.addRow([`Tipos de documento: ${Object.entries(TIPOS_ID).map(([k, v]) => `${k} = ${v}`).join('; ')}`]);
  ayuda.getColumn(1).width = 28; ayuda.getColumn(2).width = 12; ayuda.getColumn(3).width = 70;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Convierte la fila en un objeto con rutas anidadas ("soat.vence" → { soat: { vence } }).
function objetoFila(def, idx, fila) {
  const o = {};
  let vacia = true;
  for (const [titulo, campo] of def.columnas) {
    const i = idx.get(normalizar(titulo));
    if (i === undefined) continue;
    const v = fila[i];
    if (v === null || v === undefined || txt(v) === '') continue;
    vacia = false;
    const partes = campo.split('.');
    let cur = o;
    for (const p of partes.slice(0, -1)) cur = cur[p] = cur[p] || {};
    cur[partes.at(-1)] = v;
  }
  return vacia ? null : o;
}

// Solo las rutas que trae la fila (para no borrar datos al actualizar).
function aplanar(o, prefijo = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) aplanar(v, ruta, out);
    else out[ruta] = v;
  }
  return out;
}
const rutasPresentes = (crudo, validado) => {
  const presentes = Object.keys(aplanar(crudo)).filter(k => !k.startsWith('_'));
  const plano = aplanar(validado);
  return Object.fromEntries(presentes.filter(k => k in plano).map(k => [k, plano[k]]));
};

const errores = (e) => (e.issues ? e.issues.map(i => `${i.path.join('.') || 'dato'}: ${i.message}`) : [e.message]);

export async function importarMaestros(tipo, empresaId, buffer, { simular = true } = {}) {
  const def = PLANTILLAS[tipo];
  if (!def) throw new ErrorHttp(404, 'Tipo de importación no disponible');
  const wb = await leerLibro(buffer);
  const ws = wb.worksheets[0];
  const todas = filas(ws);
  const idx = indiceEncabezados(todas[0]);
  const faltan = def.columnas.filter(([t, , obl]) => obl && !idx.has(normalizar(t))).map(([t]) => t);
  if (faltan.length) throw new ErrorHttp(400, `Faltan columnas obligatorias: ${faltan.join(', ')}. Descargue la plantilla.`);
  const E = empresaId;
  const empresa = await Empresa.findById(E).lean();
  const municipioDe = buscadorMunicipios(await Municipio.find().lean());
  const res = { total: 0, nuevos: 0, actualizados: 0, sinCambios: 0, errores: [], simulado: simular };

  if (tipo === 'terceros' || tipo === 'vehiculos') {
    const modelo = tipo === 'terceros' ? Tercero : Vehiculo;
    const clave = tipo === 'terceros' ? (d) => `${d.tipoId}|${d.numId}|${d.sede?.codigo || ''}` : (d) => d.placa;
    const existentes = new Map((await modelo.find({ empresa: E }).lean()).map(x => [clave(x), x]));
    const conductores = tipo === 'vehiculos'
      ? new Map((await Tercero.find({ empresa: E, roles: 'conductor' }).select('numId').lean()).map(x => [x.numId, x._id])) : null;
    const vistos = new Set();
    for (let n = 1; n < todas.length; n++) {
      const crudo = objetoFila(def, idx, todas[n] || []);
      if (!crudo) continue;
      res.total += 1;
      try {
        // Normalización de celdas de Excel (números, fechas, listas)
        const fila = structuredClone(crudo);
        if (tipo === 'terceros') {
          fila.tipoId = txt(fila.tipoId).toUpperCase(); fila.numId = doc(fila.numId);
          for (const k of ['celular', 'telefono']) if (fila[k] !== undefined) fila[k] = entero(fila[k]);
          if (fila._municipio) { fila.codMunicipio = municipioDe(fila._municipio); if (!fila.codMunicipio) throw new Error(`municipio no reconocido: ${txt(fila._municipio)}`); }
          if (fila.roles) fila.roles = txt(fila.roles).toLowerCase().split(/[,;]/).map(s => s.trim()).filter(Boolean);
          const desconocidos = (fila.roles || []).filter(r => !ROLES_TERCERO.includes(r));
          if (desconocidos.length) throw new Error(`rol no válido: ${desconocidos.join(', ')}`);
          if (fila.licencia?.vence) fila.licencia.vence = fechaIso(fila.licencia.vence);
          if (fila.licencia?.numero) fila.licencia.numero = entero(fila.licencia.numero);
          if (fila.fechaNacimiento) fila.fechaNacimiento = fechaIso(fila.fechaNacimiento);
          if (fila.banco?.cuenta) fila.banco.cuenta = entero(fila.banco.cuenta);
          if (fila.sede?.codigo) fila.sede.codigo = entero(fila.sede.codigo);
          for (const k of ['nombres', 'apellido1', 'apellido2', 'direccion', 'correo']) if (fila[k] !== undefined) fila[k] = txt(fila[k]);
        } else {
          for (const k of ['ejes', 'modelo', 'pesoVacio', 'pbv', 'capacidad']) if (fila[k] !== undefined) fila[k] = num(fila[k]);
          for (const k of ['configuracion', 'marca', 'linea', 'color', 'carroceria', 'combustible', 'configuracionNombre', 'marcaNombre', 'aseguradoraSoat', 'placa', 'clase']) {
            if (fila[k] !== undefined) fila[k] = entero(fila[k]);
          }
          if (fila.clase) fila.clase = normalizar(fila.clase) === 'REMOLQUE' ? 'remolque' : 'vehiculo';
          if (fila.soat) { if (fila.soat.vence) fila.soat.vence = fechaIso(fila.soat.vence); if (fila.soat.numero) fila.soat.numero = entero(fila.soat.numero); if (fila.soat.aseguradoraNit) fila.soat.aseguradoraNit = doc(fila.soat.aseguradoraNit); }
          if (fila.venceTecnomecanica) fila.venceTecnomecanica = fechaIso(fila.venceTecnomecanica);
          for (const k of ['propietario', 'tenedor']) if (fila[k]) fila[k] = { tipoId: txt(fila[k].tipoId).toUpperCase(), numId: doc(fila[k].numId) };
          if (fila._conductor) {
            const id = conductores.get(doc(fila._conductor));
            if (!id) throw new Error(`el conductor ${doc(fila._conductor)} no existe en Conductores y terceros`);
            fila.conductorHabitual = String(id);
          }
        }
        const schema = tipo === 'terceros' ? terceroSchema : vehiculoSchema;
        const k = clave(tipo === 'vehiculos' ? { placa: txt(fila.placa).toUpperCase().replace(/[\s-]/g, '') } : fila);
        if (vistos.has(k)) throw new Error('fila repetida en el archivo');
        vistos.add(k);
        const ex = existentes.get(k);
        if (!ex) {
          const d = schema.parse(fila);
          res.nuevos += 1;
          if (!simular) await modelo.create({ ...d, empresa: E });
          continue;
        }
        // Actualización: se valida la combinación (existente + fila) y se escriben solo las celdas con valor.
        const combinado = schema.parse({ ...ex, ...fila, sede: { ...ex.sede, ...fila.sede }, licencia: { ...ex.licencia, ...fila.licencia },
          banco: { ...ex.banco, ...fila.banco }, soat: { ...ex.soat, ...fila.soat }, conductorHabitual: fila.conductorHabitual ?? (ex.conductorHabitual ? String(ex.conductorHabitual) : null),
          titularHabitual: ex.titularHabitual ? String(ex.titularHabitual) : null,
          roles: [...new Set([...(ex.roles || []), ...(fila.roles || [])])] });
        const set = rutasPresentes(fila, combinado);
        if (tipo === 'terceros' && fila.roles) set.roles = combinado.roles;
        const cambia = Object.entries(set).some(([ruta, v]) => JSON.stringify(ruta.split('.').reduce((o, p) => o?.[p], ex) ?? null) !== JSON.stringify(v ?? null));
        if (!cambia) { res.sinCambios += 1; continue; }
        res.actualizados += 1;
        if (!simular) {
          const despues = { ...ex, ...combinado };
          const h = huella(tipo === 'terceros' ? variablesTercero(empresa, despues) : variablesVehiculo(empresa, despues));
          if (ex.rndc?.estado === 'enviado' && ex.rndc.hash !== h) set['rndc.estado'] = 'sin_enviar';
          await modelo.updateOne({ empresa: E, _id: ex._id }, { $set: set }, { runValidators: true });
        }
      } catch (e) {
        res.errores.push({ fila: n + 1, errores: errores(e) });
      }
    }
    return res;
  }

  // ── Clientes y tarifas ───────────────────────────────────────────────────
  const clientes = new Map((await Cliente.find({ empresa: E }).lean()).map(c => [normalizar(c.nombre), c]));
  const tarifas = new Map((await Tarifa.find({ empresa: E }).lean()).map(t => [`${t.cliente}|${normalizar(t.destino)}`, t]));
  const clientesNuevos = new Map();
  for (let n = 1; n < todas.length; n++) {
    const crudo = objetoFila(def, idx, todas[n] || []);
    if (!crudo) continue;
    res.total += 1;
    try {
      const fila = structuredClone(crudo);
      const nombreCli = txt(fila._cliente);
      let cli = clientes.get(normalizar(nombreCli)) || clientesNuevos.get(normalizar(nombreCli));
      if (!cli) {
        const dc = clienteSchema.parse({ nombre: nombreCli, tipoId: txt(fila._clienteTipo).toUpperCase() || 'N', nit: soloDigitos(entero(fila._clienteNit)), sedeRemitente: entero(fila._clienteSede) });
        cli = simular ? { _id: `nuevo:${normalizar(nombreCli)}`, ...dc } : await Cliente.create({ ...dc, empresa: E });
        clientesNuevos.set(normalizar(nombreCli), cli);
        res.clientesNuevos = (res.clientesNuevos || 0) + 1;
      }
      for (const k of ['tarifaCliente', 'fleteConductor', 'anticipoHabitual', 'tarifaAuxiliar', 'auxiliarPagado', 'pesoKg']) if (fila[k] !== undefined) fila[k] = num(fila[k]) ?? fila[k];
      if (fila._municipio) { fila.codMunicipio = municipioDe(fila._municipio); if (!fila.codMunicipio) throw new Error(`municipio no reconocido: ${txt(fila._municipio)}`); }
      if (fila.tipoCobro) fila.tipoCobro = normalizar(fila.tipoCobro) === 'UNIDAD' ? 'unidad' : 'viaje';
      if (fila.destinatario) fila.destinatario = { tipoId: txt(fila.destinatario.tipoId).toUpperCase(), numId: doc(fila.destinatario.numId), sede: entero(fila.destinatario.sede) };
      fila.destino = txt(fila.destino);
      const k = `${cli._id}|${normalizar(fila.destino)}`;
      const ex = tarifas.get(k);
      if (!ex) {
        const d = tarifaSchema.parse({ ...fila, cliente: String(cli._id) });
        res.nuevos += 1;
        if (!simular) tarifas.set(k, await Tarifa.create({ ...d, cliente: cli._id, empresa: E }));
        else tarifas.set(k, { ...d, _id: 'simulado' });
        continue;
      }
      const combinado = tarifaSchema.parse({ ...ex, ...fila, cliente: String(cli._id), destinatario: { ...ex.destinatario, ...fila.destinatario } });
      const set = rutasPresentes(fila, combinado);
      const cambia = Object.entries(set).some(([ruta, v]) => JSON.stringify(ruta.split('.').reduce((o, p) => o?.[p], ex) ?? null) !== JSON.stringify(v ?? null));
      if (!cambia) { res.sinCambios += 1; continue; }
      res.actualizados += 1;
      if (!simular) await Tarifa.updateOne({ empresa: E, _id: ex._id }, { $set: set }, { runValidators: true });
    } catch (e) {
      res.errores.push({ fila: n + 1, errores: errores(e) });
    }
  }
  return res;
}

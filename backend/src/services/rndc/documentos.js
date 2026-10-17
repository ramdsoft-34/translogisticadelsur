// Variables de cada proceso del RNDC a partir de los datos de la plataforma.
// Nombres de variables tomados del diccionario de datos oficial (manual v3,
// sección 12) y de los ejemplos de la guía v4. Las variables adicionales que
// configure la empresa (`rndc.extras`) reemplazan o completan las de aquí.
import crypto from 'node:crypto';
import { txt, soloDigitos, fmtFecha, finDeMes, sumarDias } from '../../utils/texto.js';
import { retencionFuente } from '../calculos.js';

const PBV_FOPAT = 10500;

export const nitEmpresa = (empresa) => soloDigitos(empresa.nit) + soloDigitos(empresa.dv);
export const idCliente = (c) => (c.tipoId === 'N' ? soloDigitos(c.nit) + soloDigitos(c.dv) : soloDigitos(c.nit));
const numero = (v) => (v === null || v === undefined || v === '' ? '' : String(Math.round(Number(v) * 100) / 100));
const fecha = (d) => (d ? fmtFecha(d) : '');

// Marcadores que pueden usarse en las variables extras: {NIT} {PLACA} {FECHA}…
function reemplazarMarcadores(valor, ctx) {
  return String(valor ?? '').replace(/\{([A-Z_]+)\}/g, (_, k) => (ctx[k] ?? ''));
}

function aplicarExtras(variables, empresa, proceso, ctx) {
  const lista = [...variables];
  for (const e of empresa.rndc?.extras || []) {
    if (Number(e.proceso) !== proceso || !txt(e.variable)) continue;
    const nombre = txt(e.variable).toUpperCase();
    const valor = reemplazarMarcadores(e.valor, ctx);
    const i = lista.findIndex(([n]) => n === nombre);
    if (i >= 0) lista[i] = [nombre, valor]; else lista.push([nombre, valor]);
  }
  return lista;
}

// ── Tercero (proceso 11) ────────────────────────────────────────────────────
export function variablesTercero(empresa, t) {
  const natural = t.tipoId !== 'N';
  const v = [
    ['NUMNITEMPRESATRANSPORTE', nitEmpresa(empresa)],
    ['CODTIPOIDTERCERO', t.tipoId],
    ['NUMIDTERCERO', soloDigitos(t.numId) || t.numId],
    ['NOMIDTERCERO', t.nombres],
    ['PRIMERAPELLIDOIDTERCERO', natural ? t.apellido1 : ''],
    ['SEGUNDOAPELLIDOIDTERCERO', natural ? t.apellido2 : ''],
    ['CODSEDETERCERO', t.sede?.codigo],
    ['NOMSEDETERCERO', t.sede?.nombre],
    ['NUMTELEFONOCONTACTO', soloDigitos(t.telefono)],
    ['NUMCELULARPERSONA', soloDigitos(t.celular)],
    ['NOMENCLATURADIRECCION', t.direccion],
    ['CODMUNICIPIORNDC', t.codMunicipio],
  ];
  if (t.licencia?.numero) {
    v.push(['CODCATEGORIALICENCIACONDUCCION', t.licencia.categoria],
      ['NUMLICENCIACONDUCCION', t.licencia.numero],
      ['FECHAVENCIMIENTOLICENCIA', fecha(t.licencia.vence)]);
  }
  return aplicarExtras(v, empresa, 11, { NIT: nitEmpresa(empresa) });
}

// ── Vehículo (proceso 12) ───────────────────────────────────────────────────
export function variablesVehiculo(empresa, x) {
  const v = [
    ['NUMNITEMPRESATRANSPORTE', nitEmpresa(empresa)],
    ['NUMPLACA', x.placa],
    ['CODCONFIGURACIONUNIDADCARGA', x.configuracion],
    ['CODMARCAVEHICULOCARGA', x.marca],
    ['CODLINEAVEHICULOCARGA', x.linea],
    ['NUMEJES', numero(x.ejes)],
    ['ANOFABRICACIONVEHICULOCARGA', numero(x.modelo)],
    ['CODCOLORVEHICULOCARGA', x.color],
    ['PESOVEHICULOVACIO', numero(x.pesoVacio)],
    ['CAPACIDADUNIDADCARGA', numero(x.capacidad)],
    ['UNIDADMEDIDACAPACIDAD', x.unidadMedida || '1'],
    ['CODTIPOCARROCERIA', x.carroceria],
    ['CODTIPOCOMBUSTIBLE', x.combustible],
    ['NUMSEGUROSOAT', x.soat?.numero],
    ['FECHAVENCIMIENTOSOAT', fecha(x.soat?.vence)],
    ['NUMNITASEGURADORASOAT', soloDigitos(x.soat?.aseguradoraNit)],
    ['CODTIPOIDPROPIETARIO', x.propietario?.tipoId],
    ['NUMIDPROPIETARIO', x.propietario?.numId],
    ['CODTIPOIDTENEDOR', x.tenedor?.tipoId],
    ['NUMIDTENEDOR', x.tenedor?.numId],
  ];
  return aplicarExtras(v, empresa, 12, { NIT: nitEmpresa(empresa) });
}

// Huella de los datos que se envían (sin el NIT de la empresa).
export function huella(variables) {
  const base = variables.filter(([n, val]) => n !== 'NUMNITEMPRESATRANSPORTE' && txt(val) !== '')
    .map(([n, val]) => `${n}=${txt(val)}`).join('|');
  return crypto.createHash('sha256').update(base).digest('hex');
}

// ── Contexto común de un viaje ──────────────────────────────────────────────
// viaje con cliente, conductor, titular y tarifaRef poblados; vehiculo opcional.
export function contextoViaje(empresa, viaje, vehiculo) {
  const cfg = empresa.rndc || {};
  const cliente = viaje.cliente || {};
  const conductor = viaje.conductor || {};
  const titular = viaje.titular || conductor;
  const dest = viaje.destinatario?.numId ? viaje.destinatario : (viaje.tarifaRef?.destinatario?.numId ? viaje.tarifaRef.destinatario : null);
  const pagoSaldo = cfg.pagoSaldo === 'dias' ? sumarDias(viaje.fecha, Number(cfg.diasPagoSaldo) || 0) : finDeMes(viaje.fecha);
  const pbv = Number(vehiculo?.pbv) || 0;
  return {
    NIT: nitEmpresa(empresa),
    PLACA: viaje.placa,
    REMOLQUE: viaje.remolque || '',
    FECHA: fecha(viaje.fecha),
    FECHA_PAGO: fecha(pagoSaldo),
    CED: soloDigitos(conductor.numId),
    TIPO_CED: conductor.tipoId || 'C',
    TITULAR: soloDigitos(titular.numId) || titular.numId || '',
    TIPO_TITULAR: titular.tipoId || 'C',
    NIT_CLIENTE: idCliente(cliente),
    TIPO_CLIENTE: cliente.tipoId || 'N',
    SEDE_CLIENTE: cliente.sedeRemitente || '',
    DEST_TIPO: dest?.tipoId || cliente.tipoId || 'N',
    DEST_ID: dest?.numId || idCliente(cliente),
    // Sin destinatario propio, el destinatario es el cliente con su sede registrada en el RNDC
    DEST_SEDE: dest ? (dest.sede || '') : (cliente.sedeRemitente || ''),
    COD_ORIGEN: viaje.codOrigen || cfg.codOrigen || '',
    COD_DESTINO: viaje.codDestino || viaje.tarifaRef?.codMunicipio || '',
    PESO: numero(viaje.pesoKg),
    FLETE: numero(viaje.flete),
    ANTICIPO: numero(viaje.anticipo),
    RETEFUENTE: numero(retencionFuente(viaje.flete, cfg.retefuentePct ?? 1)),
    FOPAT: pbv > PBV_FOPAT ? numero(Math.round((Number(viaje.flete) || 0) * 0.001)) : '0',
    OPERACION: viaje.tarifaRef?.operacion || cfg.operacion || 'G',
    OBSERVACIONES: txt(viaje.observaciones).slice(0, 200),
    REMESA: viaje.remesa?.numero || '',
    MANIFIESTO: viaje.manifiesto?.numero || '',
  };
}

// ── Remesa (proceso 3) ──────────────────────────────────────────────────────
export function variablesRemesa(empresa, viaje, ctx, consecutivo) {
  const cfg = empresa.rndc || {};
  const p = cfg.poliza || {};
  const v = [
    ['NUMNITEMPRESATRANSPORTE', ctx.NIT],
    ['CONSECUTIVOREMESA', consecutivo],
    ['CODOPERACIONTRANSPORTE', ctx.OPERACION === 'U' ? 'G' : ctx.OPERACION],
    ['CODNATURALEZACARGA', cfg.naturalezaCarga || '1'],
    ['CANTIDADCARGADA', ctx.PESO],
    ['UNIDADMEDIDACAPACIDAD', cfg.unidadMedida || '1'],
    ['CODTIPOEMPAQUE', cfg.tipoEmpaque || '0'],
    ['MERCANCIAREMESA', cfg.mercancia?.codigo],
    ['DESCRIPCIONCORTAPRODUCTO', cfg.mercancia?.descripcion],
    ['CODTIPOIDREMITENTE', ctx.TIPO_CLIENTE],
    ['NUMIDREMITENTE', ctx.NIT_CLIENTE],
    ['CODSEDEREMITENTE', ctx.SEDE_CLIENTE],
    ['CODTIPOIDDESTINATARIO', ctx.DEST_TIPO],
    ['NUMIDDESTINATARIO', ctx.DEST_ID],
    ['CODSEDEDESTINATARIO', ctx.DEST_SEDE],
    ['CODTIPOIDPROPIETARIO', ctx.TIPO_CLIENTE],
    ['NUMIDPROPIETARIO', ctx.NIT_CLIENTE],
    ['CODSEDEPROPIETARIO', ctx.SEDE_CLIENTE],
    ['DUENOPOLIZA', p.dueno || 'E'],
    ['NUMPOLIZATRANSPORTE', p.numero],
    ['FECHAVENCIMIENTOPOLIZACARGA', fecha(p.vence)],
    ['COMPANIASEGURO', soloDigitos(p.aseguradoraNit)],
    ['HORASPACTOCARGA', numero(cfg.horasPactoCargue ?? 1)],
    ['MINUTOSPACTOCARGA', '0'],
    ['HORASPACTODESCARGUE', numero(cfg.horasPactoDescargue ?? 1)],
    ['MINUTOSPACTODESCARGUE', '0'],
    ['FECHACITAPACTADACARGUE', ctx.FECHA],
    ['HORACITAPACTADACARGUE', cfg.horaCitaCargue || '08:00'],
    ['FECHACITAPACTADADESCARGUE', ctx.FECHA],
    ['HORACITAPACTADADESCARGUEREMESA', cfg.horaCitaDescargue || '18:00'],
  ];
  return aplicarExtras(v, empresa, 3, { ...ctx, REMESA: consecutivo });
}

// ── Manifiesto (proceso 4) ──────────────────────────────────────────────────
export function variablesManifiesto(empresa, viaje, ctx, consecutivo) {
  const cfg = empresa.rndc || {};
  const v = [
    ['NUMNITEMPRESATRANSPORTE', ctx.NIT],
    ['NUMMANIFIESTOCARGA', consecutivo],
    // Reemplazo de manifiesto (manual 8.9.2): número del manifiesto anulado
    ['MANNROMANIFIESTOTRANSBORDO', viaje.manifiestoReemplazado || ''],
    ['CODOPERACIONTRANSPORTE', ctx.OPERACION],
    ['FECHAEXPEDICIONMANIFIESTO', ctx.FECHA],
    ['CODMUNICIPIOORIGENMANIFIESTO', ctx.COD_ORIGEN],
    ['CODMUNICIPIODESTINOMANIFIESTO', ctx.COD_DESTINO],
    ['CODIDTITULARMANIFIESTO', ctx.TIPO_TITULAR],
    ['NUMIDTITULARMANIFIESTO', ctx.TITULAR],
    ['NUMPLACA', ctx.PLACA],
    ['NUMPLACAREMOLQUE', ctx.REMOLQUE],
    ['CODIDCONDUCTOR', ctx.TIPO_CED],
    ['NUMIDCONDUCTOR', ctx.CED],
    ['VALORFLETEPACTADOVIAJE', ctx.FLETE],
    ['RETENCIONFUENTEMANIFIESTO', ctx.RETEFUENTE],
    ['RETENCIONICAMANIFIESTOCARGA', numero(cfg.reteIca ?? 0)],
    ['VALORANTICIPOMANIFIESTO', ctx.ANTICIPO],
    ['CODMUNICIPIOPAGOSALDO', cfg.codMunicipioPagoSaldo],
    ['FECHAPAGOSALDOMANIFIESTO', ctx.FECHA_PAGO],
    ['CODRESPONSABLEPAGOCARGUE', cfg.responsablePagoCargue || 'E'],
    ['CODRESPONSABLEPAGODESCARGUE', cfg.responsablePagoDescargue || 'E'],
    ['ACEPTACIONELECTRONICA', cfg.aceptacionElectronica ? 'SI' : 'NO'],
    ['NITMONITOREOFLOTA', cfg.nitMonitoreoFlota],
    ['OBSERVACIONES', ctx.OBSERVACIONES],
  ];
  if (cfg.aplicarFopat) v.push(['RETENCIONFOPAT', ctx.FOPAT]);
  return aplicarExtras(v, empresa, 4, { ...ctx, MANIFIESTO: consecutivo });
}

// ── Cumplido de remesa (proceso 5) ──────────────────────────────────────────
// datos: { tipo: C|S, motivoSuspension, cantidadEntregada, llegada, entrada, salida (fecha+hora), observaciones }
export function variablesCumplidoRemesa(empresa, viaje, datos) {
  const fh = (o) => [fecha(o?.fecha), txt(o?.hora)];
  const [fl, hl] = fh(datos.llegada); const [fe, he] = fh(datos.entrada); const [fs, hs] = fh(datos.salida);
  const v = [
    ['NUMNITEMPRESATRANSPORTE', nitEmpresa(empresa)],
    ['CONSECUTIVOREMESA', viaje.remesa.numero],
    ['NUMMANIFIESTOCARGA', viaje.manifiesto.numero],
    ['TIPOCUMPLIDOREMESA', datos.tipo || 'C'],
    ['MOTIVOSUSPENSIONREMESA', datos.tipo === 'S' ? datos.motivoSuspension : ''],
    ['CANTIDADCARGADA', numero(datos.cantidadCargada ?? viaje.pesoKg)],
    ['CANTIDADENTREGADA', numero(datos.cantidadEntregada ?? viaje.pesoKg)],
    ['UNIDADMEDIDACAPACIDAD', empresa.rndc?.unidadMedida || '1'],
    ['FECHALLEGADADESCARGUE', fl], ['HORALLEGADADESCARGUECUMPLIDO', hl],
    ['FECHAENTRADADESCARGUE', fe], ['HORAENTRADADESCARGUECUMPLIDO', he],
    ['FECHASALIDADESCARGUE', fs], ['HORASALIDADESCARGUECUMPLIDO', hs],
    ['OBSERVACIONES', txt(datos.observaciones).slice(0, 200)],
  ];
  return aplicarExtras(v, empresa, 5, { NIT: nitEmpresa(empresa) });
}

// ── Cumplido de manifiesto (proceso 6) ──────────────────────────────────────
export function variablesCumplidoManifiesto(empresa, viaje, datos) {
  const v = [
    ['NUMNITEMPRESATRANSPORTE', nitEmpresa(empresa)],
    ['NUMMANIFIESTOCARGA', viaje.manifiesto.numero],
    ['TIPOCUMPLIDOMANIFIESTO', datos.tipo || 'C'],
    ['MOTIVOSUSPENSIONMANIFIESTO', datos.tipo === 'S' ? datos.motivoSuspension : ''],
    ['FECHAENTREGADOCUMENTOS', fecha(datos.fechaEntregaDocumentos)],
    ['VALORADICIONALHORASCARGUE', numero(datos.adicionalCargue || '')],
    ['VALORADICIONALHORASDESCARGUE', numero(datos.adicionalDescargue || '')],
    ['VALORADICIONALFLETE', numero(datos.adicionalFlete || '')],
    ['MOTIVOVALORADICIONAL', datos.adicionalFlete ? datos.motivoAdicional : ''],
    ['VALORDESCUENTOFLETE', numero(datos.descuento || '')],
    ['MOTIVOVALORDESCUENTOMANIFIESTO', datos.descuento ? datos.motivoDescuento : ''],
    ['VALORSOBREANTICIPO', numero(datos.sobreanticipo || '')],
    ['OBSERVACIONES', txt(datos.observaciones).slice(0, 200)],
  ];
  return aplicarExtras(v, empresa, 6, { NIT: nitEmpresa(empresa) });
}

// ── Anulaciones ─────────────────────────────────────────────────────────────
export function variablesAnulacion(empresa, viaje, documento, datos) {
  const nit = nitEmpresa(empresa);
  const obs = txt(datos.observaciones).slice(0, 200) || 'SIN OBSERVACIONES';
  switch (documento) {
    case 'remesa': return { proceso: 9, variables: [
      ['NUMNITEMPRESATRANSPORTE', nit], ['CONSECUTIVOREMESA', viaje.remesa.numero],
      ['MOTIVOREVERSAREMESA', 'A'], ['MOTIVOANULACIONREMESA', datos.motivo], ['OBSERVACIONES', obs]] };
    case 'manifiesto': return { proceso: 32, variables: [
      ['NUMNITEMPRESATRANSPORTE', nit], ['NUMMANIFIESTOCARGA', viaje.manifiesto.numero],
      ['MOTIVOANULACIONMANIFIESTO', datos.motivo], ['NUMMANIFIESTOCARGANUEVO', datos.manifiestoNuevo || ''],
      ['OBSERVACIONES', obs]] };
    case 'cumplidoRemesa': return { proceso: 28, variables: [
      ['NUMNITEMPRESATRANSPORTE', nit], ['CONSECUTIVOREMESA', viaje.remesa.numero],
      ['CODMOTIVOANULACIONCUMPLIDO', datos.motivo], ['OBSERVACIONES', obs]] };
    case 'cumplidoManifiesto': return { proceso: 29, variables: [
      ['NUMNITEMPRESATRANSPORTE', nit], ['NUMMANIFIESTOCARGA', viaje.manifiesto.numero],
      ['CODMOTIVOANULACIONCUMPLIDO', datos.motivo], ['OBSERVACIONES', obs]] };
    default: return null;
  }
}

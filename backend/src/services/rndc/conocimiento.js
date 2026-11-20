// Rechazos del RNDC que la plataforma ya conoce: qué significan, qué hacer y, cuando la corrección es segura
// y siempre la misma, el cambio exacto que se puede aplicar con un clic.
// Las reglas van primero; la IA solo se consulta para lo que no está aquí ni en el historial de la empresa.
import { mismoMunicipio } from './documentos.js';

// Códigos de error que trae un mensaje del RNDC (MAN092, REM019, CUM101…)
export const codigosDe = (mensaje) => [...new Set((String(mensaje || '').toUpperCase().match(/\b(MAN|REM|CUM|TER|VEH|INF|ANU)\d{3}\b/g)) || [])];

const valor = (vars, nombre) => (vars || []).find(([n]) => n === nombre)?.[1] ?? '';

// Correcciones que se pueden aplicar desde la revisión, y en qué campo del viaje quedan
export const APLICABLES = Object.freeze({
  manifiesto: ['CODOPERACIONTRANSPORTE', 'CODMUNICIPIODESTINOMANIFIESTO'],
  remesa: ['CODSEDEDESTINATARIO', 'CODSEDEREMITENTE', 'CODSEDEPROPIETARIO'],
});
export const esAplicable = (documento, variable) => !!APLICABLES[documento]?.includes(variable);

// `que`: explicación sencilla y qué hacer. `correccion(previa)`: cambio exacto, solo si es seguro.
export const CONOCIDOS = [
  { id: 'MAN153', patron: /MAN153|municipios de Origen y Destino diferentes/i, titulo: 'Tipo «General» con origen y destino en el mismo municipio',
    que: 'Con el tipo «General» el origen y el destino deben ser municipios distintos. Si todo el viaje es dentro del municipio, el tipo correcto es «Viaje municipal o urbano» (U); si va y vuelve, «Viaje de ida y regreso».',
    correccion: (p) => {
      const m = p.manifiesto.variables;
      return mismoMunicipio(valor(m, 'CODMUNICIPIOORIGENMANIFIESTO'), valor(m, 'CODMUNICIPIODESTINOMANIFIESTO')) && valor(m, 'CODOPERACIONTRANSPORTE') !== 'U'
        ? { documento: 'manifiesto', variable: 'CODOPERACIONTRANSPORTE', valor: 'U', texto: 'Cambiar el tipo de manifiesto a «Viaje municipal o urbano» (U)' } : null;
    } },
  { id: 'MAN092', patron: /MAN092/i, titulo: 'Viaje municipal o urbano entre municipios distintos',
    que: 'El manifiesto va como «Viaje municipal o urbano» (U), pero el origen y el destino son municipios distintos, y el RNDC no lo acepta. Debe ir como «General». Para que no se repita, en Clientes y tarifas cambie la operación de ese destino de «U» a «G».',
    correccion: (p) => {
      const m = p.manifiesto.variables;
      return valor(m, 'CODOPERACIONTRANSPORTE') === 'U' && !mismoMunicipio(valor(m, 'CODMUNICIPIOORIGENMANIFIESTO'), valor(m, 'CODMUNICIPIODESTINOMANIFIESTO'))
        ? { documento: 'manifiesto', variable: 'CODOPERACIONTRANSPORTE', valor: 'G', texto: 'Cambiar el tipo de manifiesto a «General» (G)' } : null;
    } },
  { id: 'MAN078', patron: /MAN078|omisiones en (el registro|la matr)/i, titulo: 'Placa con omisiones en la matrícula',
    que: 'La placa tiene omisiones en su matrícula inicial ante el Ministerio y el RNDC no le deja expedir manifiestos hasta que el propietario lo aclare con Reposición Vehicular del Ministerio de Transporte. Mientras tanto, cambie el vehículo del viaje (la remesa aceptada se conserva) o anule la remesa si el viaje no se hará.' },
  // Falla del servidor del RNDC (Access violation, respuesta vacía, «PasoN Expidiendo»): no es un error de los datos
  { id: 'FALLA_RNDC', patron: /Paso\d+ Expidiendo|Access violation|SOAP-ENV:Fault|faultstring|Respuesta vac[ií]a del RNDC|no respondi[oó]|tiempo de espera|ETIMEDOUT|ECONNRESET|socket hang up/i,
    titulo: 'Falla interna del RNDC',
    que: 'Es una falla del servidor del RNDC, no un error de sus datos. Presione «Corregir y reenviar»: antes se verifica en el RNDC que no haya quedado registrado, así no se duplica.' },
  { id: 'MAN130', patron: /MAN130|titular no existe/i, titulo: 'Titular no registrado en el RNDC',
    que: 'El titular del manifiesto no está registrado en el RNDC. Regístrelo («Registrar de nuevo» junto al titular) o cambie el titular del viaje.' },
  { id: 'CONDUCTOR', patron: /conductor.*no existe|MAN12\d/i, titulo: 'Conductor no registrado en el RNDC',
    que: 'El conductor no está registrado en el RNDC. Regístrelo («Registrar de nuevo» junto al conductor) o elija otro conductor.' },
  { id: 'MAN353', patron: /MAN353|municipio origen/i, titulo: 'Origen distinto al municipio de la remesa',
    que: 'El origen del manifiesto debe ser el municipio de la sede del remitente de la remesa. La plataforma ya lo toma así: vuelva a enviar.' },
  { id: 'MAN275', patron: /MAN275|FOPAT/i, titulo: 'Falta la retención FOPAT',
    que: 'El RNDC exige la retención FOPAT (0,1 % del flete) para este vehículo. La plataforma ya la calcula: vuelva a enviar.' },
  { id: 'MAN270', patron: /MAN270|anticipo supera/i, titulo: 'Anticipo mayor que el neto',
    que: 'El anticipo no puede superar el neto a pagar (flete menos retenciones). La plataforma lo ajusta al neto: vuelva a enviar.' },
  { id: 'CANTIDAD', patron: /REM060|REM380|REM382|cantidad/i, titulo: 'Falta la cantidad cargada',
    que: 'Falta el peso de la carga. Escriba los kilos en «Carga (remesa)» y vuelva a enviar.' },
  { id: 'MAN354', patron: /MAN354|municipio destino/i, titulo: 'Destino distinto al de la sede del destinatario',
    que: 'El destino del manifiesto debe ser el municipio que el RNDC tiene para la sede del destinatario. Actualice la sede del destinatario desde el RNDC (en Expedir) y vuelva a enviar.' },
  { id: 'DUPLICADO', patron: /DUPLICADO|REM030|ya fu[eé] radicado/i, titulo: 'Número ya radicado',
    que: 'Ese número ya está radicado en el RNDC. Escriba en «Números en el RNDC» uno que no se haya usado y vuelva a enviar.' },
  { id: 'REM019', patron: /REM019|cargue y la direccion del punto de descargue/i, titulo: 'Destinatario igual al remitente',
    que: 'El destinatario no puede ser el mismo remitente en la misma sede. Elija en «Carga» la sede del cliente en el destino o quién recibe.' },
  { id: 'DESTINATARIO', patron: /REM180|REM200|destinatario/i, titulo: 'Destinatario o sede inexistente',
    que: 'El destinatario o su sede no existen en el RNDC. Elija en «Carga» el destinatario y la sede correctos, o tráigalos del RNDC.' },
  { id: 'VEHICULO', patron: /placa|veh[ií]culo.*no existe/i, titulo: 'Vehículo no registrado en el RNDC',
    que: 'El vehículo no está registrado en el RNDC. Regístrelo («Registrar de nuevo» junto al vehículo) y vuelva a enviar.' },
  { id: 'CLAVE', patron: /contrase|clave|password|autentic|usuario (no |inv|o |y )/i, titulo: 'Contraseña del RNDC',
    que: 'La contraseña del RNDC no es correcta. Vuelva a enviar y escríbala de nuevo.' },
];

// Mensaje del RNDC en palabras: de un error SOAP (XML) queda solo el texto de la falla
export function mensajeClaro(mensaje) {
  const m = String(mensaje || '');
  const falla = /<faultstring>([\s\S]*?)<\/faultstring>/i.exec(m)?.[1];
  if (falla) return `Falla del servidor del RNDC: ${falla.trim()}`.slice(0, 300);
  return m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}

export const conocido = (mensaje) => CONOCIDOS.find((c) => c.patron.test(String(mensaje || ''))) || null;

// Lista corta para orientar a la IA (código: significado)
export const resumenConocidos = () => CONOCIDOS.map((c) => `${c.id}: ${c.titulo}`).join('\n');

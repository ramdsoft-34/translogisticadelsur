// Catálogos oficiales del RNDC usados por la plataforma.
// Fuentes: "Guía uso del Web Service en el RNDC" v4 (22/06/2023) y
// "Manual RNDC Web-Service" v3.0 (2020-06-01), Ministerio de Transporte.

// Endpoints oficiales (SOAP rpc/encoded, método AtenderMensajeRNDC).
export const ENDPOINTS = {
  PRODUCCION: [
    'http://rndcws.mintransporte.gov.co:8080/soap/IBPMServices',
    'http://rndcws2.mintransporte.gov.co:8080/soap/IBPMServices', // contingencia
  ],
  PRUEBAS: ['http://plc.mintransporte.gov.co:8080/soap/IBPMServices'], // copia de producción (manual 7.2)
};

export const SOAP_ACTION = '"urn:BPMServicesIntf-IBPMServices#AtenderMensajeRNDC"';
export const SOAP_NS = 'urn:BPMServicesIntf-IBPMServices';

// solicitud/tipo
export const TIPOS = { REGISTRAR: 1, CONSULTAR_MAESTRO: 2, CONSULTAR: 3 };

// solicitud/procesoid
export const PROCESOS = {
  1: 'Información de carga',
  2: 'Información de viaje',
  3: 'Remesa terrestre de carga',
  4: 'Manifiesto de carga',
  5: 'Cumplido de remesa',
  6: 'Cumplido de manifiesto',
  7: 'Anular información de carga',
  8: 'Anular información de viaje',
  9: 'Anular remesa',
  11: 'Tercero',
  12: 'Vehículo',
  28: 'Anular cumplido de remesa',
  29: 'Anular cumplido de manifiesto',
  32: 'Anular manifiesto',
  43: 'Remesas del manifiesto',
  45: 'Cumplido inicial de remesa',
  54: 'Anular cumplido inicial de remesa',
};

export const TIPOS_ID = {
  C: 'Cédula de ciudadanía', N: 'NIT', P: 'Pasaporte', E: 'Cédula de extranjería', T: 'Tarjeta de identidad', U: 'NUIP',
};
// Solo pueden ser conductores: cédula de ciudadanía, cédula de extranjería o NUIP (manual 8.1).
export const TIPOS_ID_CONDUCTOR = ['C', 'E', 'U'];

export const NATURALEZA_CARGA = {
  1: 'Carga normal', 2: 'Carga peligrosa', 3: 'Carga extradimensionada', 4: 'Carga extrapesada',
  5: 'Desechos peligrosos', 6: 'Semovientes', 7: 'Refrigerada',
};

export const TIPO_CUMPLIDO_REMESA = { C: 'Cumplido normal', S: 'Suspensión' };
export const MOTIVO_SUSPENSION_REMESA = { A: 'Accidente', V: 'Varada', S: 'Siniestro', D: 'Cambio de destino', O: 'Otros' };
export const TIPO_CUMPLIDO_MANIFIESTO = { C: 'Cumplido normal', S: 'Suspensión' };

export const MOTIVO_ANULACION_REMESA = { D: 'Error de digitación', S: 'Cancelación del servicio' };
export const MOTIVO_ANULACION_MANIFIESTO = {
  D: 'Error de digitación', S: 'Cancelación del servicio', R: 'Cambio en las remesas', T: 'Cambio de tarifa o valores',
  G: 'Cambio de destino por el generador', C: 'Cambio de conductor', V: 'Cambio de vehículo',
};
// Motivos que el RNDC acepta como "reemplazo de manifiesto" (no cuentan en el tope del 6 % mensual).
export const MOTIVOS_REEMPLAZO = ['R', 'T', 'G', 'C', 'V'];
export const MOTIVO_ANULACION_CUMPLIDO = { D: 'Error de digitación', O: 'Otros' };

export const RESPONSABLE_PAGO = { E: 'Empresa de transporte', R: 'Remitente', D: 'Destinatario' };

// Configuración leída de variables de entorno, validada al arrancar.
import 'dotenv/config';

const entero = (v, def) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? def : Math.max(0, Number(v)));
const bool = (v, def = false) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  // En producción se escucha solo en 127.0.0.1: el acceso público entra por nginx (HTTPS).
  host: process.env.HOST || '0.0.0.0',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/translogisticadelsur',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:4200').split(',').map(s => s.trim()).filter(Boolean),
  // Puerta de integración del servidor de Cooespatrans (Sur Track); vacío = sin rastreo
  surTrack: {
    url: process.env.COOESPATRANS_INTEGRACION_URL || '',
    clave: process.env.COOESPATRANS_INTEGRACION_CLAVE || '',
    timeoutMs: Number(process.env.COOESPATRANS_INTEGRACION_TIMEOUT_MS) || 10000,
  },
  rndc: {
    simuladorUrl: process.env.RNDC_SIMULADOR_URL || 'http://127.0.0.1:4010/soap/IBPMServices',
    permitirProduccion: bool(process.env.RNDC_PERMITIR_PRODUCCION, false),
    permitirPruebas: bool(process.env.RNDC_PERMITIR_PRUEBAS, true),
    timeoutMs: Number(process.env.RNDC_TIMEOUT_MS) || 90000,
    // Protección del web service: peticiones simultáneas y pausa mínima entre peticiones (ms)
    maxConcurrentes: Math.max(1, Number(process.env.RNDC_MAX_CONCURRENTES) || 1),
    pausaMs: entero(process.env.RNDC_PAUSA_MS, 1000),
    // Pausa adicional entre placas en la actualización masiva de vehículos (ms)
    pausaMasivaMs: entero(process.env.RNDC_PAUSA_MASIVA_MS, 1500),
  },
};

export function validarEnv() {
  if (!env.jwtSecret || env.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres (ver .env.example)');
  }
}

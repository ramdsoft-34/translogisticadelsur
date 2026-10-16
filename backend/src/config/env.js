// Configuración leída de variables de entorno, validada al arrancar.
import 'dotenv/config';

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
  rndc: {
    simuladorUrl: process.env.RNDC_SIMULADOR_URL || 'http://127.0.0.1:4010/soap/IBPMServices',
    permitirProduccion: bool(process.env.RNDC_PERMITIR_PRODUCCION, false),
    permitirPruebas: bool(process.env.RNDC_PERMITIR_PRUEBAS, true),
    timeoutMs: Number(process.env.RNDC_TIMEOUT_MS) || 90000,
  },
};

export function validarEnv() {
  if (!env.jwtSecret || env.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres (ver .env.example)');
  }
}

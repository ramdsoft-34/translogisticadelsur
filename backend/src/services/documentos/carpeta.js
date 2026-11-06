// Carpeta privada de archivos de las empresas (fuera del código). En producción: ARCHIVO_DIR del .env.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_POR_DEFECTO = process.env.NODE_ENV === 'test'
  ? path.join(os.tmpdir(), `translogistica-archivo-${process.pid}`)
  : fileURLToPath(new URL('../../../archivo', import.meta.url));

export const carpetaBase = () => path.resolve(process.env.ARCHIVO_DIR || BASE_POR_DEFECTO);

// Crea el SuperAdmin inicial si no existe ninguno.
// Uso: definir SEED_SUPERADMIN_EMAIL y SEED_SUPERADMIN_PASSWORD en .env y ejecutar `npm run seed`.
import bcrypt from 'bcryptjs';
import { conectar, desconectar } from '../src/db.js';
import { Usuario } from '../src/models/index.js';

const email = (process.env.SEED_SUPERADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.SEED_SUPERADMIN_PASSWORD || '';
const nombre = process.env.SEED_SUPERADMIN_NOMBRE || 'Super Administrador';

await conectar();
try {
  if (await Usuario.exists({ rol: 'superadmin' })) {
    console.log('Ya existe un SuperAdmin; no se crea otro.');
  } else {
    if (!email || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new Error('Defina SEED_SUPERADMIN_EMAIL y SEED_SUPERADMIN_PASSWORD (mínimo 8 caracteres con letras y números)');
    }
    await Usuario.create({ nombre, email, rol: 'superadmin', empresa: null, passwordHash: await bcrypt.hash(password, 12), debeCambiarClave: true });
    console.log(`SuperAdmin creado: ${email}. Deberá cambiar la contraseña al ingresar.`);
  }
} finally {
  await desconectar();
}

// Manifiestos al WhatsApp del cliente: textos de la plantilla y números activos (sin base de datos ni red)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cualManifiesto, manifiestoConPlaca, numerosActivos } from '../src/services/whatsappBusiness.js';
import { explicacionDe } from '../src/services/erroresWhatsapp.js';

test('texto de cada mensaje: cuál manifiesto de la tanda y su placa', () => {
  assert.equal(cualManifiesto(1, 1), 'el manifiesto de carga');
  assert.equal(cualManifiesto(2, 5), 'el manifiesto de carga 2 de 5');
  assert.equal(manifiestoConPlaca({ numero: 'M10063404', placa: 'SET146' }), 'M10063404 (SET146)');
  assert.equal(manifiestoConPlaca({ numero: 'M1', placa: '' }), 'M1');
});

test('números del cliente: solo los activos, válidos y sin repetir', () => {
  const c = { whatsappManifiestos: [
    { nombre: 'Despachos', numero: '3009998877' }, { nombre: 'Repetido', numero: '573009998877' },
    { nombre: 'Apagado', numero: '3105556677', activo: false }, { nombre: 'Malo', numero: '12345' }, { nombre: 'Otro', numero: '3201112233', activo: true },
  ] };
  assert.deepEqual(numerosActivos(c), [{ nombre: 'Despachos', telefono: '573009998877' }, { nombre: 'Otro', telefono: '573201112233' }]);
  assert.deepEqual(numerosActivos(null), []);
});

test('explicación del error según a quién iba: al cliente nunca propone corregir al conductor', () => {
  assert.ok(explicacionDe('no_entregado', 'conductor').acciones.includes('celular'));
  const cli = explicacionDe('no_entregado', 'cliente');
  assert.ok(cli.acciones.includes('cliente') && !cli.acciones.includes('celular'));
  assert.ok(explicacionDe('limite', 'cliente').acciones.includes('reintentar'), 'las causas comunes se conservan');
  assert.ok(explicacionDe('numero_inactivo', 'cliente').acciones.includes('cliente'));
});

test('al traer un tercero del RNDC no se pierden el celular ni los datos de contacto', async () => {
  const { conservarContacto } = await import('../src/services/rndc/operaciones.js');
  const previo = { celular: '3145550000', telefono: '7234567', direccion: 'CRA 1', codMunicipio: '52001000', sede: { nombre: 'PRINCIPAL' } };
  // El RNDC viene sin celular ni contacto: se conserva todo
  assert.deepEqual(conservarContacto({ celular: '', telefono: '', direccion: '', codMunicipio: '', sede: { codigo: '0', nombre: '' } }, previo),
    { celular: '3145550000', telefono: '7234567', direccion: 'CRA 1', codMunicipio: '52001000', sede: { codigo: '0', nombre: 'PRINCIPAL' } });
  // El RNDC trae otro celular: manda el de la plataforma (válido); los demás datos con valor sí se actualizan
  assert.deepEqual(conservarContacto({ celular: '3001112233', telefono: '7000000', direccion: 'CLL 2', codMunicipio: '52356000', sede: { nombre: 'X' } }, previo),
    { celular: '3145550000', telefono: '7000000', direccion: 'CLL 2', codMunicipio: '52356000', sede: { nombre: 'X' } });
  // Sin celular (o inválido) en la plataforma: el del RNDC lo completa
  assert.equal(conservarContacto({ celular: '3001112233' }, { celular: '' }).celular, '3001112233');
  assert.equal(conservarContacto({ celular: '3001112233' }, { celular: '12345' }).celular, '3001112233');
  assert.equal(conservarContacto({ celular: '' }, { celular: '12345' }).celular, '12345', 'tampoco borra uno inválido con un vacío');
  // El RNDC responde «0» cuando no tiene celular: nunca reemplaza un número (caso real de producción)
  assert.equal(conservarContacto({ celular: '0', telefono: '0' }, { celular: '3182512147', telefono: '7234567' }).celular, '3182512147');
  assert.equal(conservarContacto({ celular: '0', telefono: '0' }, { celular: '3182512147', telefono: '7234567' }).telefono, '7234567');
  assert.equal(conservarContacto({ celular: '0' }, {}).celular, '', 'un tercero nuevo queda sin celular, no con «0»');
  assert.equal(conservarContacto({ celular: '0' }, { celular: '0' }).celular, '0', 'lo que ya había no se toca');
});

test('errores de correo: temporales se reintentan y se explican en español', async () => {
  const { esTemporal, errorCorreoClaro, proximoReintento } = await import('../src/services/erroresCorreo.js');
  const ocupado = { code: 'EPROTOCOL', message: 'Invalid greeting. response=421 4.4.5 Server busy, try again later.', responseCode: 421 };
  assert.equal(esTemporal(ocupado), true);
  assert.equal(esTemporal({ code: 'ETIMEDOUT', message: 'Connection timeout' }), true);
  assert.equal(esTemporal({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }), false);
  assert.equal(esTemporal({ responseCode: 550, message: '550 5.1.1 The email account that you tried to reach does not exist' }), false);
  assert.equal(esTemporal({ responseCode: 550, message: '550 5.4.5 Daily user sending limit exceeded' }), false, 'el límite diario no se arregla en minutos');
  assert.match(errorCorreoClaro('EPROTOCOL: Invalid greeting. response=421 4.4.5 Server busy, try again later.'), /^El servidor de correo \(Gmail\) estaba ocupado.*detalle: EPROTOCOL/);
  assert.match(errorCorreoClaro('EAUTH: Invalid login: 535-5.7.8 Username and Password not accepted'), /contraseña de la cuenta de correo/);
  assert.match(errorCorreoClaro('550 5.1.1 The email account that you tried to reach does not exist'), /dirección de destino no existe/);
  assert.equal(errorCorreoClaro('La cuenta de correo de la empresa no está configurada'), 'La cuenta de correo de la empresa no está configurada', 'lo ya claro no cambia');
  const t0 = Date.UTC(2026, 10, 25, 21, 0);
  assert.deepEqual([1, 2, 3].map((n) => (proximoReintento(n, t0) - t0) / 60000), [2, 5, 15]);
  assert.equal(proximoReintento(4, t0), null);
});

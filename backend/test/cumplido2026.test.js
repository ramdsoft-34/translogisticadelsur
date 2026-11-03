// Fase 7: cumplido de remesa y manifiesto con la guía del Ministerio de junio de 2026 y la guía de tiempos logísticos V2.
// Reglas puras: no necesitan base de datos ni RNDC.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../src/services/rndc/tiemposCumplido.js');
const D = await import('../src/services/rndc/documentos.js');
const { validarVariables } = await import('../src/services/rndc/xml.js');

const empresa = { nit: '900109959', dv: '2', rndc: { horaCitaCargue: '08:00', horaCitaDescargue: '18:00', horasPactoCargue: 1, horasPactoDescargue: 1, aplicarFopat: true, unidadMedida: '1' } };
const dia = new Date(Date.UTC(2026, 9, 10));
const viaje = (tarifa = {}) => ({ fecha: dia, pesoKg: 1360, flete: 550000, remesa: { numero: 'R10062847' }, manifiesto: { numero: 'M10062847' }, tarifaRef: tarifa });
const mapa = (vars) => Object.fromEntries(vars.filter(([, v]) => v !== '' && v !== undefined && v !== null));

test('Propuesta: citas del destino, tiempo de viaje de la ruta y espera en el descargue', () => {
  const p = T.proponerTiempos({ viaje: viaje(), parametros: T.parametrosTiempo(empresa, { horaCitaCargue: '12:00', horaCitaDescargue: '20:00', minutosViaje: 150, kmRuta: 95 }) });
  assert.deepEqual([p.entradaCargue.hora, p.salidaCargue.hora, p.llegada.hora, p.entrada.hora, p.salida.hora], ['12:00', '13:00', '15:30', '20:00', '21:00'],
    'llega antes de la cita: entra a la cita');
  assert.equal(p.fuente.descargue, 'tiempo de viaje de la tarifa');
  assert.equal(p.fechaLimiteManifiesto.fecha, '2026-10-16', '5 días hábiles desde el sábado 10');
  const sinRuta = T.proponerTiempos({ viaje: viaje(), parametros: T.parametrosTiempo(empresa, {}) });
  assert.deepEqual([sinRuta.entradaCargue.hora, sinRuta.entrada.hora], ['08:00', '18:15'], 'sin tiempo de ruta: la cita de descargue de la empresa');
  const noche = T.proponerTiempos({ viaje: viaje(), parametros: T.parametrosTiempo(empresa, { horaCitaCargue: '20:00', horaCitaDescargue: '06:00' }) });
  assert.equal(noche.entrada.fecha, '2026-10-11', 'cita de descargue más temprano que la de cargue: al día siguiente');
});

test('Propuesta con GPS de Sur Track y mercancía consolidada con distribución en varios puntos', () => {
  const p = T.proponerTiempos({ viaje: viaje(), parametros: T.parametrosTiempo(empresa, { tipoOperacionRemesa: 'P', tipoConsolidacion: 'D', horaCitaCargue: '12:00' }),
    gps: { inicio: new Date('2026-10-10T18:00:00-05:00'), primeraEntrega: new Date('2026-10-10T20:40:00-05:00'), ultimaEntrega: new Date('2026-10-10T23:10:00-05:00') } });
  assert.equal(p.variosPuntos, true); assert.equal(p.descargueMonitoreado, true, 'consolidada en varios puntos: solo las entradas');
  assert.deepEqual([p.salidaCargue.hora, p.entrada.hora, p.salida.hora], ['18:00', '20:40', '23:10']);
  const puntos = [[1.17, -77.29, 0, Date.parse('2026-10-10T18:05:00-05:00')], [0.97, -77.72, 30, Date.parse('2026-10-10T20:20:00-05:00')]];
  assert.equal(T.llegadaPorGps(puntos, { lat: 0.971, lng: -77.721 }).getTime(), puntos[1][3], 'llegada: primer punto a menos de 1 km del destino');
  assert.equal(T.llegadaPorGps(puntos, { lat: 1.8, lng: -78.8 }), null);
});

test('Validación como el RNDC: orden, futuro y velocidad máxima de 90 km/h', () => {
  const h = (hora, fecha = '2026-10-10') => ({ fecha, hora });
  assert.deepEqual(T.validarTiempos({ entradaCargue: h('12:00'), entrada: h('15:00') }, { km: 95 }).bloqueantes, []);
  assert.match(T.validarTiempos({ entradaCargue: h('12:00'), entrada: h('13:30') }, { km: 290 }).bloqueantes[0], /193 km\/h/, 'Pasto–Tumaco en hora y media no');
  assert.match(T.validarTiempos({ entradaCargue: h('12:00'), llegada: h('20:30'), entrada: h('20:00'), salida: h('21:00') }, { descargueMonitoreado: false }).bloqueantes[0], /antes de la llegada/);
  assert.match(T.validarTiempos({ entradaCargue: h('12:00'), entrada: h('10:00', '2099-01-01') }).bloqueantes.join(), /futuro/);
  assert.deepEqual(T.validarTiempos({ entradaCargue: h('12:00'), entrada: h('10:00', '2099-01-01') }, { revisarFuturo: false }).bloqueantes, []);
  assert.match(T.validarTiempos({}).bloqueantes[0], /entrada al descargue/);
});

test('Cumplido de la remesa (proceso 5): solo entradas si se monitoreó; llegada y salida si no', () => {
  const datos = { tipo: 'C', cantidadEntregada: 1360, entradaCargue: { fecha: dia, hora: '12:00' }, llegada: { fecha: dia, hora: '20:15' },
    entrada: { fecha: dia, hora: '20:20' }, salida: { fecha: dia, hora: '21:20' } };
  const mon = mapa(D.variablesCumplidoRemesa(empresa, viaje(), { ...datos, cargueMonitoreado: true, descargueMonitoreado: true }));
  assert.equal(mon.FECHAENTRADACARGUE, '10/10/2026'); assert.equal(mon.HORAENTRADACARGUEREMESA, '12:00');
  assert.equal(mon.HORAENTRADADESCARGUECUMPLIDO, '20:20');
  assert.equal(mon.FECHALLEGADADESCARGUE, undefined); assert.equal(mon.HORASALIDADESCARGUECUMPLIDO, undefined);
  const sinMon = mapa(D.variablesCumplidoRemesa(empresa, viaje(), { ...datos, cargueMonitoreado: true, descargueMonitoreado: false }));
  assert.deepEqual([sinMon.HORALLEGADADESCARGUECUMPLIDO, sinMon.HORAENTRADADESCARGUECUMPLIDO, sinMon.HORASALIDADESCARGUECUMPLIDO], ['20:15', '20:20', '21:20'],
    'sede de descargue sin coordenadas: la empresa reporta los tiempos (guía de tiempos, numeral 11)');
  assert.deepEqual(validarVariables(5, D.variablesCumplidoRemesa(empresa, viaje(), { ...datos, cargueMonitoreado: true, descargueMonitoreado: true })), []);
  const viejo = mapa(D.variablesCumplidoRemesa(empresa, viaje({ horaCitaCargue: '12:00' }), { llegada: datos.llegada, entrada: datos.entrada, salida: datos.salida }));
  assert.equal(viejo.HORAENTRADACARGUEREMESA, '12:00', 'formulario anterior: entrada al cargue = cita del destino');
  assert.equal(viejo.HORALLEGADADESCARGUECUMPLIDO, '20:15');
});

test('Cumplido del manifiesto (proceso 6): FOPAT solo si el vehículo lo lleva, sobre el nuevo valor a pagar', () => {
  const datos = { tipo: 'C', fechaEntregaDocumentos: dia, adicionalDescargue: 50000, descuento: 0 };
  assert.equal(mapa(D.variablesCumplidoManifiesto(empresa, viaje(), datos, { fopatAplica: false })).RETENCIONFOPAT, undefined, 'VEJ866 de 2 ejes: sin FOPAT');
  assert.equal(mapa(D.variablesCumplidoManifiesto(empresa, viaje(), datos, { fopatAplica: true })).RETENCIONFOPAT, '600', '0,1 % de 600.000');
  assert.deepEqual(validarVariables(6, D.variablesCumplidoManifiesto(empresa, viaje(), datos, { fopatAplica: true })), []);
});

test('Remesa (proceso 3): tipo de operación, consolidación, empaque, citas y tiempos pactados del destino', () => {
  const ctx = { NIT: '9001099592', FECHA: '10/10/2026', OPERACION: 'G', PESO: '1360' };
  const g = mapa(D.variablesRemesa(empresa, viaje(), ctx, 'R1'));
  assert.deepEqual([g.CODOPERACIONTRANSPORTE, g.HORACITAPACTADACARGUE, g.HORASPACTOCARGA, g.MINUTOSPACTOCARGA], ['G', '08:00', '1', '0'], 'sin datos del destino: los de la empresa');
  const d = mapa(D.variablesRemesa(empresa, viaje({ tipoOperacionRemesa: 'P', tipoConsolidacion: 'D', tipoEmpaque: '17', horaCitaCargue: '12:00', horaCitaDescargue: '20:00',
    minutosPactoCargue: 90, minutosPactoDescargue: 60 }), ctx, 'R2'));
  assert.deepEqual([d.CODOPERACIONTRANSPORTE, d.TIPOCONSOLIDADA, d.CODTIPOEMPAQUE, d.HORACITAPACTADACARGUE, d.HORACITAPACTADADESCARGUEREMESA, d.HORASPACTOCARGA, d.MINUTOSPACTOCARGA],
    ['P', 'D', '17', '12:00', '20:00', '1', '30']);
  const conExtra = { ...empresa, rndc: { ...empresa.rndc, extras: [{ proceso: 3, variable: 'TIPOCONSOLIDADA', valor: 'D' }] } };
  assert.equal(mapa(D.variablesRemesa(conExtra, viaje({ tipoOperacionRemesa: 'G' }), ctx, 'R3')).TIPOCONSOLIDADA, undefined,
    'un destino con remesa general no lleva el tipo de consolidación fijo de la empresa');
});

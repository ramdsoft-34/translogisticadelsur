import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineaViaje, destinoRepiteConductor, mensajesPorCliente } from '../src/services/whatsapp.js';

const viaje = (extra) => ({ _id: 'v1', conductorNombre: 'WILSON ORLANDO MONTERO RIVERA', destino: 'Ipiales', flete: 550000, anticipo: 350000,
  placa: 'TKK224', estado: 'registrado', cliente: { _id: 'c1', nombre: 'Corbeta' }, ...extra });

test('WhatsApp: el destino no repite el nombre del conductor', () => {
  assert.equal(destinoRepiteConductor('wilson montero', 'WILSON ORLANDO MONTERO RIVERA'), true);
  assert.equal(destinoRepiteConductor('Ipiales', 'WILSON ORLANDO MONTERO RIVERA'), false);
  assert.equal(lineaViaje(viaje({ destino: 'wilson montero' })),
    'WILSON ORLANDO MONTERO RIVERA. Flete $ 550.000 COP. Anticipo $ 350.000 COP\nPlaca TKK224');
  assert.match(lineaViaje(viaje()), /^WILSON ORLANDO MONTERO RIVERA\. Ipiales\. Flete/);
});

test('WhatsApp: viajes pendientes de remesa y manifiesto, reportados o no', () => {
  const [m] = mensajesPorCliente([
    viaje({ _id: 'a', reporteWhatsapp: { fecha: new Date() } }),
    viaje({ _id: 'b', estado: 'remesa' }),
    viaje({ _id: 'c', estado: 'manifestado' }),
    viaje({ _id: 'd', historico: true }),
  ], new Date());
  assert.deepEqual(m.pendientesRndc, ['a', 'b']);
});

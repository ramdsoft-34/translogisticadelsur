import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarPlantilla, destinoRepiteConductor, mensajesPorCliente, PLANTILLA_BASE } from '../src/services/whatsapp.js';

const viaje = (extra) => ({ _id: 'v1', numero: 7, conductorNombre: 'WILSON ORLANDO MONTERO RIVERA', conductor: { numId: '1085', celular: '3001234567' },
  destino: 'Ipiales', flete: 550000, anticipo: 350000, placa: 'TKK224', estado: 'registrado', cliente: { _id: 'c1', nombre: 'Corbeta' }, ...extra });
const fecha = new Date(Date.UTC(2026, 9, 16));
const tarde = new Date('2026-10-16T20:00:00Z'); // 15:00 en Colombia

test('WhatsApp: la plantilla base reproduce el formato del Excel', () => {
  const [m] = mensajesPorCliente([viaje({ observaciones: 'Llamar al llegar' })], fecha, tarde, PLANTILLA_BASE);
  assert.equal(m.texto, 'Buenas tardes,\n\nReporte de vehículos - 16/10/2026\n\nCorbeta\n\n'
    + 'WILSON ORLANDO MONTERO RIVERA. Ipiales. Flete $ 550.000 COP. Anticipo $ 350.000 COP\nPlaca TKK224\nLlamar al llegar\n');
});

test('WhatsApp: el destino no repite el nombre del conductor y las líneas vacías se omiten', () => {
  assert.equal(destinoRepiteConductor('wilson montero', 'WILSON ORLANDO MONTERO RIVERA'), true);
  assert.equal(destinoRepiteConductor('Ipiales', 'WILSON ORLANDO MONTERO RIVERA'), false);
  const [m] = mensajesPorCliente([viaje({ destino: 'wilson montero' })], fecha, tarde);
  assert.match(m.texto, /\n\nWILSON ORLANDO MONTERO RIVERA\. Flete \$ 550\.000 COP\. Anticipo \$ 350\.000 COP\nPlaca TKK224\n$/);
});

test('WhatsApp: plantilla personalizada con totales, separador y datos del conductor', () => {
  const plantilla = { encabezado: '*{cliente}* · {fecha}', linea: '{numero}) {placa} - {conductor} CC {cedula}\nRemolque {remolque}\nSaldo {saldo}',
    separador: 'linea', pie: 'Total: {cantidad} vehículos · Flete {total_flete}' };
  const [m] = mensajesPorCliente([viaje(), viaje({ _id: 'v2', numero: 8, placa: 'ABC123', remolque: 'R12345', flete: 100000, anticipo: 0 })], fecha, tarde, plantilla);
  assert.equal(m.texto, '*Corbeta* · 16/10/2026\n\n'
    + '7) TKK224 - WILSON ORLANDO MONTERO RIVERA CC 1085\nSaldo $ 200.000 COP\n'
    + '8) ABC123 - WILSON ORLANDO MONTERO RIVERA CC 1085\nRemolque R12345\nSaldo $ 100.000 COP\n\n'
    + 'Total: 2 vehículos · Flete $ 650.000 COP\n');
  assert.equal(m.totalFlete, 650000);
});

test('WhatsApp: marcadores desconocidos se conservan tal cual', () => {
  assert.equal(aplicarPlantilla('Hola {nombre} {placa}', { placa: 'X1' }), 'Hola {nombre} X1');
});

// SIMULADOR LOCAL DEL RNDC — solo para desarrollo y pruebas.
// NO es el RNDC ni reemplaza sus validaciones. Reproduce el protocolo oficial
// (SOAP AtenderMensajeRNDC, respuesta en <return> con <ingresoid>, <ErrorMSG> o
// <documento>) para probar la plataforma sin enviar datos al Ministerio.
// Valida las variables obligatorias del diccionario de datos del manual v3.0,
// consecutivos repetidos (DUPLICADO) y el orden básico de los procesos.
// Todos los mensajes de error empiezan con "SIMULADOR:".
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DICCIONARIO } from '../src/services/rndc/diccionario.js';

const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const entre = (t, tag) => { const m = String(t).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')); return m ? m[1].trim() : ''; };

export function crearSimulador() {
  let radicado = 1000;
  const estado = { remesas: new Map(), manifiestos: new Map(), maestros: new Map(), cumplidos: new Set(), anulados: new Set(), log: [] };
  const ok = (extra = '') => `<?xml version="1.0" encoding="ISO-8859-1" ?><root><ingresoid>${++radicado}</ingresoid>${extra}</root>`;
  const error = (m) => `<?xml version="1.0" encoding="ISO-8859-1" ?><root><ErrorMSG>SIMULADOR: ${esc(m)}</ErrorMSG></root>`;

  function variables(xml) {
    const bloque = entre(xml, 'variables').replace(/<REMESASMAN[\s\S]*<\/REMESASMAN>/i, '');
    const v = {};
    for (const m of bloque.matchAll(/<([A-Z0-9_]+)>([\s\S]*?)<\/\1>/g)) v[m[1]] = m[2].trim();
    return v;
  }

  function registrar(proceso, xml) {
    const v = variables(xml);
    const faltan = Object.entries(DICCIONARIO[proceso] || {}).filter(([n, [, , req]]) => req === 'S' && !v[n]).map(([n]) => n);
    if (faltan.length) return error(`Faltan variables obligatorias: ${faltan.join(', ')}`);
    const nit = v.NUMNITEMPRESATRANSPORTE;
    switch (proceso) {
      case 11: case 12: {
        const clave = proceso === 11 ? `T|${nit}|${v.CODTIPOIDTERCERO}|${v.NUMIDTERCERO}|${v.CODSEDETERCERO || ''}` : `V|${nit}|${v.NUMPLACA}`;
        const previo = estado.maestros.get(clave);
        if (previo && JSON.stringify(previo) === JSON.stringify(v)) return error('DUPLICADO: el registro no tiene cambios');
        estado.maestros.set(clave, v);
        return ok();
      }
      case 3: {
        const k = `${nit}|${v.CONSECUTIVOREMESA}`;
        if (estado.remesas.has(k) || estado.anulados.has(`R|${k}`)) return error(`DUPLICADO: la remesa ${v.CONSECUTIVOREMESA} ya existe`);
        estado.remesas.set(k, { ...v, ingresoid: radicado + 1, fechaing: new Date().toISOString() });
        return ok();
      }
      case 4: {
        const k = `${nit}|${v.NUMMANIFIESTOCARGA}`;
        if (estado.manifiestos.has(k) || estado.anulados.has(`M|${k}`)) return error(`DUPLICADO: el manifiesto ${v.NUMMANIFIESTOCARGA} ya existe`);
        const remesas = [...xml.matchAll(/<CONSECUTIVOREMESA>([\s\S]*?)<\/CONSECUTIVOREMESA>/g)].map(m => m[1].trim());
        if (!remesas.length) return error('El manifiesto no trae remesas (REMESASMAN)');
        const sinRemesa = remesas.filter(r => !estado.remesas.has(`${nit}|${r}`));
        if (sinRemesa.length) return error(`Remesas no registradas: ${sinRemesa.join(', ')}`);
        estado.manifiestos.set(k, { ...v, remesas, ingresoid: radicado + 1, fechaing: new Date().toISOString() });
        const seguridad = crypto.randomBytes(21).toString('base64'); // 28 caracteres, como el código real
        return ok(`<seguridadqr>${seguridad}</seguridadqr>`);
      }
      case 5: {
        if (!estado.remesas.has(`${nit}|${v.CONSECUTIVOREMESA}`)) return error('La remesa no existe');
        if (!estado.manifiestos.has(`${nit}|${v.NUMMANIFIESTOCARGA}`)) return error('El manifiesto no existe');
        estado.cumplidos.add(`CR|${nit}|${v.CONSECUTIVOREMESA}`);
        return ok();
      }
      case 6: {
        const m = estado.manifiestos.get(`${nit}|${v.NUMMANIFIESTOCARGA}`);
        if (!m) return error('El manifiesto no existe');
        const pendientes = m.remesas.filter(r => !estado.cumplidos.has(`CR|${nit}|${r}`));
        if (pendientes.length) return error(`Primero cumpla las remesas: ${pendientes.join(', ')}`);
        estado.cumplidos.add(`CM|${nit}|${v.NUMMANIFIESTOCARGA}`);
        return ok();
      }
      case 9: {
        const k = `${nit}|${v.CONSECUTIVOREMESA}`;
        if (!estado.remesas.has(k)) return error('La remesa no existe');
        for (const m of estado.manifiestos.values()) if (m.remesas.includes(v.CONSECUTIVOREMESA)) return error('La remesa está en un manifiesto vigente');
        estado.remesas.delete(k); estado.anulados.add(`R|${k}`);
        return ok();
      }
      case 32: {
        const k = `${nit}|${v.NUMMANIFIESTOCARGA}`;
        if (!estado.manifiestos.has(k)) return error('El manifiesto no existe');
        if (estado.cumplidos.has(`CM|${k}`)) return error('El manifiesto está cumplido');
        estado.manifiestos.delete(k); estado.anulados.add(`M|${k}`);
        return ok();
      }
      case 28: estado.cumplidos.delete(`CR|${nit}|${v.CONSECUTIVOREMESA}`); return ok();
      case 29: estado.cumplidos.delete(`CM|${nit}|${v.NUMMANIFIESTOCARGA}`); return ok();
      default: return error(`Proceso ${proceso} no implementado en el simulador`);
    }
  }

  function consultar(proceso, xml) {
    const filtros = {};
    for (const m of entre(xml, 'documento').matchAll(/<([A-Z0-9_]+)>'?([\s\S]*?)'?<\/\1>/g)) filtros[m[1]] = m[2];
    const campos = desescapar(entre(xml, 'variables')).split(',').map(s => s.trim()).filter(Boolean);
    const maestros = (pref) => [...estado.maestros.entries()].filter(([k]) => k.startsWith(pref)).map(([, x]) => ({ ...x, MUNICIPIORNDC: x.CODMUNICIPIORNDC }));
    const fuente = proceso === 3 ? [...estado.remesas.values()] : proceso === 4 ? [...estado.manifiestos.values()]
      : proceso === 11 ? maestros('T|') : proceso === 12 ? maestros('V|') : [];
    const docs = fuente.filter(d => Object.entries(filtros).every(([k, val]) => k === 'NUMNITEMPRESATRANSPORTE' ? d.NUMNITEMPRESATRANSPORTE === val : String(d[k] ?? '') === val));
    const cuerpo = docs.map(d => `<documento>${campos.map(c => `<${c.toLowerCase()}>${esc(d[c] ?? d[c.toLowerCase()] ?? '')}</${c.toLowerCase()}>`).join('')}</documento>`).join('');
    return `<?xml version="1.0" encoding="ISO-8859-1" ?><root>${cuerpo}</root>`;
  }

  function atender(interno) {
    const usuario = entre(interno, 'username'); const clave = entre(interno, 'password');
    if (!usuario || !clave) return error('Usuario o contraseña vacíos');
    if (clave === 'clave-incorrecta') return error('Usuario o contraseña no válidos');
    const tipo = Number(entre(interno, 'tipo')); const proceso = Number(entre(interno, 'procesoid'));
    estado.log.push({ tipo, proceso, fecha: new Date() });
    if (tipo === 1) return registrar(proceso, interno);
    if (tipo === 2 || tipo === 3) return consultar(proceso, interno);
    return error(`Tipo ${tipo} no soportado`);
  }

  const servidor = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('Simulador RNDC local (no es el RNDC)'); }
    let cuerpo = '';
    req.on('data', c => { cuerpo += c; if (cuerpo.length > 2e6) req.destroy(); });
    req.on('end', () => {
      const m = cuerpo.match(/<Request[^>]*>([\s\S]*?)<\/Request>/i);
      let interno = m ? m[1] : '';
      interno = interno.startsWith('<![CDATA[') ? interno.slice(9, -3) : desescapar(interno);
      const respuesta = interno ? atender(interno) : error('Sobre SOAP sin Request');
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end('<?xml version="1.0" encoding="utf-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">' +
        '<SOAP-ENV:Body><NS1:AtenderMensajeRNDCResponse xmlns:NS1="urn:BPMServicesIntf-IBPMServices">' +
        `<return xsi:type="xsd:string">${esc(respuesta)}</return></NS1:AtenderMensajeRNDCResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`);
    });
  });
  return { servidor, estado };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const puerto = Number(process.env.RNDC_SIMULADOR_PUERTO) || 4010;
  crearSimulador().servidor.listen(puerto, '127.0.0.1', () => {
    console.log(`Simulador RNDC (solo pruebas) en http://127.0.0.1:${puerto}/soap/IBPMServices`);
  });
}

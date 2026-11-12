// Pasa a Mensajes de WhatsApp las solicitudes a los jefes de bodega enviadas antes de que se registraran allí
// (quedaban solo en el reporte de bodega del día). No reenvía nada. Sin entregado / leído: esos avisos de Meta ya pasaron.
// Uso: node scripts/solicitudesBodegaEnMensajes.js [--aplicar]
import { conectar, desconectar } from '../src/db.js';
import { Empresa, EnvioWhatsapp, ReporteBodega } from '../src/models/index.js';
import { celularWhatsapp } from '../src/services/whatsappBusiness.js';

const aplicar = process.argv.includes('--aplicar');
await conectar();
try {
  const res = { reportes: 0, nuevos: 0, yaEstaban: 0 };
  const modos = new Map((await Empresa.find({}).select('whatsapp.modo').lean()).map((e) => [String(e._id), e.whatsapp?.modo || 'plataforma']));
  const reportes = await ReporteBodega.find({ empresa: { $exists: true }, 'envio.enviadoEn': { $ne: null } }).select('empresa cliente envio').lean();
  for (const r of reportes) {
    res.reportes += 1;
    for (const d of r.envio?.destinatarios || []) {
      const telefono = celularWhatsapp(d.celular) || '';
      const ya = d.idMensaje
        ? await EnvioWhatsapp.exists({ empresa: r.empresa, idMensaje: d.idMensaje })
        : await EnvioWhatsapp.exists({ empresa: r.empresa, tipo: 'bodega', reporteBodega: r._id, telefono });
      if (ya) { res.yaEstaban += 1; continue; }
      res.nuevos += 1;
      if (!aplicar) continue;
      const fecha = r.envio.enviadoEn;
      await EnvioWhatsapp.collection.insertOne({ empresa: r.empresa, viaje: null, conductor: null, tipo: 'bodega', cliente: r.cliente, reporteBodega: r._id,
        documento: 'Cargues de bodega', destinatario: d.nombre || '', telefono, cuenta: modos.get(String(r.empresa)) || 'plataforma',
        estado: d.ok ? 'enviado' : 'error', intentos: 1, idMensaje: d.idMensaje || '', error: d.ok ? '' : (d.error || ''),
        aprobadoPor: null, aprobadoEn: null, enviadoEn: d.ok ? fecha : null, entregadoEn: null, leidoEn: null,
        origen: r.envio.automatico ? 'automatico' : 'manual', usuario: r.envio.usuario || null, createdAt: fecha, updatedAt: fecha, __v: 0 });
    }
  }
  console.log(JSON.stringify({ aplicar, ...res }));
} finally { await desconectar(); }

# Genera la plantilla del Manifiesto Electrónico de Carga a partir de un manifiesto
# expedido por el RNDC (formato FastReport vigente desde agosto de 2026).
# Uso: python plantillaManifiesto.py <manifiesto_oficial.pdf> <corpus_v3.json> <salida.json>
# - Dibujos (cajas, líneas y fondos) y textos fijos con su posición exacta.
# - Un texto es fijo si aparece igual y en la misma posición en al menos el 97 % del corpus.
import sys, json, collections, pymupdf

pdf, corpus, salida = sys.argv[1:4]
docs = json.load(open(corpus, encoding='utf-8'))
cuenta = collections.Counter()
for d in docs:
    for s in set((s[6], round(s[0]), round(s[1])) for s in d['s']): cuenta[s] += 1
fijos = {k for k, v in cuenta.items() if v >= len(docs) * 0.97}
# Datos de la empresa (van como campos) y rótulos ocultos bajo las barras grises
NO_FIJOS = ('COOPERATIVA', 'CRA 67', 'Tel:', 'Nit:', 'PRECIO DEL VIAJE', 'RECOMENDACIONES', 'Carga Normal', 'Empresa de Transporte',
            '009980', 'REMITENTE', 'DESTINATARIO', 'PASTO NARINO', '0.00', 'Kilogramos', 'PAGO DEL SALDO')

p = pymupdf.open(pdf)[0]
color = lambda c: None if c is None else '#%02x%02x%02x' % tuple(round(x * 255) for x in c)
dibujos = []
for x in p.get_drawings():
    r = x['rect']
    if r.y0 > p.rect.height or r.x0 > p.rect.width: continue
    for it in x['items']:
        if it[0] == 're':
            q = it[1]
            dibujos.append({'t': 'r', 'x': round(q.x0, 2), 'y': round(q.y0, 2), 'w': round(q.width, 2), 'h': round(q.height, 2),
                            'relleno': color(x.get('fill')) if 'f' in x['type'] else None,
                            'trazo': color(x.get('color')) if 's' in x['type'] else None, 'grosor': x.get('width') or 0})
        elif it[0] == 'l':
            dibujos.append({'t': 'l', 'x1': round(it[1].x, 2), 'y1': round(it[1].y, 2), 'x2': round(it[2].x, 2), 'y2': round(it[2].y, 2),
                            'trazo': color(x.get('color')), 'grosor': x.get('width') or 0})
textos = []
for b in p.get_text('dict')['blocks']:
    for l in b.get('lines', []):
        for s in l['spans']:
            t = s['text']
            ley = s['bbox'][0] > 490 and s['bbox'][1] < 85      # párrafo de la ley 527 (siempre igual)
            ley = ley or t.strip() in ('F.Vencimiento SOAT', 'FECHA HORA RADICACION')  # rótulos que cambiaron de posición en 2026
            if not t.strip() or ((t, round(s['bbox'][0]), round(s['bbox'][1])) not in fijos and not ley): continue
            if any(t.strip().startswith(n) for n in NO_FIJOS): continue
            if s['color'] == 0xFFFFFF: continue                   # rótulos en blanco (no se ven)
            textos.append({'x': round(s['bbox'][0], 2), 'y': round(s['origin'][1], 2), 'tam': s['size'], 'negrita': 'Bold' in s['font'], 'color': '#%06x' % s['color'], 'texto': t})
imagenes = {}
for i, nombre in zip(p.get_images(full=True), ('transporte', 'supertransporte', 'qr')):
    q = p.get_image_bbox(i)
    imagenes[nombre] = [round(q.x0, 2), round(q.y0, 2), round(q.width, 2), round(q.height, 2)]
json.dump({'pagina': [p.rect.width, p.rect.height], 'dibujos': dibujos, 'textos': textos, 'imagenes': imagenes},
          open(salida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(dibujos), 'dibujos,', len(textos), 'textos fijos,', imagenes)

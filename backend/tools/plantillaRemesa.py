# Genera la plantilla de la Remesa de Carga a partir de una remesa impresa por el RNDC (FastReport).
# Uso: python plantillaRemesa.py <remesa_oficial.pdf> <salida.json>
# - Dibujos (cajas, líneas y fondos) y rótulos fijos (los que van en negrita) con su posición exacta.
# - Los datos (empresa, consecutivo, autorización y los valores de cada casilla) no se copian: van como campos.
import sys, json, pymupdf

pdf, salida = sys.argv[1:3]
NO_FIJOS = ('COOPERATIVA', 'Nit:', 'CRA 67', 'Tel:', 'PASTO NARINO')
p = pymupdf.open(pdf)[0]
color = lambda c: None if c is None else '#%02x%02x%02x' % tuple(round(x * 255) for x in c)
dibujos = []
for x in p.get_drawings():
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
            if not t.strip() or 'Bold' not in s['font'] or t.strip().startswith(NO_FIJOS): continue
            if t.strip().replace('R', '').isdigit(): continue          # consecutivo y autorización
            textos.append({'x': round(s['bbox'][0], 2), 'y': round(s['origin'][1], 2), 'tam': s['size'], 'negrita': True, 'color': '#%06x' % s['color'], 'texto': t.rstrip()})
imagenes = {}
for i, nombre in zip(p.get_images(full=True), ('supertransporte', 'transporte')):
    q = p.get_image_bbox(i)
    imagenes[nombre] = [round(q.x0, 2), round(q.y0, 2), round(q.width, 2), round(q.height, 2)]
json.dump({'pagina': [p.rect.width, p.rect.height], 'dibujos': dibujos, 'textos': textos, 'imagenes': imagenes},
          open(salida, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(dibujos), 'dibujos,', len(textos), 'rótulos,', imagenes)

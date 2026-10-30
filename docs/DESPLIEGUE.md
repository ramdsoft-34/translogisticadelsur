# Despliegue en producción (VPS Ubuntu)

Servidor compartido con otras aplicaciones: todo lo de esta plataforma vive en
`/var/www/translogisticadelsur`, usa la base `translogisticadelsur`, la API en `127.0.0.1:4100`
y el sitio nginx `translogisticadelsur.com`. No se modifican los demás sitios ni procesos.

## Primera instalación
```bash
git clone https://github.com/ramdsoft-34/translogisticadelsur.git /var/www/translogisticadelsur
cd /var/www/translogisticadelsur/backend && npm ci --omit=dev
cp .env.example .env && chmod 600 .env   # completar: NODE_ENV=production, HOST=127.0.0.1, PORT=4100,
                                         # MONGODB_URI, JWT_SECRET (aleatorio), CORS_ORIGINS=https://translogisticadelsur.com
npm run municipios                       # catálogo DIVIPOLA
SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... npm run seed   # credenciales solo en la línea de comandos, nunca en .env
cd ../frontend && npm ci && npx ng build
pm2 start ../deploy/ecosystem.config.cjs && pm2 save
cp ../deploy/nginx.conf /etc/nginx/sites-available/translogisticadelsur.com
ln -s /etc/nginx/sites-available/translogisticadelsur.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d translogisticadelsur.com -d www.translogisticadelsur.com --redirect
```

## Actualizar
```bash
cd /var/www/translogisticadelsur && git pull
cd backend && npm ci --omit=dev && cd ../frontend && npm ci && npx ng build
pm2 restart tls-api
```

## Copias de seguridad
`/etc/cron.d/tls-backup` ejecuta `mongodump` cada noche a `/var/backups/translogisticadelsur`
(se conservan 14 días). Restaurar: `mongorestore --gzip --archive=ARCHIVO --nsInclude='translogisticadelsur.*'`.

Además, cada empresa tiene su archivo en `ARCHIVO_DIR` (por defecto `backend/archivo`, fuera de git):
al **cerrar un mes** se guardan la copia completa de sus datos (`<aaaa-mm>/respaldo-<aaaa-mm>.json.gz`,
líneas JSON en EJSON canónico), los informes de viajes por empresa y los PDF de manifiestos. El administrador
descarga un respaldo completo en cualquier momento (Contabilidad → Cierre de mes). Incluya `ARCHIVO_DIR`
en la copia nocturna del servidor.

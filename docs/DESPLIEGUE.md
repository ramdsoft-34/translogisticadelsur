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

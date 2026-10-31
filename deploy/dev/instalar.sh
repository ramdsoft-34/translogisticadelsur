#!/bin/bash
# Ambiente de pruebas dev.translogisticadelsur.com (rama csalcedo17). Se ejecuta UNA vez, como root, en el VPS:
#   bash /var/www/translogisticadelsur/deploy/dev/instalar.sh
# Aislamiento (el código de la rama corre en el mismo servidor que producción):
#  - Usuario del sistema «tlsdev» sin privilegios: compila y ejecuta la rama.
#  - MongoDB propio en 127.0.0.1:27018; el firewall impide a tlsdev conectarse al MongoDB (27017) y a la API (4100) de producción.
#  - Sin llave del RNDC, sin envío al RNDC real (solo el simulador) y correos en memoria (no salen).
#  - Sitio con usuario y contraseña de nginx y sin indexar en buscadores.
set -euo pipefail
PROD=/var/www/translogisticadelsur
DEV=/var/www/tls-dev
# Repositorio público: clon de solo lectura por HTTPS. Si se vuelve privado, use una llave de despliegue (Deploy key)
# de solo lectura del usuario tlsdev y la dirección git@github.com:ramdsoft-34/translogisticadelsur.git
REPO=${REPO:-https://github.com/ramdsoft-34/translogisticadelsur.git}
DOMINIO=dev.translogisticadelsur.com

id tlsdev >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/tlsdev --shell /bin/bash tlsdev
chmod 600 "$PROD/backend/.env"                       # los secretos de producción solo los lee root

mkdir -p "$DEV" && chown tlsdev:tlsdev "$DEV"
[ -d "$DEV/.git" ] || sudo -u tlsdev git clone -q -b csalcedo17 "$REPO" "$DEV"

# MongoDB de pruebas (instancia aparte, del usuario tlsdev)
mkdir -p /var/lib/mongodb-dev /var/log/mongodb-dev && chown tlsdev:tlsdev /var/lib/mongodb-dev /var/log/mongodb-dev
cat > /etc/systemd/system/mongod-dev.service <<EOF
[Unit]
Description=MongoDB del ambiente de pruebas (dev.translogisticadelsur.com)
After=network.target
[Service]
User=tlsdev
ExecStart=$(command -v mongod) --bind_ip 127.0.0.1 --port 27018 --dbpath /var/lib/mongodb-dev --logpath /var/log/mongodb-dev/mongod.log --logappend --wiredTigerCacheSizeGB 0.25
Restart=always
[Install]
WantedBy=multi-user.target
EOF

# Firewall por usuario: tlsdev no llega a la base ni a la API de producción
cat > /etc/systemd/system/tls-dev-firewall.service <<EOF
[Unit]
Description=Aislar el ambiente de pruebas de producción
Before=mongod-dev.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'for p in 27017 4100; do iptables -C OUTPUT -m owner --uid-owner tlsdev -p tcp --dport \$p -j REJECT 2>/dev/null || iptables -I OUTPUT -m owner --uid-owner tlsdev -p tcp --dport \$p -j REJECT; done'
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tls-dev-firewall mongod-dev

# Variables del backend de pruebas
if [ ! -f "$DEV/backend/.env" ]; then
  cat > "$DEV/backend/.env" <<EOF
NODE_ENV=production
PORT=4200
HOST=127.0.0.1
MONGODB_URI=mongodb://127.0.0.1:27018/tls_dev
JWT_SECRET=$(openssl rand -hex 48)
CORS_ORIGINS=https://$DOMINIO
URL_PUBLICA=https://$DOMINIO
RNDC_PERMITIR_PRODUCCION=false
RNDC_PERMITIR_PRUEBAS=false
CORREO_TRANSPORTE=memoria
COOESPATRANS_INTEGRACION_URL=
ARCHIVO_DIR=/home/tlsdev/archivo
EOF
  chown tlsdev:tlsdev "$DEV/backend/.env"; chmod 600 "$DEV/backend/.env"
fi

# Script de publicación (de root, fuera del código de la rama: la rama no lo puede cambiar)
install -m 755 -o root -g root "$PROD/deploy/dev/desplegar.sh" /usr/local/sbin/tls-desplegar-dev

# Llave para GitHub Actions: solo puede ejecutar la publicación de pruebas (comando forzado)
if [ ! -f /root/.ssh/tls_dev_actions ]; then
  ssh-keygen -q -t ed25519 -N '' -C 'github-actions-dev' -f /root/.ssh/tls_dev_actions
  echo "command=\"/usr/local/sbin/tls-desplegar-dev\",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding $(cat /root/.ssh/tls_dev_actions.pub)" >> /root/.ssh/authorized_keys
fi

# nginx con usuario y contraseña + HTTPS
if [ ! -f /etc/nginx/tls-dev.htpasswd ]; then
  CLAVE=$(openssl rand -base64 12)
  printf 'pruebas:%s\n' "$(openssl passwd -apr1 "$CLAVE")" > /etc/nginx/tls-dev.htpasswd
  chmod 640 /etc/nginx/tls-dev.htpasswd; chown root:www-data /etc/nginx/tls-dev.htpasswd
  echo "$CLAVE" > /root/tls-dev-clave-nginx.txt; chmod 600 /root/tls-dev-clave-nginx.txt
fi
cp "$PROD/deploy/dev/nginx-dev.conf" /etc/nginx/sites-available/tls-dev
ln -sf /etc/nginx/sites-available/tls-dev /etc/nginx/sites-enabled/tls-dev
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos --redirect --register-unsafely-without-email || echo ">> certbot falló: revise que el DNS de $DOMINIO apunte a este servidor"

# pm2 del usuario tlsdev (aparte del de producción) y primera publicación
env PATH="$PATH" pm2 startup systemd -u tlsdev --hp /home/tlsdev >/dev/null
/usr/local/sbin/tls-desplegar-dev
echo; echo "Listo. Llave privada para GitHub Actions (secreto DEV_SSH_KEY): /root/.ssh/tls_dev_actions"
echo "Usuario de nginx: pruebas · contraseña en /root/tls-dev-clave-nginx.txt"

#!/bin/bash
# Publica la versión del repositorio en el servidor sin cortar a los usuarios.
# Uso (en el servidor): bash /var/www/translogisticadelsur/deploy/desplegar.sh
#  - Respaldo del frontend publicado.
#  - El frontend nuevo se compila aparte y conserva los archivos de las versiones de los últimos 14 días:
#    así una página abierta antes de publicar no falla al entrar a otra sección.
#  - El servidor (tls-api) solo se reinicia si cambió el backend; la plataforma reintenta sola los segundos del reinicio.
set -euo pipefail
RAIZ=/var/www/translogisticadelsur
RESPALDOS=/var/backups/translogisticadelsur
F=$(date +%Y%m%d-%H%M%S)
cd "$RAIZ"

antes=$(git rev-parse HEAD)
git pull -q
despues=$(git rev-parse HEAD)
cambios=$(git diff --name-only "$antes" "$despues")

if echo "$cambios" | grep -q '^frontend/' || [ "${1:-}" = "--todo" ]; then
  tar czf "$RESPALDOS/frontend-$F.tgz" -C frontend dist
  cd frontend
  rm -rf dist-nuevo
  npx ng build --output-path dist-nuevo/frontend > /tmp/ng-build.log 2>&1 || { tail -30 /tmp/ng-build.log; exit 1; }
  # Archivos de versiones anteriores (14 días) para las páginas que ya estaban abiertas
  find dist/frontend/browser -maxdepth 1 -type f \( -name 'chunk-*.js' -o -name 'main-*.js' -o -name 'polyfills-*.js' -o -name 'styles-*.css' \) -mtime -14 \
    -exec cp -np {} dist-nuevo/frontend/browser/ \;
  rm -rf dist-viejo
  mv dist dist-viejo
  mv dist-nuevo dist
  cd ..
  echo "frontend publicado"
fi

if echo "$cambios" | grep -q '^backend/' || [ "${1:-}" = "--todo" ]; then
  if echo "$cambios" | grep -q '^backend/package'; then (cd backend && npm ci --omit=dev --silent); fi
  pm2 reload tls-api --update-env > /dev/null
  for i in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/api/salud)" = "200" ] && break
    sleep 0.5
  done
  echo "servidor reiniciado"
fi
curl -s -o /dev/null -w "web %{http_code} " https://translogisticadelsur.com/
curl -s -o /dev/null -w "api %{http_code}\n" https://translogisticadelsur.com/api/salud

#!/bin/bash
# Publica la rama csalcedo17 en dev.translogisticadelsur.com. Lo ejecuta GitHub Actions (llave con comando
# forzado) o root a mano. Se instala en /usr/local/sbin/tls-desplegar-dev: la rama no lo puede modificar.
# Todo lo de la rama (npm, compilación y la API) corre como el usuario tlsdev, sin privilegios.
set -euo pipefail
DEV=/var/www/tls-dev
exec 9>/tmp/tls-desplegar-dev.lock; flock -w 600 9       # una publicación a la vez
como() { sudo -u tlsdev -H env PATH="$PATH" bash -c "cd $DEV && $1"; }

antes=$(como 'git rev-parse HEAD')
como 'git fetch -q origin csalcedo17 && git reset -q --hard origin/csalcedo17'
despues=$(como 'git rev-parse HEAD')
primera=$([ -d "$DEV/frontend/dist" ] && echo no || echo si)
cambios=$(como "git diff --name-only $antes $despues")
echo "Rama csalcedo17: $(como 'git log -1 --format="%h %s"')"

if [ "$primera" = si ] || echo "$cambios" | grep -q '^frontend/'; then
  { [ "$primera" = si ] || echo "$cambios" | grep -q '^frontend/package'; } && como 'cd frontend && npm install --no-audit --no-fund --loglevel=error'
  como 'cd frontend && npx ng build --output-path dist-nuevo/frontend > /tmp/tls-dev-ng.log 2>&1' || { tail -30 /tmp/tls-dev-ng.log; exit 1; }
  como 'cd frontend && rm -rf dist && mv dist-nuevo dist'
  echo "frontend de pruebas publicado"
fi
if [ "$primera" = si ] || echo "$cambios" | grep -q '^backend/'; then
  { [ "$primera" = si ] || echo "$cambios" | grep -q '^backend/package'; } && como 'cd backend && npm ci --omit=dev --silent'
  if como 'pm2 describe tls-dev-api' >/dev/null 2>&1; then como 'pm2 reload tls-dev-api --update-env >/dev/null'
  else como 'cd backend && pm2 start src/server.js --name tls-dev-api --max-memory-restart 300M --time >/dev/null && pm2 save >/dev/null'; fi
  for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4200/api/salud)" = "200" ] && break; sleep 0.5; done
  echo "API de pruebas reiniciada"
fi
echo "api $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4200/api/salud)"

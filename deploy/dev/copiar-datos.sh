#!/bin/bash
# Copia la base de producción al ambiente de pruebas (reemplaza la de pruebas). Como root, cuando se quiera refrescar:
#   bash /var/www/translogisticadelsur/deploy/dev/copiar-datos.sh
# Después de copiar se quitan los secretos: contraseña guardada del RNDC y servidores de correo (SMTP).
set -euo pipefail
ORIGEN=${1:-translogisticadelsur}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mongodump --quiet --uri "mongodb://127.0.0.1:27017/$ORIGEN" --out "$TMP"
mongorestore --quiet --drop --uri "mongodb://127.0.0.1:27018" --nsFrom "$ORIGEN.*" --nsTo 'tls_dev.*' "$TMP"
mongosh --quiet "mongodb://127.0.0.1:27018/tls_dev" --eval '
  db.secretorndcs.drop();
  db.empresas.updateMany({}, { $set: { "smtp.activo": false, "smtp.clave": "", "smtp.password": "" } });
  print("Copia lista: " + db.viajes.countDocuments() + " viajes, " + db.usuarios.countDocuments() + " usuarios");'

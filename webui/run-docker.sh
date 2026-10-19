#!/usr/bin/env bash
# تشغيل واجهة الويب داخل Docker (لا يلزم تثبيت Node). تتصل بقاعدة البيانات عبر المنفذ المنشور على الجهاز (host.docker.internal).
# المتطلب: قاعدة البيانات تعمل (oracle/local/install-local.sh) وملف oracle/local/.env موجود.
set -euo pipefail
cd "$(dirname "$0")"
NAME="${ERP_WEB_NAME:-erp-web}"
PORT="${ERP_WEB_PORT:-3001}"
DBPORT="${ERP_ORACLE_PORT:-1521}"
ENVF=".env-docker"
DBENV="../oracle/local/.env"

if [ ! -f "$ENVF" ]; then
  [ -f "$DBENV" ] || { echo "لا يوجد $DBENV: ثبّت قاعدة البيانات أولاً"; exit 1; }
  DBPW="$(sed -n 's/^ERP_DB_PASSWORD=//p' "$DBENV" | head -1)"
  WEBPW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-12)"
  {
    echo "ERP_DB_USER=erp_owner"; echo "ERP_DB_PASSWORD=$DBPW"; echo "ERP_DB_CONNECT=host.docker.internal:$DBPORT/XEPDB1"
    echo "ERP_WEB_USER=admin"; echo "ERP_WEB_PASSWORD=$WEBPW"; echo "ERP_WEB_SECRET=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
  } > "$ENVF"
  chmod 600 "$ENVF"
  echo "أُنشئ $ENVF — كلمة سر الدخول: $WEBPW"
fi

docker build -t erp-web .
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped --add-host host.docker.internal:host-gateway \
  --env-file "$ENVF" -e ERP_WEB_HOST=0.0.0.0 -p "127.0.0.1:$PORT:3001" erp-web >/dev/null
echo "تعمل الواجهة على http://localhost:$PORT  (المستخدم: admin، كلمة السر في $ENVF)"

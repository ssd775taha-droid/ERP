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

# كلمة سر القاعدة الحقيقية تُؤخذ من حاوية Oracle نفسها (قد تكون ثُبّتت من مجلد آخر بكلمة سر مختلفة)
DBNAME="${ERP_ORACLE_NAME:-erp-oracle}"
REAL="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DBNAME" 2>/dev/null | sed -n 's/^APP_USER_PASSWORD=//p' | head -1)"
CUR="$(sed -n 's/^ERP_DB_PASSWORD=//p' "$ENVF" | head -1)"
if [ -n "$REAL" ] && [ "$REAL" != "$CUR" ]; then
  grep -v '^ERP_DB_PASSWORD=' "$ENVF" > "$ENVF.tmp"; echo "ERP_DB_PASSWORD=$REAL" >> "$ENVF.tmp"; mv "$ENVF.tmp" "$ENVF"; chmod 600 "$ENVF"
  CUR="$REAL"; echo "حُدّثت كلمة سر القاعدة في $ENVF من الحاوية $DBNAME"
fi
# الاتصال بحاوية القاعدة مباشرة عبر شبكة Docker داخلية (لا يمر بمنفذ الجهاز، فقد يشغله مستمع Oracle آخر لا يعرف XEPDB1)
NETARG=""
set_env() { grep -v "^$1=" "$ENVF" > "$ENVF.tmp"; echo "$1=$2" >> "$ENVF.tmp"; mv "$ENVF.tmp" "$ENVF"; chmod 600 "$ENVF"; }
if [ -n "$REAL" ]; then
  docker network inspect erp-net >/dev/null 2>&1 || docker network create erp-net >/dev/null
  docker network connect erp-net "$DBNAME" >/dev/null 2>&1 || true
  NETARG="--network erp-net"
  set_env ERP_DB_CONNECT "$DBNAME:1521/XEPDB1"
else
  echo "تنبيه: لا حاوية $DBNAME؛ سيتصل بمنفذ الجهاز (قد يفشل إن شغله برنامج آخر)"
  set_env ERP_DB_CONNECT "host.docker.internal:${ERP_ORACLE_PORT:-1521}/XEPDB1"
fi
if [ -z "$CUR" ]; then
  echo "كلمة سر القاعدة غير معروفة: لا حاوية باسم $DBNAME ولا كلمة سر في $ENVF"; exit 1
fi

docker build -t erp-web .
docker rm -f "$NAME" >/dev/null 2>&1 || true
# shellcheck disable=SC2086
docker run -d --name "$NAME" --restart unless-stopped --add-host host.docker.internal:host-gateway $NETARG \
  --env-file "$ENVF" -e ERP_WEB_HOST=0.0.0.0 -p "127.0.0.1:$PORT:3001" erp-web >/dev/null
echo "تعمل الواجهة على http://localhost:$PORT  (المستخدم: admin، كلمة السر في $ENVF)"

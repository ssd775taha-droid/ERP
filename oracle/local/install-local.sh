#!/usr/bin/env bash
# تثبيت نظام ERP (Oracle) على جهازك بأمر واحد باستخدام Docker (Linux / macOS / WSL / Git Bash).
#   ./local/install-local.sh              تثبيت كامل: قاعدة Oracle XE + المخطط + الحزم + اختبار ذاتي
#   ./local/install-local.sh --reinstall  يحذف كائنات النظام ويعيد تثبيتها (يحذف البيانات)
#   ./local/install-local.sh --no-test    بلا الاختبار الذاتي
# متغيرات اختيارية: ERP_ORACLE_IMAGE (الصورة) · ERP_ORACLE_NAME (اسم الحاوية) · ERP_ORACLE_PORT (المنفذ، الافتراضي 1521)
# يحفظ كلمة السر في local/.env والسجلات في local/logs/ (كلاهما خارج git).
set -euo pipefail

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${ERP_ORACLE_IMAGE:-gvenzl/oracle-xe:21-slim}"
NAME="${ERP_ORACLE_NAME:-erp-oracle}"
PORT="${ERP_ORACLE_PORT:-1521}"
ENV_FILE="$ORACLE_DIR/local/.env"
LOG_DIR="$ORACLE_DIR/local/logs"
REINSTALL=0; RUN_TEST=1; FORCE_TEST=0
for a in "$@"; do
  case "$a" in
    --reinstall) REINSTALL=1 ;;
    --no-test)   RUN_TEST=0 ;;
    --force-test) FORCE_TEST=1 ;;
    -h|--help)   sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "خيار غير معروف: $a" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "Docker غير مثبّت. ثبّته أولاً (Docker Desktop على ويندوز وماك)." >&2; exit 1; }
if ! SERVER_VER="$(docker version --format '{{.Server.Version}}' 2>&1)"; then
  echo "رسالة Docker: $SERVER_VER" >&2
  echo "المحرّك (Engine) لا يستجيب. شغّل Docker Desktop وانتظر حتى يكتمل تشغيله ثم أعد المحاولة." >&2
  exit 1
fi
mkdir -p "$LOG_DIR"

# كلمة السر: تُولَّد مرة واحدة وتُحفظ (أحرف وأرقام فقط لتجنب مشاكل الاقتباس)
if [ ! -f "$ENV_FILE" ]; then
  # لا نستخدم tr | head على /dev/urandom: head يغلق الأنبوب مبكراً فتصدر SIGPIPE ويفشل السكربت مع pipefail
  PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-14)A1"
  printf 'ERP_DB_PASSWORD=%s\n' "$PW" > "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "أُنشئت كلمة سر لقاعدة البيانات في local/.env"
fi
# shellcheck disable=SC1090
. "$ENV_FILE"
PW="$ERP_DB_PASSWORD"
SVC="XEPDB1"

# --- الحاوية ---
EXISTS=0
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  EXISTS=1
  # حاوية من تثبيت سابق (ربما من مجلد آخر): نستعيد كلمة سر قاعدتها من إعداداتها بدل الاعتماد على .env جديد
  CPW="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$NAME" | sed -n 's/^APP_USER_PASSWORD=//p' | head -1)"
  if [ -n "$CPW" ] && [ "$CPW" != "$PW" ]; then
    printf 'ERP_DB_PASSWORD=%s\n' "$CPW" > "$ENV_FILE"
    PW="$CPW"
    echo "استُعيدت كلمة سر القاعدة من الحاوية الموجودة إلى local/.env"
  fi
  docker start "$NAME" >/dev/null
  # إن حُذف مجلد التثبيت السابق (المربوط بالحاوية) نعيد إنشاء الحاوية على المجلد الحالي؛ البيانات في وحدة التخزين تبقى
  if ! docker exec "$NAME" test -f /erp/upgrade.sql; then
    echo "مجلد التثبيت السابق مفقود أو قديم (بلا upgrade.sql): إعادة إنشاء الحاوية (البيانات محفوظة)"
    docker stop "$NAME" >/dev/null; docker rm "$NAME" >/dev/null
    EXISTS=0
  fi
fi
if [ "$EXISTS" = 1 ]; then
  echo "تشغيل الحاوية الموجودة: $NAME"
else
  echo "سحب الصورة وتشغيل الحاوية (أول مرة قد تستغرق عدة دقائق): $IMAGE"
  docker run -d --name "$NAME" -p "$PORT:1521" \
    -e ORACLE_PASSWORD="$PW" -e APP_USER=erp_owner -e APP_USER_PASSWORD="$PW" \
    -v "$ORACLE_DIR":/erp:ro -v "${NAME}-data":/opt/oracle/oradata "$IMAGE" >/dev/null
fi

echo -n "انتظار جاهزية قاعدة البيانات"
for i in $(seq 1 120); do
  # التقاط السجل أولاً: grep -q يغلق الأنبوب مبكراً فيُنهي docker logs بـ SIGPIPE (141) ومع pipefail يبقى الشرط كاذباً للأبد على سجل كبير
  LOGS="$(docker logs "$NAME" 2>&1 || true)"
  if grep -q "DATABASE IS READY TO USE" <<<"$LOGS"; then echo " — جاهزة"; break; fi
  echo -n "."; sleep 5
  [ "$i" -eq 120 ] && { echo; echo "انتهت المهلة. راجع: docker logs $NAME" >&2; exit 1; }
done

sql_erp()  { docker exec -i -e NLS_LANG=.AL32UTF8 "$NAME" bash -c "cd /erp && sqlplus -s erp_owner/$PW@//localhost/$SVC"; }
sql_sys()  { docker exec -i "$NAME" sqlplus -s / as sysdba; }

# صلاحيات مستخدم المخطط (لا تضرّ إن تكررت)
sql_sys >/dev/null <<'SQL'
ALTER SESSION SET CONTAINER = XEPDB1;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, CREATE PROCEDURE, CREATE TYPE, CREATE TRIGGER, UNLIMITED TABLESPACE TO erp_owner;
SQL

INSTALLED=$(printf "SET HEADING OFF FEEDBACK OFF PAGESIZE 0\nSELECT COUNT(*) FROM user_tables WHERE table_name = 'ERP_ACCOUNTS';\n" | sql_erp | tr -d '[:space:]')
if [ "$INSTALLED" != "0" ] && [ "$REINSTALL" -eq 0 ]; then
  echo "النظام مثبَّت مسبقاً. لإعادة التثبيت من الصفر (يحذف البيانات): ./local/install-local.sh --reinstall"
  # ترقية الكائنات (جداول/حزم/عروض جديدة) إلى آخر إصدار دون المساس بالبيانات؛ متكررة التشغيل
  echo "ترقية الكائنات إلى آخر إصدار (لا تمس بياناتك)..."
  printf "@upgrade.sql\n" | sql_erp > "$LOG_DIR/upgrade.log" 2>&1 || true
  if grep -qE 'ORA-[0-9]+|SP2-[0-9]+|PLS-[0-9]+' "$LOG_DIR/upgrade.log"; then
    echo "فشلت الترقية. أول الأخطاء (والسجل الكامل في local/logs/upgrade.log):" >&2
    grep -E 'ORA-[0-9]+|SP2-[0-9]+|PLS-[0-9]+' "$LOG_DIR/upgrade.log" | head -10 >&2
    exit 1
  fi
else
  if [ "$INSTALLED" != "0" ]; then
    echo "حذف كائنات النظام السابقة..."
    printf "@uninstall.sql\n" | sql_erp > "$LOG_DIR/uninstall.log" 2>&1
  fi
  echo "تثبيت المخطط والحزم..."
  printf "@install.sql\n" | sql_erp > "$LOG_DIR/install.log" 2>&1 || true
  if grep -qE "ORA-[0-9]+|SP2-[0-9]+" "$LOG_DIR/install.log"; then
    echo "فشل التثبيت. أول الأخطاء (والسجل الكامل في local/logs/install.log):" >&2
    grep -nE "ORA-[0-9]+|PLS-[0-9]+|SP2-[0-9]+" "$LOG_DIR/install.log" | head -10 >&2
    exit 1
  fi
fi

echo "فحص ما بعد التثبيت..."
printf "@check_install.sql\n" | sql_erp > "$LOG_DIR/check.log" 2>&1
tail -3 "$LOG_DIR/check.log" | grep -E "كائنات ERP|لا أخطاء" || true
if ! grep -q "لا أخطاء" "$LOG_DIR/check.log"; then
  echo "توجد كائنات غير صالحة أو أخطاء تجميع. راجع local/logs/check.log" >&2
  exit 1
fi

# الاختبار الذاتي مصمَّم لقاعدة فارغة (يقارن بأرصدة مطلقة) فيفشل زوراً إن وُجدت بيانات؛ يتراجع عن كل شيء فلا يمس بياناتك، لكن نتخطاه عندها
ENTRIES="$(printf 'SET HEADING OFF FEEDBACK OFF PAGESIZE 0\nSELECT COUNT(*) FROM erp_entries;\n' | sql_erp | tr -d '[:space:]')"
if [ "$RUN_TEST" -eq 1 ] && [ "$FORCE_TEST" -eq 0 ] && [ "${ENTRIES:-0}" != "0" ]; then
  echo "تخطّي الاختبار الذاتي: القاعدة تحوي بيانات ($ENTRIES قيداً) والاختبار مصمَّم لقاعدة فارغة. للتشغيل رغم ذلك: --force-test"
  RUN_TEST=0
fi
if [ "$RUN_TEST" -eq 1 ]; then
  echo "الاختبار الذاتي (يتراجع عن كل بياناته)..."
  printf "SET SERVEROUTPUT ON SIZE UNLIMITED\nSET LINESIZE 300\n@sql/15_selftest.sql\n" | sql_erp > "$LOG_DIR/selftest.log" 2>&1 || true
  SUMMARY="$(grep -E '^---- ' "$LOG_DIR/selftest.log" | tail -1 || true)"
  echo "${SUMMARY:-لم يكتمل الاختبار: راجع local/logs/selftest.log}"
  if ! echo "$SUMMARY" | grep -q "فشل 0"; then
    grep -E '^FAIL|ORA-|PLS-' "$LOG_DIR/selftest.log" | head -10 >&2 || true
    echo "أرسل لي local/logs/selftest.log لأصلح ما فشل." >&2
    exit 1
  fi
fi

cat <<MSG

تم. قاعدة البيانات تعمل الآن على جهازك:
  الخدمة  : localhost:$PORT/$SVC
  المستخدم: erp_owner
  كلمة السر: في الملف local/.env
  سلسلة الاتصال لـ SQL Developer / Forms:  //localhost:$PORT/$SVC
  الدخول بـ SQL*Plus:  docker exec -it $NAME sqlplus erp_owner@//localhost/$SVC
  الإيقاف: docker stop $NAME     ·  التشغيل: docker start $NAME
MSG

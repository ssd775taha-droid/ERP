#!/usr/bin/env bash
# استعادة نسخة احتياطية (ملف .dmp من backup.sh): **تحذف كل بيانات النظام الحالية** ثم تستورد النسخة.
# الاستخدام: ./local/restore.sh /path/erp_YYYYMMDD-HHMMSS.dmp [--yes]
set -euo pipefail
FILE="${1:-}"; YES="${2:-}"
[ -f "$FILE" ] || { echo "الاستخدام: restore.sh ملف.dmp [--yes]" >&2; exit 2; }
NAME="${ERP_ORACLE_NAME:-erp-oracle}"
WEB="${ERP_WEB_NAME:-erp-web}"
PW="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$NAME" | sed -n 's/^APP_USER_PASSWORD=//p' | head -1)"
[ -n "$PW" ] || { echo "تعذّر قراءة كلمة سر القاعدة من الحاوية $NAME" >&2; exit 1; }
if [ "$YES" != "--yes" ]; then
  echo "تحذير: ستُحذف كل بيانات النظام الحالية وتُستبدل بمحتوى $FILE"
  read -r -p "للمتابعة اكتب RESTORE: " ans; [ "$ans" = "RESTORE" ] || { echo "أُلغيت الاستعادة"; exit 1; }
fi
docker start "$NAME" >/dev/null 2>&1 || true
DIR="$(printf "SET HEADING OFF FEEDBACK OFF PAGESIZE 0\nALTER SESSION SET CONTAINER = XEPDB1;\nGRANT READ, WRITE ON DIRECTORY DATA_PUMP_DIR TO erp_owner;\nSELECT directory_path FROM dba_directories WHERE directory_name = 'DATA_PUMP_DIR';\n" \
  | docker exec -i "$NAME" sqlplus -s / as sysdba | grep '^/' | head -1 | tr -d '\r')"
B="$(basename "$FILE")"
# نسخة أمان قبل الحذف
echo "نسخة أمان قبل الاستعادة..."
"$(dirname "${BASH_SOURCE[0]}")/backup.sh" "$(dirname "$FILE")/before-restore" >/dev/null
docker stop "$WEB" >/dev/null 2>&1 || true
docker cp "$FILE" "$NAME:$DIR/$B"
docker exec -u root "$NAME" chown oracle:oinstall "$DIR/$B" 2>/dev/null || true
echo "حذف الكائنات الحالية..."
docker exec -i "$NAME" sqlplus -s "erp_owner/$PW@//localhost/XEPDB1" >/dev/null <<'SQL'
SET SERVEROUTPUT OFF
BEGIN
  FOR v IN (SELECT view_name n FROM user_views) LOOP EXECUTE IMMEDIATE 'DROP VIEW ' || v.n; END LOOP;
  FOR p IN (SELECT object_name n, object_type t FROM user_objects WHERE object_type IN ('PACKAGE','FUNCTION','PROCEDURE')) LOOP EXECUTE IMMEDIATE 'DROP ' || p.t || ' ' || p.n; END LOOP;
  FOR t IN (SELECT table_name n FROM user_tables) LOOP EXECUTE IMMEDIATE 'DROP TABLE ' || t.n || ' CASCADE CONSTRAINTS PURGE'; END LOOP;
  FOR y IN (SELECT object_name n FROM user_objects WHERE object_type = 'TYPE' ORDER BY created DESC) LOOP BEGIN EXECUTE IMMEDIATE 'DROP TYPE ' || y.n || ' FORCE'; EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP;
  FOR s IN (SELECT sequence_name n FROM user_sequences) LOOP EXECUTE IMMEDIATE 'DROP SEQUENCE ' || s.n; END LOOP;
END;
/
SQL
echo "استيراد النسخة..."
if ! docker exec "$NAME" impdp "erp_owner/$PW@//localhost/XEPDB1" schemas=erp_owner directory=DATA_PUMP_DIR dumpfile="$B" logfile="restore_$B.log" >/tmp/impdp.out 2>&1; then
  grep -E "ORA-|UDI-" /tmp/impdp.out | head -10 >&2
fi
docker exec "$NAME" rm -f "$DIR/$B" "$DIR/restore_$B.log" || true
INVALID="$(printf "SET HEADING OFF FEEDBACK OFF PAGESIZE 0\nSELECT COUNT(*) FROM user_objects WHERE status = 'INVALID';\n" | docker exec -i "$NAME" sqlplus -s "erp_owner/$PW@//localhost/XEPDB1" | tr -d '[:space:]')"
if [ "${INVALID:-0}" != "0" ]; then
  printf "BEGIN DBMS_UTILITY.COMPILE_SCHEMA(USER, FALSE); END;\n/\n" | docker exec -i "$NAME" sqlplus -s "erp_owner/$PW@//localhost/XEPDB1" >/dev/null || true
fi
docker start "$WEB" >/dev/null 2>&1 || true
echo "تمت الاستعادة من $B. نسخة الأمان السابقة في $(dirname "$FILE")/before-restore"

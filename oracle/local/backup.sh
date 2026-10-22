#!/usr/bin/env bash
# نسخة احتياطية كاملة لمخطط erp_owner (كل بيانات النظام ومستخدمي الواجهة) بـ Data Pump، تُنسخ إلى مجلد على جهازك.
# الاستخدام: ./local/backup.sh [مجلد الإخراج]   (الافتراضي ~/ERP-Backups)   · يحتفظ بآخر 30 نسخة
# متغيرات: ERP_ORACLE_NAME (erp-oracle)
set -euo pipefail
NAME="${ERP_ORACLE_NAME:-erp-oracle}"
OUT="${1:-$HOME/ERP-Backups}"
KEEP=30
mkdir -p "$OUT"

PW="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$NAME" | sed -n 's/^APP_USER_PASSWORD=//p' | head -1)"
[ -n "$PW" ] || { echo "تعذّر قراءة كلمة سر القاعدة من الحاوية $NAME (هل هي موجودة وتعمل؟)" >&2; exit 1; }
docker start "$NAME" >/dev/null 2>&1 || true

DIR="$(printf "SET HEADING OFF FEEDBACK OFF PAGESIZE 0\nALTER SESSION SET CONTAINER = XEPDB1;\nGRANT READ, WRITE ON DIRECTORY DATA_PUMP_DIR TO erp_owner;\nSELECT directory_path FROM dba_directories WHERE directory_name = 'DATA_PUMP_DIR';\n" \
  | docker exec -i "$NAME" sqlplus -s / as sysdba | grep '^/' | head -1 | tr -d '\r')"
[ -n "$DIR" ] || { echo "تعذّر تحديد مجلد Data Pump في القاعدة" >&2; exit 1; }

F="erp_$(date +%Y%m%d-%H%M%S)"
echo "تصدير القاعدة..."
if ! docker exec "$NAME" expdp "erp_owner/$PW@//localhost/XEPDB1" schemas=erp_owner directory=DATA_PUMP_DIR dumpfile="$F.dmp" logfile="$F.log" reuse_dumpfiles=y >"$OUT/.last-expdp.txt" 2>&1; then
  tail -15 "$OUT/.last-expdp.txt" >&2; echo "فشل التصدير (التفاصيل أعلاه)" >&2; exit 1
fi
docker cp "$NAME:$DIR/$F.dmp" "$OUT/$F.dmp"
docker cp "$NAME:$DIR/$F.log" "$OUT/$F.log" 2>/dev/null || true
docker exec "$NAME" rm -f "$DIR/$F.dmp" "$DIR/$F.log" || true
rm -f "$OUT/.last-expdp.txt"
# الاحتفاظ بآخر $KEEP نسخة فقط
ls -1t "$OUT"/erp_*.dmp 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old" "${old%.dmp}.log"; done
SIZE="$(du -h "$OUT/$F.dmp" | cut -f1)"
echo "تمت النسخة الاحتياطية: $OUT/$F.dmp ($SIZE)"

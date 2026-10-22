# استعادة نسخة احتياطية (ملف .dmp من backup.ps1): **تحذف كل بيانات النظام الحالية** ثم تستورد النسخة.
# الاستخدام:  .\restore.ps1 -File C:\path\erp_YYYYMMDD-HHMMSS.dmp [-Yes]
param([Parameter(Mandatory = $true)][string]$File, [switch]$Yes)
$ErrorActionPreference = 'Continue'
$Name = if ($env:ERP_ORACLE_NAME) { $env:ERP_ORACLE_NAME } else { 'erp-oracle' }
$Web = if ($env:ERP_WEB_NAME) { $env:ERP_WEB_NAME } else { 'erp-web' }
function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }
if (-not (Test-Path $File)) { Fail "الملف غير موجود: $File" }
$File = (Resolve-Path $File).Path
$B = Split-Path $File -Leaf
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$l = docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $Name 2>$null | Where-Object { $_ -like 'APP_USER_PASSWORD=*' } | Select-Object -First 1
if ($null -eq $l) { Fail "تعذّر قراءة كلمة سر القاعدة من الحاوية $Name" }
$Pw = $l.Substring('APP_USER_PASSWORD='.Length).Trim()

if (-not $Yes) {
  Write-Host "تحذير: ستُحذف كل بيانات النظام الحالية وتُستبدل بمحتوى $File" -ForegroundColor Yellow
  $a = Read-Host 'للمتابعة اكتب RESTORE'
  if ($a -ne 'RESTORE') { Write-Host 'أُلغيت الاستعادة'; exit 1 }
}
docker start $Name 2>$null | Out-Null
$q = "SET HEADING OFF FEEDBACK OFF PAGESIZE 0`nALTER SESSION SET CONTAINER = XEPDB1;`nGRANT READ, WRITE ON DIRECTORY DATA_PUMP_DIR TO erp_owner;`nSELECT directory_path FROM dba_directories WHERE directory_name = 'DATA_PUMP_DIR';`n"
$Dir = ($q | docker exec -i $Name sqlplus -s '/ as sysdba' | Where-Object { $_ -match '^/' } | Select-Object -First 1)
if (-not $Dir) { Fail 'تعذّر تحديد مجلد Data Pump في القاعدة' }
$Dir = $Dir.Trim()

Write-Host 'نسخة أمان قبل الاستعادة...'
$safe = Join-Path (Split-Path -Parent $File) 'before-restore'
& (Join-Path $here 'backup.ps1') -OutDir $safe | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'فشلت نسخة الأمان؛ لم يُحذف شيء' }

docker stop $Web 2>$null | Out-Null
docker cp $File "${Name}:${Dir}/$B" | Out-Null
docker exec -u root $Name chown oracle:oinstall "$Dir/$B" 2>$null | Out-Null

Write-Host 'حذف الكائنات الحالية...'
$drop = @'
SET SERVEROUTPUT OFF
BEGIN
  FOR v IN (SELECT view_name n FROM user_views) LOOP EXECUTE IMMEDIATE 'DROP VIEW ' || v.n; END LOOP;
  FOR p IN (SELECT object_name n, object_type t FROM user_objects WHERE object_type IN ('PACKAGE','FUNCTION','PROCEDURE')) LOOP EXECUTE IMMEDIATE 'DROP ' || p.t || ' ' || p.n; END LOOP;
  FOR t IN (SELECT table_name n FROM user_tables) LOOP EXECUTE IMMEDIATE 'DROP TABLE ' || t.n || ' CASCADE CONSTRAINTS PURGE'; END LOOP;
  FOR y IN (SELECT object_name n FROM user_objects WHERE object_type = 'TYPE' ORDER BY created DESC) LOOP BEGIN EXECUTE IMMEDIATE 'DROP TYPE ' || y.n || ' FORCE'; EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP;
  FOR s IN (SELECT sequence_name n FROM user_sequences) LOOP EXECUTE IMMEDIATE 'DROP SEQUENCE ' || s.n; END LOOP;
END;
/
'@
$drop | docker exec -i $Name sqlplus -s "erp_owner/$Pw@//localhost/XEPDB1" | Out-Null

Write-Host 'استيراد النسخة...'
$out = docker exec $Name impdp "erp_owner/$Pw@//localhost/XEPDB1" schemas=erp_owner directory=DATA_PUMP_DIR dumpfile="$B" logfile="restore_$B.log" 2>&1
$out | Where-Object { $_ -match 'ORA-|UDI-' } | Select-Object -First 10 | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
docker exec $Name rm -f "$Dir/$B" "$Dir/restore_$B.log" 2>$null | Out-Null

$inv = ("SET HEADING OFF FEEDBACK OFF PAGESIZE 0`nSELECT COUNT(*) FROM user_objects WHERE status = 'INVALID';`n" | docker exec -i $Name sqlplus -s "erp_owner/$Pw@//localhost/XEPDB1" | Out-String).Trim()
if ($inv -ne '0') { "BEGIN DBMS_UTILITY.COMPILE_SCHEMA(USER, FALSE); END;`n/`n" | docker exec -i $Name sqlplus -s "erp_owner/$Pw@//localhost/XEPDB1" | Out-Null }
docker start $Web 2>$null | Out-Null
Write-Host "تمت الاستعادة من $B. نسخة الأمان السابقة في $safe" -ForegroundColor Green

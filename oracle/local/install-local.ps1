# تثبيت نظام ERP (Oracle) على جهازك بأمر واحد باستخدام Docker Desktop (ويندوز PowerShell).
#   .\local\install-local.ps1              تثبيت كامل: قاعدة Oracle XE + المخطط + الحزم + اختبار ذاتي
#   .\local\install-local.ps1 -Reinstall   يحذف كائنات النظام ويعيد تثبيتها (يحذف البيانات)
#   .\local\install-local.ps1 -NoTest      بلا الاختبار الذاتي
# متغيرات بيئة اختيارية: ERP_ORACLE_IMAGE · ERP_ORACLE_NAME · ERP_ORACLE_PORT (الافتراضي 1521)
# إن مُنع تنفيذ السكربتات:  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
param([switch]$Reinstall, [switch]$NoTest)

# Continue وليس Stop: Windows PowerShell 5.1 يحوّل stderr لأوامر docker إلى أخطاء قاطعة إن استُخدم 2>&1 مع Stop
$ErrorActionPreference = 'Continue'
$OracleDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Image = if ($env:ERP_ORACLE_IMAGE) { $env:ERP_ORACLE_IMAGE } else { 'gvenzl/oracle-xe:21-slim' }
$Name  = if ($env:ERP_ORACLE_NAME)  { $env:ERP_ORACLE_NAME }  else { 'erp-oracle' }
$Port  = if ($env:ERP_ORACLE_PORT)  { $env:ERP_ORACLE_PORT }  else { '1521' }
$EnvFile = Join-Path $OracleDir 'local\.env'
$LogDir  = Join-Path $OracleDir 'local\logs'
$Svc = 'XEPDB1'

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker غير مثبّت. ثبّت Docker Desktop أولاً.' }
# docker version يفشل فقط إن لم يستجب المحرّك، ونطبع رسالته الحقيقية لنعرف السبب
$serverVer = (docker version --format '{{.Server.Version}}' 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $serverVer) {
  Write-Host "رسالة Docker:`n$serverVer" -ForegroundColor Yellow
  Fail 'المحرّك (Engine) في Docker Desktop لا يستجيب. انتظر حتى يظهر في أسفل يسار نافذته «Engine running» باللون الأخضر ثم أعد المحاولة. راجع قسم «Docker لا يستجيب» في local\README_LOCAL.md'
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# كلمة السر: تُولَّد مرة واحدة وتُحفظ (أحرف وأرقام فقط)
if (-not (Test-Path $EnvFile)) {
  $chars = (48..57) + (65..90) + (97..122)
  $pw = (-join ($chars | Get-Random -Count 14 | ForEach-Object { [char]$_ })) + 'A1'
  Set-Content -Path $EnvFile -Value "ERP_DB_PASSWORD=$pw" -Encoding ascii
  Write-Host 'أُنشئت كلمة سر لقاعدة البيانات في local\.env'
}
$Pw = ((Get-Content $EnvFile | Where-Object { $_ -like 'ERP_DB_PASSWORD=*' }) -split '=', 2)[1].Trim()

# --- الحاوية ---
$exists = docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $Name }
if ($exists) {
  # حاوية من تثبيت سابق (ربما من مجلد آخر): كلمة سر قاعدتها مخزَّنة في إعداداتها، فنستعيدها بدل الاعتماد على ملف .env جديد
  $cpw = (docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $Name | Where-Object { $_ -like 'APP_USER_PASSWORD=*' } | Select-Object -First 1)
  if ($cpw) { $cpw = $cpw.Substring('APP_USER_PASSWORD='.Length).Trim() }
  if ($cpw -and $cpw -ne $Pw) {
    Set-Content -Path $EnvFile -Value "ERP_DB_PASSWORD=$cpw" -Encoding ascii
    $Pw = $cpw
    Write-Host 'استُعيدت كلمة سر القاعدة من الحاوية الموجودة إلى local\.env'
  }
  docker start $Name | Out-Null
  # إن كان مجلد التثبيت السابق (المربوط بالحاوية) قد حُذف فنعيد إنشاء الحاوية على المجلد الحالي، والبيانات في وحدة التخزين تبقى
  docker exec $Name test -f /erp/check_install.sql 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'مجلد التثبيت السابق غير موجود: إعادة إنشاء الحاوية (البيانات محفوظة)'
    docker stop $Name | Out-Null
    docker rm $Name | Out-Null
    $exists = $null
  }
}
if ($exists) {
  Write-Host "تشغيل الحاوية الموجودة: $Name"
} else {
  Write-Host "سحب الصورة وتشغيل الحاوية (أول مرة قد تستغرق عدة دقائق): $Image"
  docker run -d --name $Name -p "${Port}:1521" `
    -e "ORACLE_PASSWORD=$Pw" -e APP_USER=erp_owner -e "APP_USER_PASSWORD=$Pw" `
    -v "${OracleDir}:/erp:ro" -v "${Name}-data:/opt/oracle/oradata" $Image | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'فشل تشغيل الحاوية. إن ظهر خطأ 429 من Docker Hub فجرّب: $env:ERP_ORACLE_IMAGE="mirror.gcr.io/gvenzl/oracle-xe:21-slim"' }
}

Write-Host -NoNewline 'انتظار جاهزية قاعدة البيانات'
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
  if ((docker logs $Name 2>&1 | Select-String -SimpleMatch 'DATABASE IS READY TO USE')) { $ready = $true; break }
  Write-Host -NoNewline '.'; Start-Sleep -Seconds 5
}
if (-not $ready) { Fail "`nانتهت المهلة. راجع: docker logs $Name" }
Write-Host ' — جاهزة'

# أوامر SQL*Plus داخل الحاوية (النصوص المرسلة ASCII فقط فلا مشكلة ترميز)
function Sql-Erp([string]$script) {
  $script | docker exec -i -e NLS_LANG=.AL32UTF8 $Name bash -c "cd /erp && sqlplus -s erp_owner/${Pw}@//localhost/${Svc}"
}
function Sql-Sys([string]$script) { $script | docker exec -i $Name sqlplus -s '/ as sysdba' }

Sql-Sys "ALTER SESSION SET CONTAINER = XEPDB1;`nGRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, CREATE PROCEDURE, CREATE TYPE, CREATE TRIGGER, UNLIMITED TABLESPACE TO erp_owner;" | Out-Null

$installed = (Sql-Erp "SET HEADING OFF FEEDBACK OFF PAGESIZE 0`nSELECT COUNT(*) FROM user_tables WHERE table_name = 'ERP_ACCOUNTS';" | Out-String).Trim()
if ($installed -ne '0' -and -not $Reinstall) {
  Write-Host 'النظام مثبَّت مسبقاً. لإعادة التثبيت من الصفر (يحذف البيانات): .\local\install-local.ps1 -Reinstall'
} else {
  if ($installed -ne '0') {
    Write-Host 'حذف كائنات النظام السابقة...'
    Sql-Erp '@uninstall.sql' | Out-File -Encoding utf8 (Join-Path $LogDir 'uninstall.log')
  }
  Write-Host 'تثبيت المخطط والحزم...'
  Sql-Erp '@install.sql' | Out-File -Encoding utf8 (Join-Path $LogDir 'install.log')
  $errs = Select-String -Path (Join-Path $LogDir 'install.log') -Pattern 'ORA-\d+|SP2-\d+|PLS-\d+'
  if ($errs) {
    Write-Host 'فشل التثبيت. أول الأخطاء (والسجل الكامل في local\logs\install.log):' -ForegroundColor Red
    $errs | Select-Object -First 10 | ForEach-Object { $_.Line }
    exit 1
  }
}

Write-Host 'فحص ما بعد التثبيت...'
Sql-Erp '@check_install.sql' | Out-File -Encoding utf8 (Join-Path $LogDir 'check.log')
if (-not (Select-String -Path (Join-Path $LogDir 'check.log') -SimpleMatch 'CHECK_RESULT=OK' -Quiet)) {
  Select-String -Path (Join-Path $LogDir 'check.log') -Pattern 'ORA-|SP2-|PLS-|INVALID' | Select-Object -First 8 | ForEach-Object { Write-Host $_.Line -ForegroundColor Yellow }
  Fail 'توجد كائنات غير صالحة أو أخطاء تجميع أو تعذّر الاتصال بالقاعدة. راجع local\logs\check.log'
}

if (-not $NoTest) {
  Write-Host 'الاختبار الذاتي (يتراجع عن كل بياناته)...'
  Sql-Erp "SET SERVEROUTPUT ON SIZE UNLIMITED`nSET LINESIZE 300`n@sql/15_selftest.sql" | Out-File -Encoding utf8 (Join-Path $LogDir 'selftest.log')
  $summary = Select-String -Path (Join-Path $LogDir 'selftest.log') -Pattern '^RESULT pass=' | Select-Object -Last 1
  if ($summary) { Write-Host $summary.Line } else { Write-Host 'لم يكتمل الاختبار: راجع local\logs\selftest.log' }
  if (-not $summary -or $summary.Line -notmatch 'fail=0') {
    Select-String -Path (Join-Path $LogDir 'selftest.log') -Pattern '^FAIL|ORA-|PLS-' | Select-Object -First 10 | ForEach-Object { $_.Line }
    Fail 'أرسل لي local\logs\selftest.log لأصلح ما فشل.'
  }
}

Write-Host @"

تم. قاعدة البيانات تعمل الآن على جهازك:
  الخدمة  : localhost:$Port/$Svc
  المستخدم: erp_owner
  كلمة السر: في الملف local\.env
  سلسلة الاتصال لـ SQL Developer / Forms:  //localhost:$Port/$Svc
  الدخول بـ SQL*Plus:  docker exec -it $Name sqlplus erp_owner@//localhost/$Svc
  الإيقاف: docker stop $Name     ·  التشغيل: docker start $Name
"@

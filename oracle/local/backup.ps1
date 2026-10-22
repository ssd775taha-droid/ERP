# نسخة احتياطية كاملة لمخطط erp_owner (كل بيانات النظام ومستخدمي الواجهة) بـ Data Pump، تُنسخ إلى مجلد على جهازك.
# الاستخدام:  .\backup.ps1 [-OutDir مجلد]   (الافتراضي: المستندات\ERP-Backups)   · يحتفظ بآخر 30 نسخة
param([string]$OutDir = (Join-Path $HOME 'ERP-Backups'))
$ErrorActionPreference = 'Continue'
$Name = if ($env:ERP_ORACLE_NAME) { $env:ERP_ORACLE_NAME } else { 'erp-oracle' }
$Keep = 30
function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }

docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Docker لا يعمل. شغّل Docker Desktop أولاً.' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$l = docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $Name 2>$null | Where-Object { $_ -like 'APP_USER_PASSWORD=*' } | Select-Object -First 1
if ($null -eq $l) { Fail "تعذّر قراءة كلمة سر القاعدة من الحاوية $Name (هل هي موجودة؟)" }
$Pw = $l.Substring('APP_USER_PASSWORD='.Length).Trim()
docker start $Name 2>$null | Out-Null

$q = "SET HEADING OFF FEEDBACK OFF PAGESIZE 0`nALTER SESSION SET CONTAINER = XEPDB1;`nGRANT READ, WRITE ON DIRECTORY DATA_PUMP_DIR TO erp_owner;`nSELECT directory_path FROM dba_directories WHERE directory_name = 'DATA_PUMP_DIR';`n"
$Dir = ($q | docker exec -i $Name sqlplus -s '/ as sysdba' | Where-Object { $_ -match '^/' } | Select-Object -First 1)
if (-not $Dir) { Fail 'تعذّر تحديد مجلد Data Pump في القاعدة' }
$Dir = $Dir.Trim()

$F = 'erp_' + (Get-Date -Format 'yyyyMMdd-HHmmss')
Write-Host 'تصدير القاعدة...'
$log = docker exec $Name expdp "erp_owner/$Pw@//localhost/XEPDB1" schemas=erp_owner directory=DATA_PUMP_DIR dumpfile="$F.dmp" logfile="$F.log" reuse_dumpfiles=y 2>&1
if ($LASTEXITCODE -ne 0) { $log | Select-Object -Last 15 | ForEach-Object { Write-Host $_ }; Fail 'فشل التصدير (التفاصيل أعلاه)' }
docker cp "${Name}:${Dir}/$F.dmp" (Join-Path $OutDir "$F.dmp") | Out-Null
docker cp "${Name}:${Dir}/$F.log" (Join-Path $OutDir "$F.log") 2>$null | Out-Null
docker exec $Name rm -f "$Dir/$F.dmp" "$Dir/$F.log" 2>$null | Out-Null
if (-not (Test-Path (Join-Path $OutDir "$F.dmp"))) { Fail 'لم يُنسخ ملف النسخة الاحتياطية إلى جهازك' }

# الاحتفاظ بآخر نسخ فقط
Get-ChildItem $OutDir -Filter 'erp_*.dmp' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | ForEach-Object {
  Remove-Item $_.FullName -Force; Remove-Item ($_.FullName -replace '\.dmp$', '.log') -Force -ErrorAction SilentlyContinue }
$mb = [math]::Round((Get-Item (Join-Path $OutDir "$F.dmp")).Length / 1MB, 1)
Write-Host "تمت النسخة الاحتياطية: $(Join-Path $OutDir "$F.dmp") ($mb MB)" -ForegroundColor Green

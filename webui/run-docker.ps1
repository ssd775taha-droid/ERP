# تشغيل واجهة الويب داخل Docker على ويندوز (لا يلزم تثبيت Node).
# المتطلب: قاعدة البيانات تعمل (oracle\local\install-local.ps1) وملف oracle\local\.env موجود.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$name = if ($env:ERP_WEB_NAME) { $env:ERP_WEB_NAME } else { 'erp-web' }
$port = if ($env:ERP_WEB_PORT) { $env:ERP_WEB_PORT } else { '3001' }
$dbport = if ($env:ERP_ORACLE_PORT) { $env:ERP_ORACLE_PORT } else { '1521' }
$envf = '.env-docker'
$dbenv = '..\oracle\local\.env'

function New-Rand($n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }

if (-not (Test-Path $envf)) {
  if (-not (Test-Path $dbenv)) { Write-Host "لا يوجد $dbenv : ثبّت قاعدة البيانات أولاً"; exit 1 }
  $l = Get-Content $dbenv | Where-Object { $_ -match '^ERP_DB_PASSWORD=' } | Select-Object -First 1
  $dbpw = if ($null -eq $l) { '' } else { ($l -replace '^ERP_DB_PASSWORD=', '').Trim() }
  $webpw = New-Rand 12
  $lines = @('ERP_DB_USER=erp_owner', "ERP_DB_PASSWORD=$dbpw", "ERP_DB_CONNECT=host.docker.internal:$dbport/XEPDB1",
             'ERP_WEB_USER=admin', "ERP_WEB_PASSWORD=$webpw", "ERP_WEB_SECRET=$(New-Rand 40)")
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $envf), (($lines -join "`n") + "`n"))   # UTF-8 بلا BOM ونهايات LF (docker --env-file)
  Write-Host "أُنشئ $envf — كلمة سر الدخول: $webpw"
}

# كلمة سر القاعدة الحقيقية تُؤخذ من حاوية Oracle نفسها (قد تكون ثُبّتت من مجلد آخر بكلمة سر مختلفة)، وتُكتب في ملف الإعداد كل تشغيل
function Set-EnvVal($file, $name, $value) {
  $lines = @(Get-Content $file | Where-Object { $_ -and ($_ -notlike "$name=*") })
  $lines += "$name=$value"
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $file), (($lines -join "`n") + "`n"))
}
function Get-EnvVal($file, $name) {
  $l = Get-Content $file | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
  if ($null -eq $l) { return '' }
  return ($l -replace "^$name=", '').Trim()
}

$dbname = if ($env:ERP_ORACLE_NAME) { $env:ERP_ORACLE_NAME } else { 'erp-oracle' }
$real = (docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $dbname 2>$null | Where-Object { $_ -like 'APP_USER_PASSWORD=*' } | Select-Object -First 1)
if ($real) { $real = $real.Substring('APP_USER_PASSWORD='.Length).Trim() }
if ($real -and $real -ne (Get-EnvVal $envf 'ERP_DB_PASSWORD')) {
  Set-EnvVal $envf 'ERP_DB_PASSWORD' $real
  Write-Host "حُدّثت كلمة سر القاعدة في $envf من الحاوية $dbname"
}
# الاتصال بحاوية القاعدة مباشرة عبر شبكة Docker داخلية (لا يمر بمنفذ الجهاز 1521، فقد يشغله مستمع Oracle آخر لا يعرف XEPDB1)
$net = 'erp-net'
$useNet = $false
if ($real) {
  docker network inspect $net 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { docker network create $net | Out-Null }
  docker network connect $net $dbname 2>$null | Out-Null   # خطأ «متصل مسبقاً» متوقع ويُتجاهل
  $useNet = $true
  Set-EnvVal $envf 'ERP_DB_CONNECT' "${dbname}:1521/XEPDB1"
} else {
  Write-Host "تنبيه: لا حاوية $dbname؛ سيتصل بمنفذ الجهاز $dbport (قد يفشل إن شغله برنامج آخر)" -ForegroundColor Yellow
  Set-EnvVal $envf 'ERP_DB_CONNECT' "host.docker.internal:${dbport}/XEPDB1"
}
if (-not (Get-EnvVal $envf 'ERP_DB_PASSWORD')) {
  Write-Host "كلمة سر القاعدة غير معروفة: لا حاوية باسم $dbname ولا كلمة سر في $envf. ثبّت القاعدة أولاً (oracle\local\install-local.ps1) أو ضع ERP_DB_PASSWORD في الملف." -ForegroundColor Red
  exit 1
}

docker build -t erp-web .
if ($LASTEXITCODE -ne 0) { Write-Host 'فشل بناء الصورة'; exit 1 }
docker rm -f $name 2>$null | Out-Null
$netArg = if ($useNet) { @('--network', $net) } else { @() }
docker run -d --name $name --restart unless-stopped @netArg --env-file $envf -e ERP_WEB_HOST=0.0.0.0 -p "127.0.0.1:${port}:3001" erp-web | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'فشل تشغيل الحاوية'; exit 1 }
# انتظر جاهزية الواجهة والقاعدة؛ إن فشلت اعرض السبب الحقيقي من سجل الحاوية
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://localhost:$port/healthz"; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { }
}
if ($ok) {
  Write-Host "تعمل الواجهة على http://localhost:$port  (المستخدم: admin، كلمة السر في $envf)" -ForegroundColor Green
} else {
  Write-Host 'الواجهة لم تصبح جاهزة. آخر سطور سجل الحاوية:' -ForegroundColor Red
  docker logs --tail 15 $name 2>&1 | ForEach-Object { Write-Host $_ }
  exit 1
}

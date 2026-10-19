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
  $dbpw = ((Get-Content $dbenv | Where-Object { $_ -match '^ERP_DB_PASSWORD=' } | Select-Object -First 1) -replace '^ERP_DB_PASSWORD=', '').Trim()
  $webpw = New-Rand 12
  $lines = @('ERP_DB_USER=erp_owner', "ERP_DB_PASSWORD=$dbpw", "ERP_DB_CONNECT=host.docker.internal:$dbport/XEPDB1",
             'ERP_WEB_USER=admin', "ERP_WEB_PASSWORD=$webpw", "ERP_WEB_SECRET=$(New-Rand 40)")
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $envf), (($lines -join "`n") + "`n"))   # UTF-8 بلا BOM ونهايات LF (docker --env-file)
  Write-Host "أُنشئ $envf — كلمة سر الدخول: $webpw"
}

# كلمة سر القاعدة الحقيقية تُؤخذ من حاوية Oracle نفسها (قد تكون ثُبّتت من مجلد آخر بكلمة سر مختلفة)، وتُحدَّث في ملف الإعداد كل تشغيل
$dbname = if ($env:ERP_ORACLE_NAME) { $env:ERP_ORACLE_NAME } else { 'erp-oracle' }
$real = (docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $dbname 2>$null | Where-Object { $_ -like 'APP_USER_PASSWORD=*' } | Select-Object -First 1)
if ($real) {
  $real = $real.Substring('APP_USER_PASSWORD='.Length).Trim()
  $cur = ((Get-Content $envf | Where-Object { $_ -like 'ERP_DB_PASSWORD=*' } | Select-Object -First 1) -replace '^ERP_DB_PASSWORD=', '').Trim()
  if ($real -and $real -ne $cur) {
    $new = (Get-Content $envf) | ForEach-Object { if ($_ -like 'ERP_DB_PASSWORD=*') { "ERP_DB_PASSWORD=$real" } else { $_ } }
    [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot $envf), (($new -join "`n") + "`n"))
    Write-Host "حُدّثت كلمة سر القاعدة في $envf من الحاوية $dbname"
  }
} else { Write-Host "تنبيه: لم أجد الحاوية $dbname لقراءة كلمة سر القاعدة؛ أُستخدم ما في الملف" -ForegroundColor Yellow }

docker build -t erp-web .
if ($LASTEXITCODE -ne 0) { Write-Host 'فشل بناء الصورة'; exit 1 }
docker rm -f $name 2>$null | Out-Null
docker run -d --name $name --restart unless-stopped --env-file $envf -e ERP_WEB_HOST=0.0.0.0 -p "127.0.0.1:${port}:3001" erp-web | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'فشل تشغيل الحاوية'; exit 1 }
Write-Host "تعمل الواجهة على http://localhost:$port  (المستخدم: admin، كلمة السر في $envf)"

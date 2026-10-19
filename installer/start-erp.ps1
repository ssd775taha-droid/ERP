# تشغيل النظام بعد إعادة تشغيل الجهاز: يشغّل حاويتي القاعدة والواجهة ثم يفتح المتصفح.
$ErrorActionPreference = 'Continue'
docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'شغّل Docker Desktop أولاً ثم أعد المحاولة.' -ForegroundColor Red; Read-Host 'Enter'; exit 1 }
docker start erp-oracle | Out-Null
docker start erp-web | Out-Null
Write-Host 'بانتظار جاهزية القاعدة...'
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 3
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 http://localhost:3001/healthz; if ($r.StatusCode -eq 200) { break } } catch { }
}
Start-Process 'http://localhost:3001'

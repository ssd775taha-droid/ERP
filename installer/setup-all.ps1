# يُشغَّل من مثبّت .exe: يثبّت قاعدة Oracle ثم واجهة الويب ويفتح المتصفح. ينتظر ضغطة مفتاح في النهاية ليقرأ المستخدم النتيجة.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
function Stop-Msg($m) { Write-Host $m -ForegroundColor Red; Read-Host 'اضغط Enter للإغلاق'; exit 1 }

docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Stop-Msg 'Docker Desktop غير مثبّت أو لا يعمل. ثبّته من docker.com وشغّله، ثم شغّل "ERP Setup" من قائمة ابدأ.'
}

Write-Host '== 1/2 تثبيت قاعدة البيانات (قد يستغرق 10-15 دقيقة أول مرة) ==' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'oracle\local\install-local.ps1')
if ($LASTEXITCODE -ne 0) { Stop-Msg 'فشل تثبيت قاعدة البيانات. راجع الرسائل أعلاه ومجلد oracle\local\logs.' }

Write-Host '== 2/2 تشغيل واجهة الويب ==' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'webui\run-docker.ps1')
if ($LASTEXITCODE -ne 0) { Stop-Msg 'فشل تشغيل واجهة الويب.' }

Start-Sleep -Seconds 3
Start-Process 'http://localhost:3001'
Write-Host ''
Write-Host 'تم. المستخدم: admin، وكلمة السر في الملف:' (Join-Path $root 'webui\.env-docker') -ForegroundColor Green
Read-Host 'اضغط Enter للإغلاق'

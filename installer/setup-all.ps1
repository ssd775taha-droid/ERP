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

# إتاحة السيرفر لأجهزة الشبكة: قاعدة جدار ناري للمنفذ 3001 (يطلب ويندوز إذن المسؤول؛ يمكن تجاهله إن كان السيرفر لجهاز واحد)
if (-not (Get-NetFirewallRule -DisplayName 'ERP Server 3001' -ErrorAction SilentlyContinue)) {
  Write-Host 'فتح المنفذ 3001 في الجدار الناري ليتصل العملاء (اقبل نافذة إذن المسؤول)...' -ForegroundColor Cyan
  try { Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "New-NetFirewallRule -DisplayName ''ERP Server 3001'' -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private,Domain | Out-Null"' } catch { Write-Host 'لم تُفتح قاعدة الجدار الناري: الأجهزة الأخرى لن تتصل حتى تفتحها من «ERP Server address» في قائمة ابدأ.' -ForegroundColor Yellow }
}
Start-Sleep -Seconds 3
Start-Process 'http://localhost:3001'
Write-Host ''
Write-Host 'تم. لعرض اسم المستخدم وكلمة السر لاحقاً: قائمة ابدأ ← ERP ← ERP Password' -ForegroundColor Green
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'show-password.ps1')
Write-Host 'عناوين السيرفر للعملاء ونقاط البيع: قائمة ابدأ ← ERP ← ERP Server address' -ForegroundColor Cyan
Read-Host 'اضغط Enter للإغلاق'

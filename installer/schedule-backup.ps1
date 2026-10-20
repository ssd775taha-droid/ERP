# يفعّل نسخة احتياطية يومية تلقائية (الساعة 23:30) عبر جدولة ويندوز، أو يلغيها. تتطلب أن يكون Docker Desktop يعمل.
$ErrorActionPreference = 'Continue'
$task = 'ERP Daily Backup'
$exists = (schtasks /Query /TN $task 2>$null) -ne $null -and $LASTEXITCODE -eq 0
Write-Host ($(if ($exists) { 'النسخة اليومية مفعّلة حالياً.' } else { 'النسخة اليومية غير مفعّلة.' }))
$a = Read-Host 'اكتب on للتفعيل أو off للإلغاء (أو Enter للخروج)'
$script = Join-Path $PSScriptRoot 'oracle\local\backup.ps1'
if ($a -eq 'on') {
  $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""
  schtasks /Create /F /SC DAILY /ST 23:30 /TN $task /TR $cmd | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host 'فُعّلت: نسخة يومية 23:30 إلى المستندات\ERP-Backups (آخر 30 نسخة).' -ForegroundColor Green } else { Write-Host 'تعذّر إنشاء المهمة المجدولة.' -ForegroundColor Red }
} elseif ($a -eq 'off') {
  schtasks /Delete /F /TN $task | Out-Null
  Write-Host 'أُلغيت النسخة اليومية.'
}
Read-Host 'اضغط Enter للإغلاق'

# نسخة احتياطية الآن إلى المستندات\ERP-Backups ثم يفتح المجلد.
$ErrorActionPreference = 'Continue'
$out = Join-Path $HOME 'ERP-Backups'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'oracle\local\backup.ps1') -OutDir $out
if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) { Start-Process explorer.exe $out }
Read-Host 'اضغط Enter للإغلاق'

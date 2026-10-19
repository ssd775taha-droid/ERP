# يعرض بيانات الدخول إلى واجهة الويب، وينسخ كلمة السر إلى الحافظة، ويتيح توليد كلمة سر جديدة.
$ErrorActionPreference = 'Continue'
$envf = Join-Path $PSScriptRoot 'webui\.env-docker'
function Get-Val($name) { ((Get-Content $envf | Where-Object { $_ -like "$name=*" } | Select-Object -First 1) -replace "^$name=", '').Trim() }

if (-not (Test-Path $envf)) {
  Write-Host 'لا يوجد ملف كلمة السر بعد: لم يكتمل تثبيت واجهة الويب. شغّل "ERP Setup (reinstall)" من قائمة ابدأ.' -ForegroundColor Red
  Read-Host 'Enter'; exit 1
}
$user = Get-Val 'ERP_WEB_USER'; $pw = Get-Val 'ERP_WEB_PASSWORD'
Write-Host ''
Write-Host "الرابط        : http://localhost:3001"
Write-Host "اسم المستخدم  : $user"
Write-Host "كلمة السر     : $pw"
try { Set-Clipboard -Value $pw; Write-Host '(نُسخت كلمة السر إلى الحافظة: الصقها بـ Ctrl+V)' -ForegroundColor Green } catch { }
Write-Host ''
$a = Read-Host 'لتوليد كلمة سر جديدة اكتب y ثم Enter (أو Enter للخروج)'
if ($a -eq 'y') {
  Remove-Item $envf -Force
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'webui\run-docker.ps1')
  Read-Host 'Enter للإغلاق'
}

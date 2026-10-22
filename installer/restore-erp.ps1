# استعادة نسخة احتياطية: يختار الملف من نافذة، ثم يطلب كتابة RESTORE للتأكيد.
$ErrorActionPreference = 'Continue'
$file = $null
try {
  Add-Type -AssemblyName System.Windows.Forms
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Title = 'اختر ملف النسخة الاحتياطية (erp_*.dmp)'
  $d.Filter = 'نسخة ERP (*.dmp)|*.dmp'
  $d.InitialDirectory = (Join-Path $HOME 'ERP-Backups')
  if ($d.ShowDialog() -eq 'OK') { $file = $d.FileName }
} catch { }
if (-not $file) { $file = Read-Host 'اكتب مسار ملف النسخة الاحتياطية (.dmp)' }
if (-not $file) { exit 1 }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'oracle\local\restore.ps1') -File $file
Read-Host 'اضغط Enter للإغلاق'

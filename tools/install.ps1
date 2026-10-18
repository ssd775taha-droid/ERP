# تثبيت cleanup-old-files على Windows (بدون صلاحيات مدير)
# التشغيل:  powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = "Stop"
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) { Write-Host "يلزم تثبيت Python 3 أولاً: https://www.python.org/downloads/"; exit 1 }

$src = Join-Path $PSScriptRoot "cleanup_old_files.py"
$dir = Join-Path $env:LOCALAPPDATA "cleanup-old-files"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item $src (Join-Path $dir "cleanup_old_files.py") -Force

$cmd = "@echo off`r`n`"$($py.Source)`" `"%~dp0cleanup_old_files.py`" %*`r`n"
Set-Content -Path (Join-Path $dir "cleanup-old-files.cmd") -Value $cmd -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
}
Write-Host "تم التثبيت في: $dir"
Write-Host "افتح نافذة PowerShell جديدة ثم جرّب:  cleanup-old-files `$HOME\Downloads --since 2024-01-01"

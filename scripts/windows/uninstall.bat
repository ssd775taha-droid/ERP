@echo off
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Startup')+'\TamamPro.lnk') -ErrorAction SilentlyContinue"
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
echo DONE. Auto-start removed. Your data folder is kept.
pause

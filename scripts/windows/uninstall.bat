@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TamamPro.vbs" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TamamPro.lnk" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
echo DONE. Auto-start removed. Your data folder is kept.
pause

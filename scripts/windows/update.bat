@echo off
cd /d "%~dp0..\.."
where git >nul 2>&1
if errorlevel 1 goto nogit
git pull
call npm install --omit=dev
set "LV=%~dp0launch.vbs"
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
start "" wscript.exe "%LV%"
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo DONE. Updated. Your data folder was not touched.
pause
exit /b 0
:nogit
echo Git is not installed. Download the new version and copy server, scripts and public over the old ones (not the data folder).
pause
exit /b 1

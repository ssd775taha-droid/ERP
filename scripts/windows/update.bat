@echo off
cd /d "%~dp0..\.."
where git >nul 2>&1
if errorlevel 1 goto nogit
git pull
call npm install --omit=dev
set "ST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TamamPro.vbs"
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
wscript.exe "%ST%"
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo DONE. Updated. Your data folder was not touched.
pause
exit /b 0
:nogit
echo Git is not installed. Download the new version and copy server, scripts and public over the old ones (not the data folder).
pause
exit /b 1

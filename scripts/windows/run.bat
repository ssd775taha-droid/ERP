@echo off
rem Runs the app (and tunnel if cloudflared exists), restarting if it stops. Started at Windows logon.
cd /d "%~dp0..\.."
:loop
node scripts\share.js >> data\server.log 2>&1
if %errorlevel%==3 exit /b 3
timeout /t 10 /nobreak >nul
goto loop

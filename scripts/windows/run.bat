@echo off
rem Runs the app (and tunnel if cloudflared exists), restarting if it stops. Started at Windows logon.
cd /d "%~dp0..\.."
if not exist data mkdir data
echo %date% %time% run.bat started >> data\startup.log
:loop
node scripts\share.js >> data\server.log 2>&1
if %errorlevel%==3 exit /b 3
ping -n 11 127.0.0.1 >nul
goto loop

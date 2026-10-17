@echo off
rem Runs the app and tunnel, restarting them if they stop. Started by the Windows logon task.
cd /d "%~dp0..\.."
:loop
node scripts\share.js >> data\server.log 2>&1
timeout /t 10 /nobreak >nul
goto loop

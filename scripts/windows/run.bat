@echo off
rem Runs the app (and tunnel if cloudflared exists), restarting if it stops. Started at Windows logon.
cd /d "%~dp0..\.."
if not exist data mkdir data
echo %date% %time% run.bat started user=%USERNAME% dir=%CD% >> data\startup.log
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul && (echo %date% %time% already running, exiting >> data\startup.log & exit /b 0)
where node >> data\startup.log 2>&1
:loop
echo %date% %time% starting node >> data\startup.log
node scripts\share.js >> data\server.log 2>&1
set "RC=%errorlevel%"
echo %date% %time% node exited code %RC% >> data\startup.log
if "%RC%"=="3" exit /b 3
ping -n 11 127.0.0.1 >nul
goto loop

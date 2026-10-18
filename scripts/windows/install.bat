@echo off
cd /d "%~dp0..\.."
if not exist data mkdir data
where node >nul 2>&1
if errorlevel 1 goto nonode
where docker >nul 2>&1
if errorlevel 1 goto nodocker
if not exist node_modules call npm install --omit=dev
set "RB=%~dp0run.bat"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ST=%STARTUP%\TamamPro.vbs"
rem Auto-start at Windows logon: a tiny VBS file in the Startup folder runs run.bat hidden
> "%ST%" echo Set sh = CreateObject("WScript.Shell")
>> "%ST%" echo sh.Run """%RB%""", 0, False
if not exist "%ST%" goto nostartup
rem Second method: Windows scheduled task at logon (more reliable than the Startup folder alone)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-task.ps1" -Vbs "%ST%"
if errorlevel 1 echo WARNING: scheduled task could not be created (the Startup file is still in place).
rem Desktop shortcut
> "%USERPROFILE%\Desktop\TamamPro.url" echo [InternetShortcut]
>> "%USERPROFILE%\Desktop\TamamPro.url" echo URL=http://localhost:3000
powercfg /change standby-timeout-ac 0 >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
wscript.exe "%ST%"
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo.
echo DONE. Tamam Pro runs in the background and starts by itself when you sign in to Windows.
echo Auto-start file: %ST%
echo Open it from the TamamPro shortcut on your Desktop or http://localhost:3000
pause
exit /b 0
:nonode
echo Node.js is not installed. Install it from https://nodejs.org then run this file again.
pause
exit /b 1
:nodocker
echo Docker Desktop is not installed. The database now runs via Docker.
echo Install it from https://www.docker.com/products/docker-desktop/ then run this file again.
pause
exit /b 1
:nostartup
echo FAILED to create the auto-start file: %ST%
pause
exit /b 1

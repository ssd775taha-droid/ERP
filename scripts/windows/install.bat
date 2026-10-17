@echo off
cd /d "%~dp0..\.."
if not exist data mkdir data
where node >nul 2>&1
if errorlevel 1 goto nonode
if not exist node_modules call npm install --omit=dev
set "LV=%~dp0launch.vbs"
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut([Environment]::GetFolderPath('Startup')+'\TamamPro.lnk'); $l.TargetPath='wscript.exe'; $l.Arguments='\"'+$env:LV+'\"'; $l.Save(); $d=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\TamamPro.url'); $d.TargetPath='http://localhost:3000'; $d.Save()"
powercfg /change standby-timeout-ac 0 >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
start "" wscript.exe "%LV%"
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo.
echo DONE. Tamam Pro now runs in the background and starts with Windows.
echo Open it from the TamamPro shortcut on your Desktop or http://localhost:3000
pause
exit /b 0
:nonode
echo Node.js is not installed. Install it from https://nodejs.org then run this file again.
pause
exit /b 1

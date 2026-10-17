@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
where git >nul 2>&1 || (echo Git غير مثبّت. حمّل النسخة الجديدة يدويًا وانسخ مجلدات server وscripts وpublic فوق القديمة دون مجلد data. & pause & exit /b 1)
git pull || (echo تعذّر التحديث & pause & exit /b 1)
call npm install --omit=dev || (pause & exit /b 1)
schtasks /end /tn "TamamPro" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
schtasks /run /tn "TamamPro" >nul
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo تم التحديث. بياناتك في مجلد data لم تتغيّر.
pause

@echo off
chcp 65001 >nul
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Startup')+'\TamamPro.lnk') -ErrorAction SilentlyContinue"
schtasks /end /tn "TamamPro" >nul 2>&1
schtasks /delete /tn "TamamPro" /f >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
echo تم إيقاف التشغيل التلقائي وإلغاؤه. (بياناتك في مجلد data ما زالت محفوظة)
pause

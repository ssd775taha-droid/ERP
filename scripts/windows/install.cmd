@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist data mkdir data
where node >nul 2>&1 || (echo Node غير مثبّت. ثبّته من nodejs.org ثم أعد التشغيل. & pause & exit /b 1)
if not exist node_modules call npm install --omit=dev || (pause & exit /b 1)
set "LV=%~dp0launch.vbs"
rem تشغيل تلقائي مع ويندوز: اختصار في مجلد Startup (لا يحتاج صلاحيات مدير ويتحمل المسافات في المسار)
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut([Environment]::GetFolderPath('Startup')+'\TamamPro.lnk'); $l.TargetPath='wscript.exe'; $l.Arguments='\"'+$env:LV+'\"'; $l.Save(); $d=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\TamamPro.url'); $d.TargetPath='http://localhost:3000'; $d.Save()" || (echo تعذّر إنشاء الاختصارات & pause & exit /b 1)
rem منع سكون الجهاز أثناء الشحن حتى يبقى الموقع شغّالًا
powercfg /change standby-timeout-ac 0 >nul
taskkill /f /im node.exe >nul 2>&1
start "" wscript.exe "%LV%"
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo.
echo تم التثبيت. المنصة تعمل في الخلفية وتبدأ وحدها مع كل تشغيل لويندوز.
echo افتحها من الاختصار TamamPro على سطح المكتب، أو من http://localhost:3000
echo للتحديث لاحقًا: update.cmd. للإلغاء: uninstall.cmd
echo (اختياري: لرابط عام للموظفين خارج المكتب ثبّت cloudflared ثم أعد تشغيل الجهاز)
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist data mkdir data
where node >nul 2>&1 || (echo Node غير مثبّت. ثبّته من nodejs.org ثم أعد التشغيل. & pause & exit /b 1)
where cloudflared >nul 2>&1 || (echo cloudflared غير مثبّت. نفّذ: winget install Cloudflare.cloudflared ثم افتح نافذة جديدة. & pause & exit /b 1)
if not exist node_modules call npm install --omit=dev || (pause & exit /b 1)
schtasks /create /tn "TamamPro" /tr "wscript.exe \"%~dp0launch.vbs\"" /sc onlogon /f >nul || (echo تعذّر إنشاء المهمة & pause & exit /b 1)
rem منع سكون الجهاز أثناء الشحن حتى يبقى الموقع شغّالًا
powercfg /change standby-timeout-ac 0 >nul
schtasks /run /tn "TamamPro" >nul
echo.
echo تم التثبيت. المنصة تعمل الآن في الخلفية وتبدأ تلقائيًا مع كل تسجيل دخول لويندوز.
echo انتظر نحو 15 ثانية ثم اقرأ الرابط من الملف: data\public-url.txt  (أو سجل data\server.log)
echo لإلغاء التشغيل التلقائي شغّل uninstall.cmd
pause

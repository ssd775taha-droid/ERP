@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist data mkdir data
where node >nul 2>&1 || (echo Node غير مثبّت. ثبّته من nodejs.org ثم أعد التشغيل. & pause & exit /b 1)
if not exist node_modules call npm install --omit=dev || (pause & exit /b 1)
schtasks /create /tn "TamamPro" /tr "wscript.exe \"%~dp0launch.vbs\"" /sc onlogon /f >nul || (echo تعذّر إنشاء المهمة & pause & exit /b 1)
rem منع سكون الجهاز أثناء الشحن حتى يبقى الموقع شغّالًا
powercfg /change standby-timeout-ac 0 >nul
rem اختصار على سطح المكتب يفتح المنصة في المتصفح
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\TamamPro.url'); $s.TargetPath='http://localhost:3000'; $s.Save()" >nul 2>&1
schtasks /run /tn "TamamPro" >nul
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo.
echo تم التثبيت. المنصة تعمل في الخلفية وتبدأ وحدها مع كل تشغيل لويندوز.
echo افتحها من الاختصار TamamPro على سطح المكتب، أو من http://localhost:3000
echo لن تحتاج إلى cmd بعد الآن. للتحديث: انقر مرتين على update.cmd. للإلغاء: uninstall.cmd
echo (اختياري: لرابط عام للموظفين خارج المكتب ثبّت cloudflared ثم أعد تشغيل الجهاز)
pause

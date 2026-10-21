; مثبّت السيرفر (NSIS): قاعدة Oracle + واجهة الويب + إتاحتها لأجهزة الشبكة (العميل ونقاط البيع لهما مثبّتاهما). يُبنى بـ: makensis erp-setup.nsi  (المتغير STAGE = مجلد الملفات المجهّزة)
Unicode true
!define APP "ERP"
!define VER "0.37.0"
Name "${APP} Server ${VER}"
OutFile "ERP-Server-Setup.exe"
InstallDir "$LOCALAPPDATA\ERP"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON "${ICONDIR}\server.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"
  ; لوحة تحكم السيرفر (برنامج سطح مكتب): ERP-Server.exe داخل panel بجوار oracle وwebui
  SetOutPath "$INSTDIR\panel"
  File /r "${DIST}\*.*"
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\ERP"
  CreateShortcut "$SMPROGRAMS\ERP\Start ERP.lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\start-erp.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\Stop ERP.lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\stop-erp.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\ERP Password.lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\show-password.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\ERP Backup now.lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\backup-erp.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\ERP Restore backup.lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\restore-erp.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\ERP Daily backup (on-off).lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\schedule-backup.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\ERP Setup (reinstall).lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\setup-all.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\ERP Server address (for clients).lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\server-info.ps1"' "" 0
  CreateShortcut "$SMPROGRAMS\ERP\ERP Server.lnk" "$INSTDIR\panel\ERP-Server.exe" "" "$INSTDIR\panel\server.ico" 0
  CreateShortcut "$DESKTOP\ERP Server.lnk" "$INSTDIR\panel\ERP-Server.exe" "" "$INSTDIR\panel\server.ico" 0
  Delete "$DESKTOP\ERP.lnk"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERP" "DisplayName" "ERP"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERP" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERP" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  ; تثبيت قاعدة البيانات والواجهة في نافذة ظاهرة ليرى المستخدم التقدم
  DetailPrint "Installing database and web interface (a console window will open)..."
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\setup-all.ps1"' $0
  DetailPrint "Setup script exit code: $0"
  Exec '"$INSTDIR\panel\ERP-Server.exe"'
SectionEnd

Section "Uninstall"
  MessageBox MB_YESNO "Also delete the ERP containers (the DATABASE and all accounting data)?$\r$\nChoose No to keep your data." IDNO keepdata
    ExecWait 'docker rm -f erp-web erp-oracle'
  keepdata:
  Delete "$DESKTOP\ERP.lnk"
  Delete "$DESKTOP\ERP Server.lnk"
  RMDir /r "$SMPROGRAMS\ERP"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ERP"
  RMDir /r "$INSTDIR"
SectionEnd

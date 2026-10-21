; مثبّت برنامج العميل أو نقطة البيع (NSIS): برنامج سطح مكتب (Electron) مستقل يتصل بالسيرفر عبر الشبكة، بلا قاعدة بيانات ولا Docker.
; يُبنى مرتين:  makensis -DMODE=client erp-client.nsi   و   makensis -DMODE=pos erp-client.nsi   (DIST = مجلد البرنامج المجهّز)
Unicode true
!ifndef MODE
  !define MODE "client"
!endif
!define VER "0.35.1"
!if "${MODE}" == "pos"
  !define APP "ERP POS"
  !define DIRNAME "ERP-POS"
  !define OUT "ERP-POS-Setup.exe"
  !define EXE "ERP-POS.exe"
  !define ICO "pos.ico"
!else
  !define APP "ERP Client"
  !define DIRNAME "ERP-Client"
  !define OUT "ERP-Client-Setup.exe"
  !define EXE "ERP-Client.exe"
  !define ICO "client.ico"
!endif
Name "${APP} ${VER}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\${DIRNAME}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON "${ICONDIR}\${ICO}"
Var Dlg
Var Edit
Var Addr
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom AddrPage AddrLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function AddrPage
  nsDialogs::Create 1018
  Pop $Dlg
  ${NSD_CreateLabel} 0 0 100% 36u "Server address (optional). Leave it EMPTY to find the server automatically on first run.$\r$\nOr type it, e.g. 192.168.1.10 or localhost if the server is on this PC (shown in the ERP Server program)."
  Pop $0
  ${NSD_CreateText} 0 44u 100% 12u ""
  Pop $Edit
  nsDialogs::Show
FunctionEnd

Function AddrLeave
  ${NSD_GetText} $Edit $Addr
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${DIST}\*.*"
  ${If} $Addr != ""
    FileOpen $0 "$INSTDIR\server.txt" w
    FileWrite $0 "$Addr"
    FileClose $0
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${ICO}" 0
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${ICO}" 0
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "DisplayName" "${APP}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}" "DisplayIcon" "$INSTDIR\${ICO}"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${DIRNAME}"
  RMDir /r "$LOCALAPPDATA\${DIRNAME}"
  RMDir /r "$APPDATA\erp-${MODE}"
SectionEnd

#!/usr/bin/env bash
# يبني ثلاثة مثبّتات على لينكس (يلزم nsis وunzip وcurl): ERP-Server-Setup.exe وERP-Client-Setup.exe وERP-POS-Setup.exe.
# الملفات تُؤخذ من آخر إيداع. برامج سطح المكتب (Electron) تُحزَّم من ملفات Electron الجاهزة لويندوز (تُنزَّل مرة وتُخزَّن في .cache).
set -euo pipefail
cd "$(dirname "$0")"
EV=33.2.0
CACHE="$PWD/.cache"; mkdir -p "$CACHE"
ZIP="$CACHE/electron-v$EV-win32-x64.zip"
[ -s "$ZIP" ] || curl -fL -o "$ZIP" "https://github.com/electron/electron/releases/download/v$EV/electron-v$EV-win32-x64.zip"
S="$(mktemp -d)"; D="$(mktemp -d)"
git archive HEAD ../oracle ../webui 2>/dev/null | tar -x -C "$S" || (cd .. && git archive HEAD oracle webui | tar -x -C "$S")
rm -rf "$S/webui/test"; cp *.ps1 "$S/"
ICONS="$(cd ../desktop/icons && pwd)"
# dist NAME EXE APPDIR ICON : ينسخ Electron بعد حذف اللغات غير اللازمة ويضع التطبيق في resources/app
dist() {
  local out="$D/$1"; mkdir -p "$out"; unzip -q "$ZIP" -d "$out"
  mv "$out/electron.exe" "$out/$2"; rm -f "$out/LICENSES.chromium.html"
  find "$out/locales" -name '*.pak' ! -name 'en-US.pak' ! -name 'ar.pak' -delete
  rm -rf "$out/resources/default_app.asar"; mkdir -p "$out/resources/app"; cp -r "../desktop/$3/." "$out/resources/app/"
  cp "$ICONS/$4" "$out/"
}
dist server ERP-Server.exe server server.ico
dist client ERP-Client.exe client client.ico
dist pos ERP-POS.exe client pos.ico
printf '{ "mode": "pos", "title": "ERP — نقطة البيع", "id": "erp-pos" }\n' > "$D/pos/resources/app/product.json"
cp "$ICONS/pos.png" "$D/pos/resources/app/icon.png"
makensis -V2 -DSTAGE="$S" -DDIST="$D/server" -DICONDIR="$ICONS" erp-server.nsi
makensis -V2 -DDIST="$D/client" -DICONDIR="$ICONS" -DMODE=client erp-client.nsi
makensis -V2 -DDIST="$D/pos" -DICONDIR="$ICONS" -DMODE=pos erp-client.nsi
rm -rf "$S" "$D"; rm -f ERP-Setup.exe
ls -la ERP-*-Setup.exe

#!/usr/bin/env bash
# يبني ثلاثة مثبّتات على لينكس (يلزم nsis: apt install nsis): ERP-Server-Setup.exe وERP-Client-Setup.exe وERP-POS-Setup.exe. الملفات تُؤخذ من آخر إيداع.
set -euo pipefail
cd "$(dirname "$0")"
S="$(mktemp -d)"
git archive HEAD ../oracle ../webui 2>/dev/null | tar -x -C "$S" || (cd .. && git archive HEAD oracle webui | tar -x -C "$S")
rm -rf "$S/webui/test"; cp *.ps1 "$S/"
makensis -V2 -DSTAGE="$S" erp-server.nsi
makensis -V2 -DSTAGE="$S" -DMODE=client erp-client.nsi
makensis -V2 -DSTAGE="$S" -DMODE=pos erp-client.nsi
rm -f ERP-Setup.exe
ls -la ERP-*-Setup.exe

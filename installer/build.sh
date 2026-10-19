#!/usr/bin/env bash
# يبني ERP-Setup.exe على لينكس (يلزم nsis: apt install nsis). الملفات تُؤخذ من آخر إيداع.
set -euo pipefail
cd "$(dirname "$0")"
S="$(mktemp -d)"
git archive HEAD ../oracle ../webui 2>/dev/null | tar -x -C "$S" || (cd .. && git archive HEAD oracle webui | tar -x -C "$S")
rm -rf "$S/webui/test"; cp *.ps1 "$S/"
makensis -V2 -DSTAGE="$S" erp-setup.nsi
echo "تم: $(pwd)/ERP-Setup.exe"

#!/bin/sh
# تثبيت cleanup-old-files على Linux / macOS (بدون صلاحيات مدير)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v python3 >/dev/null 2>&1 || { echo "يلزم تثبيت Python 3 أولاً: https://www.python.org/downloads/"; exit 1; }

INSTALL_DIR="$HOME/.local/share/cleanup-old-files"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
cp "$DIR/cleanup_old_files.py" "$INSTALL_DIR/cleanup_old_files.py"

cat > "$BIN_DIR/cleanup-old-files" <<EOF
#!/bin/sh
exec python3 "$INSTALL_DIR/cleanup_old_files.py" "\$@"
EOF
chmod +x "$BIN_DIR/cleanup-old-files"

echo "تم التثبيت: $BIN_DIR/cleanup-old-files"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "أضف هذا السطر إلى ~/.bashrc أو ~/.zshrc ثم افتح طرفية جديدة:"
     echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
echo "جرّب: cleanup-old-files ~/Downloads --since 2024-01-01"

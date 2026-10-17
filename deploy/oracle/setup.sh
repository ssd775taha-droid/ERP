#!/usr/bin/env bash
# يُشغَّل على خادم Ubuntu جديد (Oracle Always Free): bash setup.sh [ANTHROPIC_API_KEY]
set -euo pipefail
REPO=https://github.com/ssd775taha-droid/ERP.git
DIR=$HOME/erp

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# فتح المنفذين 80 و443 في جدار Ubuntu (يجب فتحهما أيضًا في قائمة الأمان في لوحة Oracle)
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

[ -d "$DIR" ] && git -C "$DIR" pull -q || git clone -q "$REPO" "$DIR"
cd "$DIR/deploy/oracle"

IP=$(curl -fsS https://api.ipify.org)
DOMAIN=${DOMAIN:-${IP//./-}.sslip.io}
printf 'DOMAIN=%s\nANTHROPIC_API_KEY=%s\n' "$DOMAIN" "${1:-}" > .env
chmod 600 .env

sudo docker compose up -d --build
echo "تم. افتح: https://$DOMAIN (أول زيارة تنشئ حساب المالك)"

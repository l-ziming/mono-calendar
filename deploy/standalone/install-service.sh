#!/usr/bin/env bash
set -euo pipefail
# Standalone install without Home Assistant Apps: run as root on a Debian-based Linux host after copying the repository there.
if [[ "$(uname -s)" != Linux || "$(id -u)" != 0 ]]; then
  echo 'Run as root on Linux' >&2
  exit 1
fi
here="$(cd "$(dirname "$0")" && pwd)"
source_dir="$(cd "$here/../../ha-app" && pwd)"
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
id mono-calendar >/dev/null 2>&1 || useradd --system --home-dir /opt/mono-calendar --shell /usr/sbin/nologin mono-calendar
install -d -m 755 /opt/mono-calendar
rm -rf /opt/mono-calendar/server.new
cp -R "$source_dir/server" /opt/mono-calendar/server.new
chmod -R u=rwX,go=rX /opt/mono-calendar/server.new
rm -rf /opt/mono-calendar/server && mv /opt/mono-calendar/server.new /opt/mono-calendar/server
if [[ ! -f /etc/mono-calendar.json ]]; then
  install -m 640 -o root -g mono-calendar "$source_dir/config.example.json" /etc/mono-calendar.json
fi
if [[ ! -f /etc/mono-calendar.env ]]; then
  umask 077
  cp "$here/.env.example" /etc/mono-calendar.env
  token="$(openssl rand -hex 24)"
  sed -i "s/^DISPLAY_TOKEN=$/DISPLAY_TOKEN=$token/" /etc/mono-calendar.env
fi
install -m 644 "$here/mono-calendar.service" /etc/systemd/system/mono-calendar.service
systemctl daemon-reload
echo 'Installed. Fill HA_TOKEN in /etc/mono-calendar.env and entity IDs in /etc/mono-calendar.json.'
echo 'Then run: systemctl enable --now mono-calendar'

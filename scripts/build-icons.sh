#!/usr/bin/env bash
# Regenerates every copy of the logo from design/icon/logo.svg, the only source:
# the RP1 launcher icons, the Home Assistant store icon and the logo inlined in the chat page.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:?Set JAVA_HOME (JDK 17+)}"
logo=design/icon/logo.svg
res=android/res
classes=$(mktemp -d)
trap 'rm -rf "$classes"' EXIT
"$JAVA_HOME/bin/javac" -nowarn -encoding UTF-8 -d "$classes" android/src/dev/monocalendar/rp1/{Ink,Svg}.java scripts/IconRender.java
"$JAVA_HOME/bin/java" -Djava.awt.headless=true -Dcrop=9 -cp "$classes" IconRender "$logo" \
  48:$res/mipmap-mdpi/ic_launcher.png 72:$res/mipmap-hdpi/ic_launcher.png 96:$res/mipmap-xhdpi/ic_launcher.png \
  144:$res/mipmap-xxhdpi/ic_launcher.png 192:$res/mipmap-xxxhdpi/ic_launcher.png
"$JAVA_HOME/bin/java" -Djava.awt.headless=true -cp "$classes" IconRender "$logo" 128:ha-app/icon.png
# The chat page inlines the SVG so it stays sharp at any zoom; the stylesheet rounds its corners.
node - "$logo" ha-app/server/chat.html <<'JS'
const fs = require('node:fs');
const [logo, page] = process.argv.slice(2);
const svg = fs.readFileSync(logo, 'utf8');
const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
const shapes = svg.match(/<(?:rect|path)\b[^>]*\/>/g).map((shape) => '              ' + shape.replace(/\s*\/>$/, ' />'));
const inline = `<svg class="logo" viewBox="${viewBox}" aria-hidden="true">\n${shapes.join('\n')}</svg\n            >`;
const html = fs.readFileSync(page, 'utf8');
const next = html.replace(/<svg class="logo"[\s\S]*?<\/svg\s*>/, inline);
if (next === html && !html.includes(inline)) throw new Error('chat.html has no <svg class="logo"> to replace');
if (next.replace(/\s+/g, ' ') !== html.replace(/\s+/g, ' ')) fs.writeFileSync(page, next);
JS
echo "Icons regenerated from $logo"

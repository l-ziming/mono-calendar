#!/usr/bin/env bash
# Local checks only: fake Home Assistant, no device, no paid model call.
set -euo pipefail
cd "$(dirname "$0")/.."
check_mode="${1:-}"
if [[ $# -gt 1 || ( -n "$check_mode" && "$check_mode" != --node-only ) ]]; then
  echo "Usage: $0 [--node-only]" >&2
  exit 2
fi
mkdir -p output
# Every Home Assistant app test, in a stable order; new tests are picked up automatically.
find tests/ha-app -name '*.mjs' | sort | while read -r test; do
  node "$test"
done
if [[ "$check_mode" == --node-only ]]; then
  exit 0
fi
python3 tests/android/android-policy.py
# Desktop render of the RP1 page (same Page.java as the APK) from the design's sample data.
jdk="${JAVA_HOME:-}/bin"
if [[ -n "${JAVA_HOME:-}" && -x "$jdk/javac" ]]; then
  classes=$(mktemp -d)
  trap 'rm -rf "$classes"' EXIT
  "$jdk/javac" -nowarn -encoding UTF-8 --release 8 -d "$classes" android/src/dev/monocalendar/rp1/{Ink,Svg,Json,Almanac,AlmanacNotes,Page}.java tests/android/PageRender.java 2>/dev/null
  "$jdk/java" -Djava.awt.headless=true -Dproject=. -cp "$classes" PageRender tests/fixtures/sample-data.json docs/images/sample.png
  "$jdk/java" -Djava.awt.headless=true -Dproject=. -Dmenu=armed -cp "$classes" PageRender tests/fixtures/sample-data.json docs/images/sample-menu.png - 15 0 "网络未连接，截至 15:00 已 30 分钟未更新，请充电"
  "$jdk/java" -Djava.awt.headless=true -Dproject=. -cp "$classes" PageRender output/fixture-data.json output/fixture-data.png - 80 1 ""
  "$jdk/java" -Djava.awt.headless=true -Dproject=. -Dcard=宜:嫁娶 -Dicon=android/res/mipmap-xxxhdpi/ic_launcher.png -cp "$classes" PageRender tests/fixtures/sample-data.json docs/images/sample-card.png
  "$jdk/java" -Djava.awt.headless=true -Dproject=. -Dcard=节:立冬 -cp "$classes" PageRender tests/fixtures/sample-data.json docs/images/sample-term.png
  echo "Rendered docs/images/sample.png, sample-menu.png, sample-card.png, sample-term.png and fixture-data.png"
fi

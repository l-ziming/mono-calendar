#!/usr/bin/env bash
# Rebuilds android/assets/fonts from the original font files, trimming the CJK faces to what the page draws.
# The bundled fonts are already in the repository; run this only after changing the page's text or fonts.
#
# Needs Python 3 with fontTools (pip install fonttools; set PYTHON to use another interpreter) and these
# files in fonts-src/ (ignored by git):
#   noto-sans-sc/NotoSansSC-{Regular,Medium,Bold}.otf   Noto Sans CJK SC, notofonts/noto-cjk (Sans/OTF/SimplifiedChinese)
#   noto-sans-sc-variable/NotoSansSC[wght].ttf          google/fonts (ofl/notosanssc); Noto Sans CJK has no static 600
#   noto-serif-sc/NotoSerifSC-{Medium,Bold}.otf, LICENSE  Noto Serif CJK SC 2.003, notofonts/noto-cjk (Serif/SubsetOTF/SC)
#   noto-serif/NotoSerif-Bold.ttf                       notofonts/noto-fonts; only the opening quote U+201C is used
#   inter/Inter-{Regular,Medium,SemiBold,Bold}.ttf      Inter 4.1, rsms/inter (extras/ttf)
set -euo pipefail
cd "$(dirname "$0")/.."
src=fonts-src
out=android/assets/fonts
python="${PYTHON:-python3}"
if ! "$python" -c 'import fontTools' 2>/dev/null; then
  echo "fontTools not found for $python (pip install fonttools)" >&2
  exit 1
fi
subset() {
  "$python" -m fontTools.subset "$@"
}
mkdir -p "$out"
chars=$(mktemp)
semi=$(mktemp -d)
trap 'rm -rf "$chars" "$chars.common" "$semi"' EXIT
# Every non-ASCII character in the App's string literals, plus default device names and symbols.
"$python" - "$chars" <<'PY'
import pathlib, re, sys

text = ''.join(p.read_text('utf-8') for p in pathlib.Path('android/src').rglob('*.java'))
used = set(ch for literal in re.findall(r'"((?:[^"\\]|\\.)*)"', text) for ch in literal if ord(ch) > 127)
used |= set('卧室落地灯屏幕挂灯风扇°～—–…“”µ³₂·％')
used |= set(chr(c) for c in range(0x20, 0x7F))
used |= set(
    ch for ch in pathlib.Path('android/assets/almanac-lists.txt').read_text('utf-8') if ord(ch) > 127
)  # yi/ji words in the term card
pathlib.Path(sys.argv[1]).write_text(''.join(sorted(used)), 'utf-8')
common = ''.join(
    bytes([hi, lo]).decode('gb2312')
    for hi in range(0xB0, 0xD8)
    for lo in range(0xA1, 0xFF)
    if not (hi == 0xD7 and lo > 0xF9)
)
pathlib.Path(sys.argv[1] + '.common').write_text(''.join(sorted(used | set(common))), 'utf-8')
PY
opts=(--layout-features='*' --no-hinting --desubroutinize=false)
subset "$src/noto-serif-sc/NotoSerifSC-Medium.otf" --text-file="$chars" "${opts[@]}" --output-file="$out/NotoSerifSC-Medium.otf"
subset "$src/noto-serif-sc/NotoSerifSC-Bold.otf" --text-file="$chars" "${opts[@]}" --output-file="$out/NotoSerifSC-Bold.otf"
cp "$src/noto-sans-sc/NotoSansSC-Medium.otf" "$out/"   # Default 500 weight also draws arbitrary titles and hints.
subset "$src/noto-sans-sc/NotoSansSC-Bold.otf" --text-file="$chars.common" "${opts[@]}" --output-file="$out/NotoSansSC-Bold.otf"
cp "$src/noto-sans-sc/NotoSansSC-Regular.otf" "$out/"   # Full face: schedule titles and hints are arbitrary text.
"$python" -m fontTools.varLib.instancer "$src/noto-sans-sc-variable/NotoSansSC[wght].ttf" wght=600 -q -o "$semi/NotoSansSC-SemiBold.ttf"
subset "$semi/NotoSansSC-SemiBold.ttf" --text-file="$chars.common" "${opts[@]}" --output-file="$out/NotoSansSC-SemiBold.ttf"
# The design sets Inter with tabular figures (tnum). Bake them into the cmap so every renderer
# (Android 5.1 Paint and the Java2D desktop check) draws the same widths without feature support.
for w in Regular Medium SemiBold Bold; do
  "$python" - "$src/inter/Inter-$w.ttf" "$out/Inter-$w.ttf" <<'PY'
import sys
from fontTools.ttLib import TTFont

font = TTFont(sys.argv[1])
names = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
order = set(font.getGlyphOrder())
for table in font['cmap'].tables:
    if table.isUnicode():
        for i, name in enumerate(names):
            if name + '.tf' in order:
                table.cmap[0x30 + i] = name + '.tf'
font.save(sys.argv[2])
PY
done
cp "$src/noto-serif-sc/LICENSE" "$out/OFL-NotoSerifSC.txt"
subset "$src/noto-serif/NotoSerif-Bold.ttf" --unicodes=U+201C --layout-features='*' --no-hinting --output-file="$out/NotoSerif-Bold.ttf"
ls -la "$out"

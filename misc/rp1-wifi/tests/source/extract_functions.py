#!/usr/bin/env python3
"""Extract the current driver function bodies; no copied implementation in tests."""
from pathlib import Path
import hashlib
import json
import re

BASE = Path(__file__).resolve().parent
SRC = BASE.parent.parent / 'source' / 'wlan_src' / 'mlinux'
OUT = BASE / 'generated'
OUT.mkdir(exist_ok=True)

def extract(raw, name):
    match = re.search(r'(?m)^(?:static inline mlan_status|static inline void|mlan_status|int)\n' + name + r'\(', raw)
    if not match:
        raise ValueError(name)
    start = match.start()
    brace = raw.index('{', match.end())
    depth = 1
    i = brace + 1
    state = None
    while depth:
        if state in ('"', "'"):
            if raw[i] == '\\':
                i += 2
                continue
            if raw[i] == state:
                state = None
        elif state == '/*':
            if raw.startswith('*/', i):
                state = None
                i += 2
                continue
        elif state == '//':
            if raw[i] == '\n':
                state = None
        elif raw.startswith('/*', i) or raw.startswith('//', i):
            state = raw[i:i+2]
            i += 2
            continue
        elif raw[i] in ('"', "'"):
            state = raw[i]
        elif raw[i] == '{':
            depth += 1
        elif raw[i] == '}':
            depth -= 1
        i += 1
    return raw[start:i] + '\n'

manifest = {}
for source, names in {
    'moal_ioctl.c': ['woal_fill_wait_queue', 'woal_wait_ioctl_complete', 'woal_get_wakeup_reason'],
    'moal_shim.c': ['moal_ioctl_complete'],
    'moal_sta_cfg80211.c': ['woal_cfg80211_resume'],
}.items():
    raw = (SRC / source).read_text()
    manifest[source] = hashlib.sha256((SRC / source).read_bytes()).hexdigest()
    for name in names:
        body = extract(raw, name)
        if name == 'woal_get_wakeup_reason':
            body = body.replace('woal_get_wakeup_reason(', 'review_real_get_wakeup_reason(', 1)
        (OUT / (name + '.h')).write_text(body)
raw = (SRC / 'moal_main.h').read_text()
match = re.search(r'(?m)^#define RP1_DIAG\([^\n]+\n(?:.*\\\n)*.*\n', raw)
if not match:
    raise ValueError('RP1_DIAG')
(OUT / 'diagnostic_macro.h').write_text(match[0])
manifest['moal_main.h'] = hashlib.sha256((SRC / 'moal_main.h').read_bytes()).hexdigest()
(OUT / 'source_hashes.json').write_text(json.dumps(manifest, indent=2) + '\n')

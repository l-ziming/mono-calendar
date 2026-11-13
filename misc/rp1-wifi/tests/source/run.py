#!/usr/bin/env python3
"""Compile extracted driver bodies with sanitizers and verify regression controls."""
from pathlib import Path
import os
import resource
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
subprocess.run([sys.executable, str(HERE / 'extract_functions.py')], check=True)
env = dict(os.environ, ASAN_OPTIONS='detect_leaks=0', UBSAN_OPTIONS='halt_on_error=1')


def build_run(folder):
    binary = folder / 'review'
    subprocess.run(['clang', '-std=gnu11', '-g', '-O1', '-Wall', '-Wextra',
                    '-Wno-unused-parameter', '-Wno-unused-variable',
                    '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                    str(folder / 'review.c'), '-o', str(binary)], check=True)
    return subprocess.run([str(binary)], capture_output=True, text=True, env=env)


def omit_failure_cleanup(source):
    start = source.index('if (query_status != MLAN_STATUS_SUCCESS)')
    offset = source.index('goto resume_done;', start)
    return source[:offset] + source[offset:].replace('goto resume_done;', 'return 0;', 1)


with tempfile.TemporaryDirectory(prefix='rp1-wifi-host-') as tmp:
    root = Path(tmp)
    shutil.copy2(HERE / 'review.c', root / 'review.c')
    shutil.copytree(HERE / 'generated', root / 'generated')
    result = build_run(root)
    print(result.stdout, end='')
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)
    output = result.stdout
    mutations = [
        ('missing CMD_TIMEOUT wake', 'moal_ioctl_complete.h',
         lambda s: s.replace('wake_up_interruptible(&wait->wait);',
                             'if (pioctl_req->status_code != MLAN_ERROR_CMD_TIMEOUT) wake_up_interruptible(&wait->wait);', 1),
         'Assertion'),
        ('UAF after timeout detach', 'woal_wait_ioctl_complete.h',
         lambda s: s.replace('spin_unlock_irqrestore(&priv->phandle->driver_lock, flags);',
                             'spin_unlock_irqrestore(&priv->phandle->driver_lock, flags);\nif (!completed) diag_id = req->req_id;', 1),
         'heap-use-after-free'),
        ('resume failure omits cleanup', 'woal_cfg80211_resume.h',
         omit_failure_cleanup,
         'Assertion'),
        ('diagnostic ignores off switch', 'diagnostic_macro.h',
         lambda s: s.replace('if (diagnostic) printk', 'printk'),
         'Assertion'),
    ]
    for label, name, mutate, expected in mutations:
        path = root / 'generated' / name
        original = path.read_text()
        changed = mutate(original)
        assert changed != original, label
        path.write_text(changed)
        result = build_run(root)
        path.write_text(original)
        assert result.returncode != 0 and expected.lower() in result.stderr.lower(), (
            label, result.returncode, result.stdout, result.stderr)
        message = 'PASS negative control detects ' + label
        print(message)
        output += message + '\n'
(HERE / 'last-run.txt').write_text(output)
print('Sanitizers: ASan + UBSan. macOS LSan unsupported; allocation accounting checks all frees.')

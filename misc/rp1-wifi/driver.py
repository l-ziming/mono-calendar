#!/usr/bin/env python3
"""Install or remove the paired Wi-Fi modules through root USB ADB."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time


PACKAGE = Path(__file__).resolve().parent
PROJECT = PACKAGE.parents[1]
REMOTE = '/data/local/tmp/mono-calendar-wifi-patch'
VERSION = 'C509.p2-rp1fix1'
MODULES = ('mlan8897', 'sd8897')
BOOT = '/dev/block/platform/soc.2/by-name/boot'


def checksum(path):
    with path.open('rb') as source:
        return hashlib.sha256(source.read()).hexdigest()


def check_assets():
    hashes = {}
    for line in (PACKAGE / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        path = (PACKAGE / name).resolve()
        if not path.is_relative_to(PACKAGE) or checksum(path) != digest:
            raise RuntimeError('文件校验失败：' + name)
        hashes[name] = digest
    for module in MODULES:
        data = (PACKAGE / 'patched' / (module + '.ko')).read_bytes()
        if b'vermagic=3.14.35 SMP preempt mod_unload ARMv7 ' not in data:
            raise RuntimeError('模块内核版本不匹配：' + module)
        if ('version=' + VERSION).encode() + b'\0' not in data:
            raise RuntimeError('模块补丁版本不匹配：' + module)
    return hashes


class Device:
    def __init__(self, serial):
        self.adb = shutil.which('adb')
        if self.adb is None:
            raise RuntimeError('未找到 adb')
        if not serial:
            output = subprocess.check_output([self.adb, 'devices'], text=True)
            devices = [line.split()[0] for line in output.splitlines()[1:] if line.endswith('\tdevice')]
            if len(devices) != 1:
                raise RuntimeError('请连接一台 RP1，或用 --serial 指定设备')
            serial = devices[0]
        self.serial = serial

    def run(self, *arguments, timeout=60):
        result = subprocess.run(
            [self.adb, '-s', self.serial, *arguments], capture_output=True, text=True, timeout=timeout
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or 'ADB 操作失败')
        return result.stdout.replace('\r', '')

    def shell(self, script, timeout=60):
        # Android 5's legacy shell can return zero even after a remote failure.
        marker = 'MONO_CALENDAR_WIFI_COMMAND_OK'
        command = 'set -eu\n' + script + '\necho ' + marker + '\n'
        output = self.run('shell', 'sh -c ' + shlex.quote(command), timeout=timeout)
        lines = output.rstrip().splitlines()
        if not lines or lines[-1] != marker:
            raise RuntimeError(output.strip() or '设备命令未完成')
        return '\n'.join(lines[:-1]).strip()

    def remote_hash(self, path):
        return self.shell('/system/bin/busybox sha256sum ' + shlex.quote(path)).split()[0]

    def status(self):
        versions = {}
        for module in MODULES:
            path = '/sys/module/' + module + '/version'
            versions[module] = self.shell('if [ -r ' + path + ' ]; then cat ' + path + '; else echo unloaded; fi')
        return {
            'serial': self.serial,
            'boot_id': self.shell('cat /proc/sys/kernel/random/boot_id'),
            'versions': versions,
            'override': self.shell(
                'if [ -d /system/lib/modules ]; then echo present; else echo absent; fi'
            ),
            'system_mount': self.shell("/system/bin/busybox awk '$2 == \"/system\" {print $4}' /proc/mounts"),
            'system_block_ro': self.shell('/system/bin/busybox blockdev --getro /dev/block/mmcblk0p9'),
            'wifi_enabled': self.shell('settings get global wifi_on') == '1',
        }

    def preflight(self, hashes):
        if not self.shell('id').startswith('uid=0('):
            raise RuntimeError('需要 root ADB')
        if self.shell('getprop ro.product.model') != 'DPT-RP1':
            raise RuntimeError('这份补丁只用于 DPT-RP1')
        if self.shell('/system/bin/busybox uname -r') != '3.14.35':
            raise RuntimeError('设备内核不是 3.14.35')
        self.check_originals(hashes)

    def check_originals(self, hashes):
        for module in MODULES:
            name = module + '.ko'
            if self.remote_hash('/lib/modules/' + name) != hashes['original/' + name]:
                raise RuntimeError('设备原厂模块与备份不一致：' + name)

    def backup(self, hashes):
        now = datetime.now(timezone.utc)
        directory = PROJECT / '.local/diagnostics/rp1-wifi-persistent-20261112' / now.strftime('%Y%m%dT%H%M%SZ')
        directory.mkdir(mode=0o700, parents=True)
        boot_hash = self.remote_hash(BOOT)
        boot_size = int(self.shell('cat /sys/class/block/mmcblk0p8/size')) * 512
        boot_copy = directory / 'boot-before.img'
        with boot_copy.open('wb') as output:
            result = subprocess.run(
                [self.adb, '-s', self.serial, 'exec-out', 'cat', BOOT],
                stdout=output, stderr=subprocess.PIPE, timeout=60,
            )
        boot_copy.chmod(0o600)
        if result.returncode or boot_copy.stat().st_size != boot_size or checksum(boot_copy) != boot_hash:
            raise RuntimeError('boot 备份校验失败，未修改设备')
        record = {
            'created_at': now.isoformat(),
            'before': self.status(),
            'boot_sha256': boot_hash,
            'boot_bytes': boot_size,
            'original_modules': {name: hashes['original/' + name + '.ko'] for name in MODULES},
        }
        path = directory / 'backup.json'
        path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
        path.chmod(0o600)
        return directory, boot_hash

    def stage(self):
        self.shell('mkdir -p ' + REMOTE + '/original ' + REMOTE + '/patched\nchmod 700 ' + REMOTE)
        for folder in ('original', 'patched'):
            for module in MODULES:
                name = module + '.ko'
                self.run('push', str(PACKAGE / folder / name), REMOTE + '/' + folder + '/' + name)
        self.run('push', str(PACKAGE / 'files.sh'), REMOTE + '/files.sh')
        self.shell('chmod 600 ' + REMOTE + '/files.sh ' + REMOTE + '/original/*.ko ' + REMOTE + '/patched/*.ko')

    def stop_wifi(self):
        self.shell('''svc wifi disable
attempt=0
while [ "$(getprop init.svc.p2p_supplicant)" = running ]; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 20 ] || { echo 'Supplicant did not stop' >&2; exit 1; }
    sleep 1
done
sleep 2
if [ -d /sys/module/sd8897 ]; then rmmod sd8897; fi
if [ -d /sys/module/mlan8897 ]; then rmmod mlan8897; fi
test ! -d /sys/module/sd8897
test ! -d /sys/module/mlan8897''', timeout=35)

    def files(self, action):
        output = self.shell('sh ' + REMOTE + '/files.sh ' + action)
        marker = 'RP1_WIFI_FILES_INSTALLED'
        if action == 'rollback':
            marker = 'RP1_WIFI_FILES_ROLLED_BACK'
        if marker not in output.splitlines():
            raise RuntimeError(output or '模块目录未切换')

    def start_wifi(self, version):
        self.shell('svc wifi enable')
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            status = self.status()
            if all(value == version for value in status['versions'].values()):
                return status
            time.sleep(1)
        raise RuntimeError('Wi-Fi 模块未按预期加载：' + json.dumps(status['versions']))

    def restore_system_protection(self, before):
        if before['system_block_ro'] != '1' or 'ro' not in before['system_mount'].split(','):
            raise RuntimeError('安装前的 system 只读状态未记录')
        self.shell('''bb=/system/bin/busybox
block=/dev/block/mmcblk0p9
if ! $bb awk '$2 == "/system" && $4 ~ /(^|,)ro(,|$)/ {found=1} END {exit !found}' /proc/mounts; then
    $bb blockdev --setrw "$block"
    $bb mount -o remount,ro /system
fi
$bb blockdev --setro "$block"
test "$($bb blockdev --getro "$block")" = 1
$bb awk '$2 == "/system" && $4 ~ /(^|,)ro(,|$)/ {found=1} END {exit !found}' /proc/mounts''')


def change(device, action, hashes):
    device.preflight(hashes)
    directory, boot_hash = device.backup(hashes)
    before = device.status()
    if before['system_block_ro'] != '1' or 'ro' not in before['system_mount'].split(','):
        raise RuntimeError('system 必须先恢复只读状态')
    print('备份已校验：' + str(directory), flush=True)
    device.stage()
    # Refuse an unknown override before interrupting Wi-Fi.
    device.shell('sh ' + REMOTE + '/files.sh status')
    primary_error = None
    try:
        device.stop_wifi()
        device.files(action)
        expected = VERSION
        if action == 'rollback':
            expected = 'C509'
        after = device.start_wifi(expected)
        device.check_originals(hashes)
        if device.remote_hash(BOOT) != boot_hash:
            raise RuntimeError('boot 校验值发生变化')
        if after['system_block_ro'] != before['system_block_ro']:
            raise RuntimeError('system 块设备只读状态未恢复')
        if after['system_mount'] != before['system_mount']:
            raise RuntimeError('system 挂载状态未恢复')
    except BaseException as operation_error:
        primary_error = operation_error
        if action == 'install':
            print('安装未完成，正在撤回优先目录并恢复原厂驱动。', file=sys.stderr, flush=True)
        try:
            if action == 'install':
                device.stop_wifi()
                device.files('rollback')
                device.start_wifi('C509')
            else:
                device.shell('svc wifi enable')
        except BaseException as recovery_error:
            print('自动恢复未完成，请保留 USB：' + str(recovery_error), file=sys.stderr)
        raise
    finally:
        try:
            device.restore_system_protection(before)
        except BaseException as protection_error:
            if primary_error is None:
                primary_error = protection_error
                raise
            print('恢复 system 只读失败，请保留 USB：' + str(protection_error), file=sys.stderr)
        finally:
            if not before['wifi_enabled']:
                try:
                    device.shell('svc wifi disable')
                except BaseException as wifi_error:
                    if primary_error is None:
                        raise
                    print('恢复 Wi-Fi 关闭状态失败：' + str(wifi_error), file=sys.stderr)
    record = {'action': action, 'after': after, 'boot_unchanged': True, 'original_modules_unchanged': True}
    (directory / 'result.json').write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(record, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('status', 'install', 'rollback'))
    parser.add_argument('--serial', default=os.environ.get('RP1_SERIAL'))
    arguments = parser.parse_args()
    hashes = check_assets()
    device = Device(arguments.serial)
    if arguments.action == 'status':
        device.preflight(hashes)
        print(json.dumps(device.status(), indent=2, ensure_ascii=False))
    else:
        change(device, arguments.action, hashes)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print('失败：' + str(error), file=sys.stderr)
        sys.exit(1)

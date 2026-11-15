#!/usr/bin/env python3
"""Build one release ZIP containing the Home Assistant app and RP1 client and driver."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import zipfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def main():
    version = re.search(r'^version: "([^"]+)"$', (ROOT / 'ha-app/config.yaml').read_text(), re.M).group(1)
    manifest = ET.parse(ROOT / 'android/AndroidManifest.xml').getroot()
    if manifest.get('{http://schemas.android.com/apk/res/android}versionName') != version:
        raise SystemExit('HA and RP1 versions must match')
    driver = runpy.run_path(str(ROOT / 'misc/rp1-wifi/driver.py'))
    if driver['VERSION'] != 'C509.p2-rp1-' + version:
        raise SystemExit('Driver and app release versions must match')
    driver['check_assets']()
    keystore = Path(os.environ.get('RP1_KEYSTORE', ROOT / '.local/debug.keystore')).expanduser().resolve()
    if not keystore.is_file():
        raise SystemExit('Set RP1_KEYSTORE to the existing signing keystore before packaging')
    build_env = os.environ.copy()
    build_env['RP1_KEYSTORE'] = str(keystore)
    subprocess.run(['bash', str(ROOT / 'scripts/build-apk.sh')], cwd=ROOT, env=build_env, check=True)

    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT, text=True).split('\0')
    content = {}

    def add(destination, source):
        content[destination] = (ROOT / source).read_bytes()

    for name in tracked:
        if name.startswith('ha-app/'):
            add('ha/' + name.removeprefix('ha-app/'), name)
        elif name.startswith('deploy/home-assistant/'):
            add('ha/' + name, name)
        elif name.startswith('misc/rp1-wifi/'):
            add('rp1/' + name, name)
        elif name.startswith('android/assets/fonts/') and name.endswith(('.md', '.txt')):
            add('rp1/' + name, name)
    for component in ('ha', 'rp1'):
        for name in ('LICENSE', 'NOTICE', 'design/LICENSE.md'):
            add(component + '/' + name, name)
    add('ha/docs/assistant.md', 'docs/assistant.md')
    content['ha/docs/assistant.md'] = content['ha/docs/assistant.md'].replace(b'(../ha-app/DOCS.md)', b'(../DOCS.md)')
    for name in ('scripts/configure-rp1.py', 'docs/rp1-tuning.md'):
        add('rp1/' + name, name)
    for name in ('CHINESE_CALENDAR.md', 'LICENSE.chinese_calendar'):
        add('rp1/ha-app/server/vendor/' + name, 'ha-app/server/vendor/' + name)
    calendar_doc = 'rp1/ha-app/server/vendor/CHINESE_CALENDAR.md'
    content[calendar_doc] = content[calendar_doc].replace(b'(chinese_calendar.mjs)', b'(../../../../ha/server/vendor/chinese_calendar.mjs)')
    add('rp1/dist/rp1-calendar.apk', 'dist/rp1-calendar.apk')
    content['rp1/connection.example.json'] = (json.dumps({
        'endpoint': 'http://192.0.2.1:8080',
        'token': 'replace-with-your-display-token',
        'scheduled': True,
    }, indent=2) + '\n').encode()
    content['rp1/INSTALL.md'] = f'''# RP1 {version}

用于已 root 的 Sony DPT-RP1，Android 5.1 / ARMv7。电脑需要 Python 3.9 以上和 Android Platform Tools（`adb`）。

## 安装客户端

先安装 HA 应用，设置至少 24 字符的 `display_token`。在本目录把 `connection.example.json` 复制为 `connection.json`，改为自己的 HA 局域网地址和相同的令牌。

USB 连接 RP1，在 `rp1/` 目录运行：

```sh
python3 scripts/configure-rp1.py connection.json
```

有多台设备时，在命令后加 `--serial <RP1序列号>`。脚本会安装 APK、写入连接设置并启动应用，默认每刻钟刷新。`scheduled` 设为 `false` 可关闭自动刷新。连接配置包含令牌，请自行保管。

升级时保留连接设置，只需 `adb install -r dist/rp1-calendar.apk`；不要先卸载旧版。

## 安装驱动修复

驱动版本为 `C509.p2-rp1-{version}`，用于待机恢复修复和仅在休眠时生效的 Wi-Fi 白名单。它与客户端一起提供，单独安装。

适用于固件 `1.6.50.14130`、内核 `3.14.35` 的 DPT-RP1，要求 root ADB 和匹配的原厂模块。在 `rp1/` 目录运行：

```sh
python3 misc/rp1-wifi/driver.py status
python3 misc/rp1-wifi/driver.py install
```

安装会备份原有驱动和 boot，备份保存在本目录 `.local/diagnostics/`，请保留。切换时 Wi-Fi 会短暂断开。需要回退时运行：

```sh
python3 misc/rp1-wifi/driver.py rollback
```

白名单使用当前 IPv4 和 MAC，不放行 IPv6 数据；需要 IPv6 入站时关闭过滤。开关、构建和回退说明见[驱动说明](misc/rp1-wifi/README.md)，系统配置见[RP1 调优](docs/rp1-tuning.md)。

主体与设计许可见 `LICENSE`、`NOTICE` 和 `design/LICENSE.md`。驱动源码与模块独立采用 GPLv2，见 `misc/rp1-wifi/GPL-2.0.txt`。字体许可已内置 APK，包内另附字体说明和许可；历法数据来源与 MIT 许可见 `ha-app/server/vendor/`。
'''.encode()
    content['README.md'] = f'''# 刻历 {version}

HA 应用、RP1 客户端和驱动修复统一为 {version}。

- `ha/`：Home Assistant 应用源码、接入模板和许可，由 Supervisor 构建，支持 amd64 / aarch64。
- `rp1/`：已签名 APK、USB 配置工具，以及驱动修复的完整源码、模块和安装回退工具。

## 安装

先把 `ha/` 的全部文件（含隐藏文件）复制到 HA 的 `/local_apps/mono_calendar/`，刷新应用商店，安装「刻历」。旧共享目录可能叫 `addons`。设置 `display_token`、时区和实体后启动应用。模型 API Key 在网页「助手设置」填写，完整接入方法见 [HA 安装与维护](ha/DOCS.md)。

再按 [RP1 安装说明](rp1/INSTALL.md)设置相同的服务地址和令牌，并按需安装随包提供的驱动修复。

升级前备份 HA App 数据与配置。RP1 APK 沿用现有签名，可覆盖升级。各组件保留对应许可，文件校验清单见 `SHA256SUMS`。
'''.encode()
    content['SHA256SUMS'] = ''.join(
        f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(content.items())
    ).encode()
    timestamp = int(subprocess.check_output(['git', 'show', '-s', '--format=%ct', 'HEAD'], cwd=ROOT, text=True))
    date = datetime.fromtimestamp(timestamp, timezone.utc).timetuple()[:6]
    output = ROOT / 'dist' / f'mono-calendar-{version}.zip'
    temporary = output.with_suffix('.zip.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(content.items()):
                info = zipfile.ZipInfo(name, date)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('ZIP integrity check failed')
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n')
    print(f'Packaged {output} ({output.stat().st_size} bytes)\nSHA256 {digest}')


if __name__ == '__main__':
    main()

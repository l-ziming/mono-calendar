# RP1 Wi-Fi 驱动补丁

这是排查 RP1 待机卡死时做的 Wi-Fi 驱动补丁。原厂模块和修改后的模块各留一份，方便之后加载或回退。

## 修了什么

设备上的原厂驱动是 Marvell `C509`，补丁基于 Sony 公开源码中的 `C509.p2`，编译后的版本是 `C509.p2-rp1fix1`。两个模块需要成对加载。

`C509.p2` 已经给唤醒原因查询加了 20 秒等待上限。在这个基础上，补丁做了几处修改：

- 查询失败时跳过唤醒原因上报，清理待机状态并继续恢复。
- 普通 IOCTL 收到 `CMD_TIMEOUT` 时也唤醒等待线程，避免已经报错却继续等着。
- 私有 `wakeupreason` 查询使用相同的等待上限。
- 增加可开关的诊断日志，在请求交接或释放前保存日志字段，避免访问已释放的请求。

20 秒只限制查询等待回复的时间。它不会重置固件或中止卡死的 SDIO 调用，整个恢复流程仍可能被其他路径阻塞。补丁通过了本机回归、原厂回退、Wi-Fi 重开和重启自动加载验证，待机稳定性还在继续观察。

## 加载和回退

这份驱动用于 root 过的 DPT-RP1，内核为 `3.14.35 SMP preempt mod_unload ARMv7`。连接 USB、确认 ADB 可用后，在仓库根目录运行：

```sh
python3 misc/rp1-wifi/driver.py status
python3 misc/rp1-wifi/driver.py install
python3 misc/rp1-wifi/driver.py rollback
```

`install` 把补丁模块放到原厂加载器优先读取的 `/system/lib/modules`，两个模块通过整个目录一次切换。Wi-Fi 重新开启和设备重启后都会从这里加载。`rollback` 撤回这层覆盖，恢复原厂驱动。切换时 Wi-Fi 会短暂断开。

原厂 `/lib/modules` 保留，不刷写 boot。完整 boot 备份和安装记录留在本机 `.local/diagnostics/rp1-wifi-persistent-20261112/`。

更新固件前先运行 `rollback`，更新后重新核对内核和模块。

新增诊断默认关闭，可以在设备上以 root 开关：

```sh
echo 1 > /sys/module/sd8897/parameters/diagnostic
echo 0 > /sys/module/sd8897/parameters/diagnostic
```

关闭诊断后修复仍然生效，原厂日志保留原有设置。

## 文件和构建

| 路径 | 内容 |
| --- | --- |
| `original/` | 从这台设备保存的原厂模块，用于回退 |
| `patched/` | 编译好的补丁模块 |
| `resume-fix.patch` | 相对 Sony `C509.p2` 的修改 |
| `source/wlan_src/` | 已应用补丁的完整驱动源码 |
| `build-driver.sh`、`build-support/` | 构建脚本、设备内核配置和主机 ELF 头文件 |
| `tests/source/` | 从驱动源码提取函数的本机回归测试 |
| `SHA256SUMS` | 模块、补丁、源码和构建文件的 SHA-256 |
| `BUILD-PROVENANCE.txt` | 工具链、内核配置和 ABI 核对记录 |
| `GPL-2.0.txt` | Marvell 驱动的 GPLv2 许可 |
| `build-support/hostinclude/COPYRIGHT.musl` | 构建用 musl ELF 头文件的许可说明 |

在这个目录运行 `shasum -a 256 -c SHA256SUMS` 核对文件。

重新编译还需要 [Sony DPT-RP1 / DPT-CP1 GPL 源码](https://oss.sony.net/Products/Linux/dp/DPT-RP1_DPT-CP1_Ver1.6.02.html)中的 `linux-3.14.35`。本目录的驱动源码已包含补丁，可以直接构建。

脚本在 macOS 上通过 Rosetta 运行 AOSP GCC 4.8，需要 Apple clang、make 和 curl。首次运行会下载并校验官方工具链，保存在 `.build/`。在仓库根目录运行：

```sh
RP1_KERNEL_SOURCE=/path/to/linux-3.14.35 bash misc/rp1-wifi/build-driver.sh
```

本机已有的 Sony 内核源码默认路径是工作区的 `../../../output/rp1-kernel-20261110-live/source/linux-3.14.35`，相对本目录计算，使用它时可以省略 `RP1_KERNEL_SOURCE`。编译产物在 `source/wlan_src/`，构建参数和原有 ABI 核对记录见 [BUILD-PROVENANCE.txt](BUILD-PROVENANCE.txt)。

本机回归需要 Python 3 和支持 ASan、UBSan 的 clang，在仓库根目录运行：

```sh
python3 misc/rp1-wifi/tests/source/run.py
```

测试覆盖超时唤醒、请求生命周期、恢复状态清理和诊断开关。它不连接设备，实际待机和固件恢复需要在 RP1 上验证。

这个目录里的 Marvell 驱动及补丁沿用 GPLv2，独立于项目主体的非商业许可。

构建用的 `elf.h` 来自 musl，保留其 [COPYRIGHT](https://git.musl-libc.org/cgit/musl/tree/COPYRIGHT)。

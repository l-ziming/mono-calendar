# RP1 Wi-Fi 驱动补丁

这是排查 RP1 待机卡死时做的 Wi-Fi 驱动补丁。原厂模块和修改后的模块各留一份，方便之后加载或回退。

## 修了什么

设备上的原厂驱动是 Marvell `C509`，补丁基于 Sony 公开源码中的 `C509.p2`，当前版本是 `C509.p2-rp1fix8`。两个模块需要成对加载。

`C509.p2` 已经给唤醒原因查询加了 20 秒等待上限。在这个基础上，补丁做了几处修改：

- 查询失败时跳过唤醒原因上报，清理待机状态并继续恢复。
- 普通 IOCTL 收到 `CMD_TIMEOUT` 时也唤醒等待线程，避免已经报错却继续等着。
- 私有 `wakeupreason` 查询使用相同的等待上限。
- 增加可开关的诊断日志，在请求交接或释放前保存日志字段，避免访问已释放的请求。

20 秒只限制查询等待回复的时间。它不会重置固件或中止卡死的 SDIO 调用，整个恢复流程仍可能被其他路径阻塞。

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

## 休眠过滤

白名单默认开启，与防死机修复分开控制。驱动取得当前 IPv4 和 MAC 后，在独立工作队列里下发 7 条、356 字节的 MEF 规则。地址改变、Wi-Fi 重开或模块重载后重新准备；休眠和恢复路径不新增同步等待。

全部规则为 mode 1，只在固件 host sleep 时生效，清醒时正常收包。固件按第一条匹配执行：

- 查询本机 IPv4 的 ARP 请求由固件代答，不唤醒主机。
- 本机 ARP 回复、发给本机 IPv4 的流量、EAPOL 交给主机处理。
- DHCP 的 UDP 67→68 回复按 BOOTP 中的本机 MAC 放行；允许未分片、无 IP 选项的 IPv4 包，DF 可为 0 或 1。
- 最后一条始终匹配，丢弃其余流量，包括 mesh 广播、其他主机的 ARP 和发现组播。

RP1 目前通过 IPv4 访问服务器。休眠白名单不放行 IPv6 数据；需要 IPv6 入站访问时，先关闭过滤。

小表匹配顺序、固件 ARP 代答、DHCP 和 51 分钟实际待机的结果见 [RP1 系统调优](../../docs/rp1-tuning.md#休眠过滤的范围)。旧的 `/proc/rp1_sleep_rules` 黑名单入口已移除。

```sh
# 查看开关与当前应用状态
adb shell 'cat /sys/module/sd8897/parameters/rp1_sleep_filter'
adb shell 'cat /sys/module/sd8897/parameters/rp1_sleep_filter_state'

# 关闭白名单；防死机修复仍然生效
adb shell 'echo 0 > /sys/module/sd8897/parameters/rp1_sleep_filter'

# 开启，或在下发失败后手动重试
adb shell 'echo 1 > /sys/module/sd8897/parameters/rp1_sleep_filter'
```

开关是当前模块的运行时设置，模块重载后恢复默认开启。`active=1` 只表示本次规则已获固件确认，实际过滤要看休眠收包和唤醒记录；`failed=1` 表示本次尝试失败，下一次写入开关会重试。驱动不会不断重试失败的下发。

状态第二行的 `wakes none=… bcast=… mcast=… ucast=… other=…` 从模块加载开始累计固件报告的恢复原因，`none` 是非 Wi-Fi 原因。

下发失败会尝试清除白名单，退回原厂通行方式。若 `active=0`、`dirty=1`，表示固件尚未确认清除；可在联网恢复后再次写 0 并查看状态。不要额外运行旧的 `mlanutl wlan0 ipaddr` 或 `mefcfg` 脚本，它们会覆盖驱动准备的表。

更新安装前会备份正在使用的补丁模块；加载新版失败或目录切换被中断时恢复更新前的版本。`rollback` 撤回覆盖目录、使用原厂 `C509`，不要求本地补丁模块或源码完整。

## 文件和构建

| 路径 | 内容 |
| --- | --- |
| `original/` | 从这台设备保存的原厂模块，用于回退 |
| `patched/` | 编译好的补丁模块 |
| `resume-fix.patch` | 相对 Sony `C509.p2` 的防死机与休眠过滤修改 |
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

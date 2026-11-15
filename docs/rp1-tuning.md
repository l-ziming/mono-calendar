# RP1 系统调优

这台 DPT-RP1 的固件是 `1.6.50.14130`，内核和 Wi-Fi 固件镜像仍用原版。为减少待机唤醒，调整了 Wi-Fi 驱动、Sony 网络检查和自动发现。排查已结束，设备保留这些日常设置，额外诊断已关闭。

## 当前设置

| 项目 | 设置 |
| --- | --- |
| Wi-Fi 驱动 | `C509.p2-rp1fix8`，成对安装到 `/system/lib/modules` |
| 休眠过滤 | 默认开启白名单与本机 ARP 代答，仅在固件 host sleep 时生效；清醒时正常收包 |
| Sony 网络检查 | `persist.sys.netsaver.interval=300000`，从原来的 20 秒改为 5 分钟 |
| Sony 自动发现 | `DPDiscoveryService` 已注销并禁用，`mdnsd` 已停止 |
| 刻历同步 | 按屏幕时区，06:00–24:00 每 15 分钟一次，00:00–06:00 每小时一次；闹钟窗口为 1 秒 |

驱动由原厂加载器优先读取，Wi-Fi 重开和设备重启后保留，原厂 `/lib/modules` 不变。规则随当前 IPv4、MAC 和模块重载重新准备。规则内容、开关、安装与回退见 [Wi-Fi 驱动说明](../misc/rp1-wifi/README.md)。

网络检查参数和发现组件的禁用也会保留。5 分钟检查让断网时的备用检查更慢，Wi-Fi 自身自动重连和刻历同步仍正常。停用发现会影响电脑、手机自动发现 RP1；刻历直接访问配置的服务器，不依赖 mDNS。其他应用仍可能按需启动 `mdnsd`。

IPv6 当前为 `all/default.disable_ipv6=1`、`wlan0.disable_ipv6=0`。这些是运行时状态，不由驱动补丁管理，也没有额外的开机恢复任务。

## 休眠过滤的范围

2026-11-14 23:26 至 11-15 00:17（America/Denver）的拔线记录中，临时白名单连续生效了 **51 分 19 秒**。该轮在 `fix7` 上手动下表，与 `fix8` 在当时地址下生成的 7 条、356 字节规则完全一致。期间 **Wi-Fi 唤醒为 0**，16 次实际恢复包括 15 次 PMIC、1 次 RTC，没有新增恢复失败；23:30、23:45、00:00 三次自然同步均成功。临时试验到期后自动恢复了旧过滤，之后的待机时间不算白名单测试。

固件休眠实验在 USB 连接下确认了匹配顺序和 ARP 代答。安装 `fix8` 后，独立重载 Wi-Fi 能自动重新准备白名单；本机流量和 DHCP 可以通过，无关广播在休眠时丢弃、清醒时可接收。真实 DHCP 续租抓到了匹配的 REQUEST／ACK，11 月 15 日 15:45 的原有闹钟也正常完成了同步。电池收益尚未量化。

## 诊断收尾

当前驱动诊断为 `diagnostic=N`，内核日志恢复为原来的过滤级别 `6`、`initcall_debug=N`。我们额外加载的 `rp1_reset_stack` 抓栈模块已卸载，同步观察器和临时抓包任务已停止。Sony 原生系统日志和持久日志保留。

RP1 上的 370 个旧诊断文件、约 280 MB，已逐文件校验并归档到本机私有目录 `.local/diagnostics/rp1-cleanup-20261115/`，随后从设备清理。当前驱动、安装回退包和原厂备份保留。旧的 `.local/rp1-system/restore.sh` 已停用，避免再次开启诊断；日常使用无需运行恢复脚本。

## 恢复方法

设备命令通过 root ADB 执行；连接多台设备时，给 `adb` 加 `-s 序列号`。

恢复 Sony 默认网络检查间隔：

```sh
adb shell 'setprop persist.sys.netsaver.interval ""'
```

正常重新启用 Wi-Fi 或重启后生效，期间会短暂断网。日志中的 `Set Condition Save Event [20000]` 表示已加载默认的 20 秒间隔。

恢复 Sony 自动发现：

```sh
adb shell 'pm enable com.sony.infras.networkmanager/.services.DPDiscoveryService'
adb shell 'ndc mdns mdnssd start-service'
adb shell 'getprop init.svc.mdnsd'
# 确认为 running 后重建注册：
adb shell 'am startservice -n com.sony.infras.networkmanager/.services.DPDiscoveryService'
adb shell 'dumpsys servicediscovery'
```

本机旧版 `ndc` 命令里的第一个 `mdns` 用来选择控制 socket，不能省略。恢复后检查 NSD 注册和 mDNS 组播成员是否回来，只有进程启动还不够。

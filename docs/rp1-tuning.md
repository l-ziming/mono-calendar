# RP1 系统调优

RP1 待机时经常被网络检查和无线流量叫醒，所以在自己的设备上做了一些调整。固件版本是 `1.6.50.14130`，内核和 Wi-Fi 固件镜像用的还是原版。设备上的命令通过 root ADB 执行。

| 项目 | 原来的设置 | 现在的设置 |
| --- | --- | --- |
| 广播过滤与 ARP 应答 | `ipaddr 0`，ARP 由主机处理 | `ipaddr 3;<RP1 的 IPv4>`，过滤广播并代答本机 ARP |
| Sony 网络检查 | 每 20 秒一次 | 每 5 分钟一次，之前试过 60 秒 |
| Sony 自动发现 | `DPDiscoveryService` / `mdnsd` 运行 | 注销后停用 |
| IPv6 | 启用 | `all/default.disable_ipv6=1`，退出 IPv6 地址与组播 MAC 订阅，保留 IPv4 同步；重启后重新设置 |
| 内核诊断日志 | 过滤级别 6、`initcall_debug=N` | 过滤级别 7、`initcall_debug=N`；驱动 `diagnostic=Y`、RESET 抓栈开启，保留超时日志和故障栈 |
| 刻历整刻闹钟 | `setExact` 被 Sony 扩窗数分钟 | `setWindow(..., 1000, ...)`，实机窗口 1 秒 |

## 无关广播过滤的范围

驱动下发的规则放行**针对 RP1 自身 IPv4 的广播 ARP、全部二层单播和组播**，过滤查询其他 IP 的 ARP、路由器 Mesh 和 UDP 等其他广播。过滤在固件休眠路径生效，主机清醒时仍能抓到这些包。

`ipaddr` 中的 `3 = 1（过滤）+ 2（自动 ARP 应答）`，不改变 Android/DHCP 的地址分配。Android `iptables` 处理报文时 CPU 已经醒了，所以过滤放在 Wi-Fi 固件里做。

mDNS、MLD、IGMP 仍可能叫醒 RP1，部分 IPv4 组播也会被网络侧以单播 MAC 投递。因此还单独停用了 mDNS，退出不需要的订阅。

## 持久性与功能影响

- **广播过滤和 ARP 代答是临时设置。** 先用 `ip -4 addr show dev wlan0` 查地址，再设置 `mlanutl wlan0 ipaddr "3;当前IPv4"`。IPv4 地址变了要更新；Wi-Fi 关闭再开启会清空配置，重启或驱动重载后也要核对。这个命令会重建 MEF 表，已有自定义规则时要先确认，避免覆盖。
- **网络检查间隔会保留。** 参数是 `persist.sys.netsaver.interval=300000`，需要正常重新启用 Wi-Fi 或重启才会加载。原任务即使联网正常也会唤醒设备并持锁约 1 秒。改成 5 分钟后，断线时这条备用扫描路径比之前的 60 秒最多多等约 4 分钟，正常的 Wi-Fi 自动重连仍然工作。刻历每 15 分钟的同步闹钟独立运行。
- **Sony 发现组件的禁用会保留。** 电脑、手机自动发现 RP1 会受影响，Wi-Fi、普通 DNS 和 IPv6 邻居发现不受这一步影响。刻历直接访问配置好的服务器，不依赖 mDNS。

直接杀进程可能留下失效注册，要正常停止服务并等 NSD 注册清空。

```sh
adb shell 'am stopservice -n com.sony.infras.networkmanager/.services.DPDiscoveryService'
adb shell 'dumpsys servicediscovery'  # 确认活动注册清空
adb shell 'ndc mdns mdnssd stop-service'
adb shell 'pm disable com.sony.infras.networkmanager/.services.DPDiscoveryService'
```

本机旧版 `ndc` 命令里的第一个 `mdns` 用来选择控制 socket，不能省略。其他应用仍可能按需启动 mDNS。停用后，两个 mDNS 组播成员退出，Wi-Fi 和定时同步正常。

## 已确认的唤醒来源

- **GPIO39：Wi-Fi。** 18 次样本的同期首包包括 10 次 IPv6 mDNS、3 次 MLD 查询、4 次 IGMP，另外 1 次没有归类，与固件报告的原因对得上。
- **PMIC：RTC/系统闹钟。** 停用发现前观察了 39 分 47 秒，25 次唤醒都对应 Sony 的 60 秒检查。
- **GPIO76：触控。** 回插前观察到用户操作带来的唤醒。刻历的整刻任务可能合并到已有系统唤醒中，计数时要去重。

原始配置、广播过滤、过滤/ARP 代答加 60 秒检查，三轮总唤醒率分别是 **11.65、6.78、4.25 次/分钟**。网络流量、观察时段和 HA 扫描状态不同，这组数字不代表每项改动的独立收益，也不能换算成省电百分比。

## 恢复方法

同时连接多台设备时，给 `adb` 加 `-s 序列号`。

```sh
# 移除广播过滤/ARP 代答；恢复 Sony 默认 20 秒参数。
adb shell 'mlanutl wlan0 ipaddr "0"'
adb shell 'setprop persist.sys.netsaver.interval ""'

# 恢复 Sony 发现：先启动 daemon，确认 running，再重建注册。
adb shell 'pm enable com.sony.infras.networkmanager/.services.DPDiscoveryService'
adb shell 'ndc mdns mdnssd start-service'
adb shell 'getprop init.svc.mdnsd'
# 确认为 running 后：
adb shell 'am startservice -n com.sony.infras.networkmanager/.services.DPDiscoveryService'

# 恢复原来的内核诊断级别。
adb shell 'echo N > /sys/module/kernel/parameters/initcall_debug; echo 6 > /sys/kernel/debug/log_ctrl_filter_kernel'
```

恢复 20 秒参数后，正常重新启用 Wi-Fi 或重启，检查日志里是否出现 `Set Condition Save Event [20000]`，期间会短暂断网。恢复发现服务后，还要查看 NSD 注册和 mDNS 组播成员是否回来，只有进程启动并不代表注册恢复了。

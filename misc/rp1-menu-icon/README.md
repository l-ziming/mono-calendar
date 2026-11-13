# RP1 菜单「应用」图标

RP1 破解后，系统顶部菜单里多了一个「应用」入口，用来打开第三方启动器。这里换了一个新的风格的四宫格。

## 菜单怎么读取图标

菜单由原厂的 `com.sony.apps.applauncher` 绘制，按 `/etc/dp_extensions/<名称>/` 下的文件夹生成菜单项，每个文件夹就是一项：

| 文件 | 作用 |
| --- | --- |
| `<名称>_extension.xml` | `LauncherEntry`：点击后打开的 intent、图标文件名、排序 `order` |
| `<名称>_strings-{en,ja,zh_CN}.xml` | 菜单文字 |
| `ic_homemenu_*.png` | 图标 |

「应用」对应 `/etc/dp_extensions/Apps/`。点击后打开 `cn.modificator.launcher/.Launcher`，图标是 `ic_homemenu_apps.png`，排在第 9 位。KOReader 也是用同样的方式加进菜单的。`/etc` 链接到 `/system/etc`，所以这些文件都在只读的 system 分区里。

## 像素要求

下面的数据量自原厂的「返回文档」「所有文档」「文件夹」「设置」四个图标：

| 项目 | 原厂图标 | 新图标 |
| --- | --- | --- |
| 画布 | 220×120，8 位 RGBA PNG，透明背景 | 相同 |
| 图形 | 居中，约 70–95 宽、66–97 高 | 70×70，占 x 75–144、y 25–94 |
| 线条 | 黑色，2 px，对齐整像素 | 相同 |
| 内部 | 不透明白色 | 相同 |
| 点缀色 | 少量灰色 `#656262` | 不用 |
| 抗锯齿 | 很少，半透明像素约 17–62 个 | 只在圆角处，112 个 |

线条要落在整像素上，否则墨水屏上会显示成发灰的 3 px 线。在 SVG 里，2 px 描边是以路径为中心向两边各画 1 px 的，所以矩形的坐标和宽高都要用整数。

## 安装和回退

连接 USB、确认 ADB 是 root 后，在仓库根目录运行：

```sh
adb push misc/rp1-menu-icon/ic_homemenu_apps.png /sdcard/ic_homemenu_apps.png
adb shell 'set -e; mount -o remount,rw /system
cd /system/etc/dp_extensions/Apps
[ -e ic_homemenu_apps.png.bak ] || cp ic_homemenu_apps.png ic_homemenu_apps.png.bak
cat /sdcard/ic_homemenu_apps.png > ic_homemenu_apps.png
sync; mount -o remount,ro /system; rm /sdcard/ic_homemenu_apps.png
am force-stop com.sony.apps.applauncher'
```

脚本第一次运行时，会把原来的房子图标备份成同一目录下的 `ic_homemenu_apps.png.bak`，之后再运行不会覆盖这份备份。用 `cat` 覆盖原文件，可以保留原来的 root 所有者和 644 权限。最后一步重启菜单程序，下次打开菜单就会显示新图标。如果还是旧图标，重启一次设备。

回退时，用 `.bak` 覆盖回去：

```sh
adb shell 'set -e; mount -o remount,rw /system
cd /system/etc/dp_extensions/Apps
cat ic_homemenu_apps.png.bak > ic_homemenu_apps.png
sync; mount -o remount,ro /system
am force-stop com.sony.apps.applauncher'
```

更新固件或重装破解后，system 分区可能被还原，到时重新运行安装步骤即可。

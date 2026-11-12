# Sony DPT-RP1 硬件

之前没在网上找到 DPT-RP1 的公开拆机资料，只偶尔见过主板近照。排查死机和唤醒问题的时候，把自己那台拆了。把看到的芯片和模块整理在这里，希望对同样在折腾这台设备的人有用。

官方配置：IAP140、13.3 英寸柔性电子纸、1650×2200、16GB 存储。[索尼规格](https://www.sony.jp/digital-paper/products/DPT-RP1/spec.html)

## 芯片与模块

芯片丝印来自拆机，此外还通过启动日志（`dmesg`）、内核配置和设备树核对了一下。

| 芯片或模块 | 型号与规格 |
| --- | --- |
| 主处理器 | Marvell `88CP1908-B1Y2` / `IAP140L`，64 位四核，PXA1908 平台；本机运行 32 位 ARM 内核 |
| RAM | Samsung `K4E6E304EB-AGCF`，2 GB LPDDR3，168-FBGA，12×12 mm |
| eMMC | Toshiba `THGBMFG7C2LBAIL`，16GB |
| 屏幕电源 | TI `TPS65185`，提供电子纸正负驱动电压和 VCOM |
| 触控控制器 | Atmel `MXT2954T2-C2U`，maXTouch |
| 无线 | Wi-Fi、蓝牙；Wi-Fi 驱动标识 `SD8897` |
| 充电与系统供电 | TI `TWL6032` |
| 电池 | Sony，3.7 V、2000 mAh、7.4 Wh |

## 参考资料

- [Samsung 1H 2017 选型指南，第 8 页](https://tsscfzco.com/uploads/8129-User%20Guide%20-%20Samsung.pdf)
- [Toshiba／KIOXIA eMMC 资料](https://www.kioxia.com/en-jp/business/news/2014/20141002-1.html)
- [TI TWL6032 产品页](https://www.ti.com/product/TWL6032)
- [TI TPS65185 数据手册](https://www.ti.com/lit/ds/symlink/tps65185.pdf)
- [Microchip ATMXT2954T2 产品页](https://www.microchip.com/en-us/product/atmxt2954t2)
- [Sony DPT-RP1 / DPT-CP1 1.6.02 源码](https://oss.sony.net/Products/Linux/dp/DPT-RP1_DPT-CP1_Ver1.6.02.html)

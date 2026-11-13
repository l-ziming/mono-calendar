# RP1 Wi-Fi 驱动原厂备份

`original/` 是从设备保存的 Marvell `C509` 模块，两个模块需要成对使用。

`source/wlan_src/` 是 Sony 公开的 `C509.p2` 驱动源码，未做修改。源码来自 [Sony DPT-RP1 / DPT-CP1 1.6.02 开源包](https://oss.sony.net/Products/Linux/dp/DPT-RP1_DPT-CP1_Ver1.6.02.html)中的 `linux-3.14.35/drivers/marvell/sd8897/wlan_src/`。

源码包 `linux-3.14.35.tar.gz` 的 SHA-256：

```text
64561da3f477e2f716ad05d33e9873ce9be3521c5899512df8435213c3ef45d3
```

前一次提交保留了 [Sony 独立驱动包](https://prodgpl.blob.core.windows.net/download/dp/DPT-RP1_DPT-CP1_Ver1.6.02/marvell_sd8897.tar.gz)中的 `C509` 源码。设备模块仍为 `C509`，没有重新编译或替换。

在这个目录运行 `shasum -a 256 -c SHA256SUMS` 核对文件。

Marvell 驱动沿用 GPLv2，许可见 `GPL-2.0.txt`，独立于项目主体的非商业许可。

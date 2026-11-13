# RP1 Wi-Fi 驱动原厂备份

`original/` 是从设备保存的 Marvell `C509` 模块，两个模块需要成对使用。

`source/wlan_src/` 是 Sony 公开的 `C509` 驱动源码，未做修改。源码来自 [Sony DPT-RP1 / DPT-CP1 1.6.02 开源包](https://prodgpl.blob.core.windows.net/download/dp/DPT-RP1_DPT-CP1_Ver1.6.02/marvell_sd8897.tar.gz)中的 `marvell/sd8897/wlan_src/`。

源码包 `marvell_sd8897.tar.gz` 的 SHA-256：

```text
1a8a52d68b66309209a7b208da019f896a116f8808f1fdd73adff914d5229474
```

在这个目录运行 `shasum -a 256 -c SHA256SUMS` 核对文件。

Marvell 驱动沿用 GPLv2，许可见 `GPL-2.0.txt`，独立于项目主体的非商业许可。

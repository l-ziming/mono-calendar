# APK 内置字体

界面默认用 500 字重，18px 及以下的小字用 600，需要强调的地方用 700。

Noto Sans SC 的 Regular 和 Medium 保留完整字库。Bold、SemiBold 和 Noto Serif SC 按界面用字、GB2312 一级字和宜忌词表裁剪。

| 字体 | 字重 | 来源 |
| --- | --- | --- |
| Noto Sans SC | 400 / 500 / 700 | notofonts/noto-cjk，许可证 `OFL-NotoSansSC.txt` |
| Noto Sans SC | 600（`NotoSansSC-SemiBold.ttf`） | google/fonts 的 `NotoSansSC[wght].ttf` 用 fontTools 实例化为静态 600，许可证同上 |
| Noto Serif SC | 500 / 700 | notofonts/noto-cjk，许可证 `OFL-NotoSerifSC.txt` |
| Noto Serif | 700，仅引号 U+201C | notofonts/noto-fonts，Git blob `3d1ffeba22aaf475e37f231b8e159dacab0fe4f9`，许可证 `OFL-NotoSerif.txt` |
| Inter | 400 / 500 / 600 / 700 | rsms/inter 4.1，许可证 `OFL-Inter.txt` |

Inter 的等宽数字（`tnum`）映射写进了 cmap，让 Android 5.1 和 Java2D 的数字样式一致。打包使用静态字体。

字体已包含在仓库中。修改界面文字或字体后，按 `scripts/build-fonts.sh` 开头的说明把原始字体放进 `fonts-src/`，再运行脚本。

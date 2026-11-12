# Logo

刻历的 Logo 放在 `logo.svg`：白底、灰色 `#999999` 圆角方块，右上四分之一留白，黑色描边 3.5。可见区是 72×72（`viewBox="18 18 72 72"`）。

修改后运行：

```sh
JAVA_HOME=<JDK 17+> bash scripts/build-icons.sh
```

| 生成位置 | 用途 |
| --- | --- |
| `android/res/mipmap-*/ic_launcher.png` | RP1 App 启动图标，48–192 px |
| `ha-app/icon.png` | Home Assistant 应用商店图标，128 px |
| `ha-app/server/chat.html` 中的 `<svg class="logo">` | 网页对话页左上角 Logo |

SVG 使用 `rect`、`path`、纯色填充和描边，由 `scripts/IconRender.java` 导出。

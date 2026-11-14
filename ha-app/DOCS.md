# 安装与维护

项目介绍见 [README](https://github.com/l-ziming/mono-calendar/blob/main/README.md)，助手设置见 [docs/assistant.md](https://github.com/l-ziming/mono-calendar/blob/main/docs/assistant.md)。

## 安装 HA App

1. 在 HA 应用商店右上角菜单选择「仓库」，添加本仓库的 GitHub 地址。手动安装可以通过 Samba 或 Terminal & SSH，把 `ha-app/` 的全部文件复制到 `/local_apps/mono_calendar/`（旧共享目录可能叫 `addons`）。
2. 刷新应用商店，安装「刻历」。镜像为 `node:24-bookworm-slim`，支持 amd64 和 aarch64。
3. 在 App 配置页设置独立的 `display_token`，至少 24 字符。填写时区、天气、传感器和设备，用不到的实体留空。
4. 把 [便条实体模板](https://github.com/l-ziming/mono-calendar/blob/main/deploy/home-assistant/mono-calendar-assistant.yaml) 加到 HA packages，创建最大长度为 255 的 `input_text.mono_calendar_assistant`。
5. 启动 App，打开开机启动，Watchdog 按需要开启。默认端口为 8080，修改后也要更新屏幕端的服务地址。
6. 打开 `http://HA局域网IP:8080/`，在「助手设置」填写模型 API Key 和其他助手选项。

App 通过 Supervisor 的 `homeassistant_api` 读取状态和控制设备。

## 升级与配置来源

升级前备份 App 数据和配置目录。仓库安装的在应用商店直接更新；手动安装的替换 `/local_apps/mono_calendar/` 里的文件，刷新商店后重建或更新。保留原有凭据，启动后检查版本、对话和记忆。

| 配置 | 管理位置 | 生效方式 |
| --- | --- | --- |
| 时区、温度单位、城市、周起始日、天气及设备映射、屏幕令牌 | HA App 配置页 | 保存并重启 |
| 提示词、模型连接、屏幕与新闻、上下文、记忆期限、日历与辅助实体 | 刻历「助手设置」 | 保存即生效 |
| 表达偏好、长期和短期记忆 | 设置页各自的编辑框 | 分别保存，下次使用 |

配置文件和备份位置见 [存储与恢复](https://github.com/l-ziming/mono-calendar/blob/main/docs/assistant.md#存储与恢复)。

## 基础实体配置

字段参照 `config.example.json` 和 HA 表单。传感器支持 `entity_id#attribute`，设备、天气和图片填实体 ID。独立部署读取同格式的 `config.json`。

| 字段 | 用途 |
| --- | --- |
| `entities.climate` | 空调和 Nest 风扇 |
| `entities.living_*` / `bedroom_*` | 各房间实际温湿度传感器 |
| `entities.weather` | HA 天气；逐小时降水概率、风速与风向 |
| `entities.outdoor_aqi` | 室外 AQI；美国来源设 `aqi_input_standard: US` |
| `aqi_input_standard` / `aqi_cn_period` | 中国来源要填标准版本和浓度时段；屏幕统一按美国 EPA 2024 标准显示 |
| `entities.co2` | 当前值与 24 小时历史，需 HA Recorder 记录 |
| `entities.bedroom_light` / `desk_light` | 灯或开关 |
| `entities.humidifier` | 加湿器状态，仅作助手资料 |

缺测显示「—」。助手图片使用 `image.*` 实体，居中裁成 128×128 灰度图；留空显示引号。

## 房间和设备

在 HA App 配置页填写 `rooms` 和 `devices`，保存并重启。房间最多 6 个，设备最多 8 个，按列表顺序显示；数量增加时屏幕改为多列、两行排列。名称最长 32 字，屏幕按可用宽度截断。两个空列表沿用上面的旧实体映射，已有安装无需迁移。

```yaml
rooms:
  - id: living
    name: 客厅
    temperature: climate.living_room#current_temperature
    humidity: climate.living_room#current_humidity
  - id: bedroom
    name: 卧室
    temperature: sensor.bedroom_temperature
    humidity: sensor.bedroom_humidity
  - id: study
    name: 书房
    temperature: sensor.study_temperature
    humidity: sensor.study_humidity
devices:
  - id: desk_light
    name: 书桌灯
    entity: light.desk
    type: toggle
  - id: circulator
    name: 循环扇
    entity: fan.study
    type: toggle
  - id: central_fan
    name: 空调风扇
    entity: climate.living_room
    type: nest_fan
```

房间的温度、湿度可留空，传感器支持 `entity_id#attribute`，缺测显示「—」。`id` 以小写字母开头，只用小写字母、数字和下划线，最长 32 字符，同一列表内不能重复。设备实体不能重复；`toggle` 只控制 `light`、`switch` 和 `fan` 的开关，`nest_fan` 只用于支持 Nest 定时风扇的 `climate` 实体，开启后由设备自身的 15 分钟定时器关闭。

配置名单内的设备才可通过屏幕控制。助手读取全部已配置设备；房间温湿度仍按各自有效读数求平均提供给助手。

## 日历接入

1. 在 HA 添加 CalDAV。iCloud 地址为 `https://caldav.icloud.com/`，填写 Apple 账户邮箱和 App 专用密码，保持证书验证开启。
2. 在 HA 日历页检查生成的 `calendar.*` 实体和日程。
3. 在「助手设置 → 记忆与资料来源 → 日历」填写实体，逗号分隔，最多 8 个；留空关闭。

日历缓存约 15 分钟，切换来源时刷新。屏幕最多四行，隐藏今天已结束的定时日程，有空位时显示未来七天内的下一次安排。

## 新闻与 NYT 邮件

| 来源 | 取哪些内容 |
| --- | --- |
| NYT 日报 | HA IMAP 实体，按配置时区筛选当天发送的邮件 |
| 人民日报 | 最新头版最多三条，版期为上海当天或前一天，文章路径日期也要一致 |
| 中新网 | 官方 RSS，发布日期带时区，按配置时区筛选当天新闻 |
| 本地新闻 | Google News 城市 RSS，和天气共用城市，筛选当天新闻 |

公开新闻按城市和日期缓存约 30 分钟。新闻模式控制屏幕播报，聊天仍可以读取当期新闻。

### 接入 NYT 邮件

1. 在 HA IMAP 选择实际使用的 `News` 文件夹，保持 SSL 验证开启。查询可用 `UNDELETED SENTSINCE 01-Jan-2026`，排除启用日期之前的归档。
2. 启用事件 `text`，把 [清理模板](https://github.com/l-ziming/mono-calendar/blob/main/deploy/home-assistant/imap-newsletter-template.txt) 全文填入自定义事件数据模板。
3. 按 [邮件实体模板](https://github.com/l-ziming/mono-calendar/blob/main/deploy/home-assistant/mono-calendar-newsletter.yaml) 填写自己的 IMAP `entry_id` 和文件夹。
4. 把模板中的 Recorder 排除项加到现有配置，排除日报实体和 `imap_content` 事件历史。
5. 在助手设置选择新闻邮件实体，通常是 `sensor.mono_calendar_nyt_newsletter`，需要有 `body`、`date`、`subject`、`sender` 四个字符串属性；留空关闭。

## RP1 客户端与运行检查

连接配置默认放在 `.local/rp1-connection.json`：

```json
{"endpoint": "http://HA局域网IP:8080", "token": "<display_token>"}
```

在仓库根目录安装 `dist/rp1-calendar.apk` 并写入连接设置：

```sh
python3 scripts/configure-rp1.py <连接配置.json> --serial <设备序列号>
```

设备时间有误时，开启 Android 自动时间后检查实际日期。

`bash scripts/check.sh` 运行模拟测试和桌面绘制。接口认证与操作超时见 [接口与验证](https://github.com/l-ziming/mono-calendar/blob/main/docs/assistant.md#接口与验证)。

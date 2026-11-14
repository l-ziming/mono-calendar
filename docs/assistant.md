# 助手设置与行为

在 `http://HA局域网IP:8080/` 可以聊天和修改助手设置。安装、HA 配置和邮件接入写在 [ha-app/DOCS.md](../ha-app/DOCS.md)。

## 配置

首次保存前使用 HA 选项，之后使用网页配置，重启和升级会保留。

版本冲突时保留网页草稿；请求执行期间不能修改配置。API Key 留空会保留原值，勾选清除时才删除。

| 设置 | 默认值与范围 |
| --- | --- |
| `assistant_prompt` | 最多 20000 字符；留空时读取 `ha-app/server/assistant/default-prompt.txt`，发布版不含此文件，默认空提示词 |
| `assistant_screen_times` | 06:30、11:30、16:30、21:00；最多 24 个 `HH:MM`，按配置时区执行；留空关闭 |
| `assistant_screen_min_minutes` | 15；两次实际修改的最小间隔，可设 0–1440 分钟 |
| `assistant_screen_max_per_hour` | 4；滚动一小时内的修改次数上限，可设 1–60 次；保持原内容不计数 |
| `assistant_screen_quiet_start` / `assistant_screen_quiet_end` | 23:00 / 06:00；只限制定时更新，手动检查可更新；可跨午夜，起止时间相同则关闭静默 |
| `assistant_news_mode` | `morning_and_major`；也可选 `off`、`morning`，只影响屏幕内容 |
| `assistant_news_interval_hours` | 6；重大新闻的最小间隔，可设 1–168 小时 |
| `assistant_context_tokens` | 32768；可设 16384–131072 |
| `assistant_memory_ttl_days` | 14；新短期条目的默认期限，可设 1–365 天 |
| `llm_model` / `llm_base_url` | `deepseek-flash` / `https://api.deepseek.com`；API 根地址须使用 HTTPS |
| `llm_thinking` / `llm_reasoning_effort` | 开启 / `high`；强度可选 `low`、`high`、`max`，关闭 Thinking 时不发送强度参数 |
| `llm_max_tokens` | 0 表示不发送上限参数；也可设 1–393216，仍受模型上下文限制 |
| `calendars` | 最多 8 个 `calendar.*` 实体；留空关闭 |
| `assistant_entities` | 最多 24 个辅助实体 |
| `assistant_presence_entities` | 最多 8 个 `person.*`、`device_tracker.*` 或 `binary_sensor.*` |
| 屏幕文本、图片、新闻邮件实体 | 对应 `entities.assistant_text`、`assistant_image`、`newsletter`，保存即生效 |

时区、城市、天气、设备映射和屏幕认证在 HA 配置中设置。

## 决策与资料

聊天和屏幕共用当前情境、新闻、记忆、偏好、近期问答和最多 24 次已确认便条。用户的新更正优先，设备状态只作环境参考。

屏幕在配置的时刻或手动检查时评估便条，空屏也会重新评估。环境变化只刷新资料，聊天不会推送屏幕内容或控制设备。

聊天优先于后台检查，可以中断后台任务。每轮通常请求一次模型；读取新闻全文或模型只提出记忆操作时，最多再请求一次，每次最长 180 秒。

新闻最多十条，每条包含 ID、标题、来源、时间和最多 400 字摘要。每轮最多读取两条已有 ID、来源在允许范围内的新闻全文。

上下文按 UTF-8 字节估算，固定资料超过预算时返回 413，可提高预算或精简记忆。

屏幕内容为 1–4 行，每行不超过 52 个宽度单位；没有采用新闻时最多三行，有效期在未来六小时内。有效便条可以继续保留，没有可靠内容时留白。错过的时刻不补发，同一个当地时刻只检查一次。

## 记忆与表达偏好

| 文档 | 内容 | Unicode 字符上限 |
| --- | --- | ---: |
| `style.md` | 用户明确表达的措辞、篇幅和重复提醒偏好 | 3000 |
| `long-term.md` | 稳定事实、习惯与长期约定 | 3000 |
| `short-term.md` | 临时安排、近期意愿与未结束事项 | 6000 |

三份文档在设置页分别编辑和保存，系统提示词也由用户编辑。

模型根据用户原话更新记忆，每轮最多 16 项，删除需要明确证据。新短期条目按用户给出的期限或默认 TTL 到期。

## 存储与恢复

对话可逐轮删除或全部清空，操作前会确认。清空包括页面未显示的问答，删除结果在重启后保留。聊天、屏幕检查或设置保存期间不能删除；对话有更新时，先刷新页面再操作。

| 位置 | 内容 |
| --- | --- |
| `/config/assistant-settings.json` | 网页配置，包含密钥，文件权限为 0600 |
| `/config/assistant-memory/` | 三份记忆文档和版本日志 `memory-revisions.jsonl` |
| `/data/assistant-history.jsonl` | 完整成功问答，每行一轮 |
| `/data/assistant-chat.json` | 近期会话与环境观察 |
| `/data/assistant-state.json` | 屏幕调度、便条及新闻采用状态 |
| `/data/assistant-decisions.jsonl` | 决策摘要和每次请求的用量，约 1 MiB 时轮转，保留上一份 |

HA 共享目录里的 `/config` 对应 `app_configs/<前缀>_mono_calendar/`。手动复制安装时，前缀是 `local`；从仓库地址安装时，使用仓库前缀。旧版目录可能叫 `addon_configs`。

备份时同时保存 App 数据和配置，记忆 Markdown 与版本日志一起保留。

日志不包含密钥、完整输入或邮件正文。独立运行时可用 `assistant_settings_file`、`assistant_memory_dir`、`assistant_state_file` 等配置覆盖默认位置。

## 接口与验证

| 接口 | 用途 |
| --- | --- |
| `GET /` | 对话与助手设置 |
| `GET /assistant/state` | 情境、近期对话、记忆与设置；密钥只返回是否配置 |
| `POST /assistant/chat` | `{message}`，SSE 回答 |
| `DELETE /assistant/chat` | `{id, revision}` 删除一轮，或 `{all: true, revision}` 清空；ID 与 `chat_revision` 取自 `GET /assistant/state` |
| `PUT /assistant/settings` | `{options, revision}` 保存设置 |
| `PUT /assistant/memory` | `{kind, text, revision}` 保存记忆或偏好 |
| `POST /assistant/panel` | 手动屏幕检查，允许保持 |
| `GET /data`、`GET /image`、`GET /health`、`POST /action` | 屏幕数据、图片、健康与设备操作；要求屏幕 Bearer 令牌 |

网页和助手接口不需要登录，也没有 Ingress。浏览器请求限同源，能访问这个端口的局域网设备可以读写资料；屏幕接口拒绝带浏览器来源的请求。

手动屏幕操作的时间预算是 390 秒，灯和空调是 10 秒，Nest 风扇是 60 秒。设备操作超时后会再次检查状态。

`bash scripts/check.sh` 用模拟的 HA 和模型做检查，`node scripts/preview-assistant.mjs` 生成离线预览。

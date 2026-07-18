# Rust 后端模块导览

> 状态：Current · 适用版本：v0.5.13 · Owner：Backend · 最后复核：2026-07-14

`src-tauri/src/` 下每个模块的职责和依赖点。核心入口是 `lib.rs` 的 `run()`（`main.rs` 只转调）。启动顺序、模块初始化、Tauri 命令注册全部在 `lib.rs` 的 `setup(|app| { ... })` 里。

**浮动窗口 / 全局快捷键 toggle / managed State**：见专文 [shell-and-shortcuts.md](./shell-and-shortcuts.md)（优先读，勿整库反查）。

## 顶层

| 文件 | 职责 |
|---|---|
| `main.rs` | thin wrapper，只调 `qx::run()` |
| `lib.rs` | 应用装配：托盘、全局快捷键、`generate_handler!`、`ActivationPolicy::Accessory`、`safe_init` 启动子系统 |
| `floating_panel.rs` | 主窗口面板化；`PANEL_OPEN` / `ACTIVE_ROUTE`；`toggle` / `toggle_route`；hide 必须经此模块（见 shell-and-shortcuts） |

## 输入 / 索引

| 文件 | 职责 |
|---|---|
| `apps.rs` | 扫描 `/Applications`、`~/Applications`、系统内建 utilities，解析 `Info.plist`，`sips` 生成 icon PNG，中文 pinyin fuzzy 匹配 (`apps_zh_dict.rs`) |
| `apps_zh_dict.rs` | 常见 macOS app 的中文别名 → pinyin 词典 |
| `file_search.rs` + `file_search/platform_{macos,windows}.rs` | 共享文件分类、去重、排序与 latest-wins 调度；macOS Cardinal/Spotlight 和 Windows Everything 分别封装在平台适配器中 |
| `history.rs` | `launch_history` / `search_history` / `search_click_events` SQLite 表；`record_*` 后台写入，`get_*` 批量读取；搜索结果 30 天点击量聚合供推荐加权 |
| `system_stats.rs` | Mach APIs：`host_processor_info`（每核 CPU）、`host_statistics64`（内存），供 `HomeSystemIsland` 每 1.6s 轮询 |
| `system_information.rs` | 主机名/芯片/内存/存储/网络/进程列表；`kill_process` 通过 `/bin/kill` 发 SIGTERM |
| `runtime/` | **线程调度系统能力**：主线程 UI 事务（`ui`/`run_ui`）、blocking 算力池、跨平台主线程 id；所有窗口/剪贴板操作必须经此层。见 [runtime-threading.md](./runtime-threading.md) |
| `display.rs` | Qx 系统级显示器服务：统一枚举、稳定 ID、主屏/内置屏/外接屏识别、鼠标所在屏幕、Tauri↔捕获后端映射、区域 still-frame 捕获（`capture_region`）；公共 IPC `display_list`；业务模块不得重复实现识别或抓帧 |
| `desktop_windows.rs` | Qx 系统级顶层窗口清单：可见窗枚举、几何、z 序、按显示器裁剪与逻辑坐标换算；公共 IPC `desktop_windows_list`；截图窗选等只消费该服务，禁止 feature 内直接 `xcap::Window` |
| `display_monitor.rs` | 复用系统级显示器服务监听插拔并发出 `display:changed`，不得自行枚举或分类显示器 |
| `external_displays.rs` | 检测/安装 DDC CLI 驱动并设置外接显示器亮度、音量等硬件控制项；只负责 DDC 设备与控制协议，不承担 Qx 通用显示器识别 |

## 数据模块

| 文件 | 数据库 | 说明 |
|---|---|---|
| `clipboard.rs` | `Application Support/qx/clipboard.db` | 始终 `manage(ClipboardDb(Option<Connection>))`；失败可 lazy 重连；后台轮询系统剪贴板 |
| `rss/mod.rs` + `fetcher.rs` + `storage.rs` + `types.rs` | `Application Support/qx/rss.db` | **始终** `manage(RssDb(Option<Connection>))` + `ensure_open`；feed-rs / OPML / folders；文章 `reading_progress` 归一化持久化；首次打开写入默认订阅目录；订阅图标：feed icon/logo → 站点 favicon（Google S2，AnyFeeder 等桥接源用文章域名） |
| `v2ex.rs` | `cache/v2ex/*.json` | 抓 v2ex.com JSON；**内存 + 磁盘 TTL 缓存**（topics ~3min，replies ~2min，失败可回退 stale）；hot/latest 无需 token，node/notification 需 token（命令可接收插件 preference 的 `token` 覆盖）；市场插件 `v2ex` 走 `invoke:v2ex_*` + 插件 persist SWR |
| `weather.rs` (host API for marketplace **Weather** plugin + optional built-in) | 无 | ipapi.co 定位 → Open-Meteo（默认）或 OpenWeatherMap（需 key） |
| `github_calendar.rs` | 无 | 抓 GitHub profile 页面提取 `ContributionCalendar` |

## 媒体 / 输入模拟

| 文件 | 依赖 crate | 说明 |
|---|---|---|
| `media/` | OpenH264 + `mp4` + `gifski` | Qx 根级媒体服务；统一负责 H.264 码流/MP4 封装、媒体尺寸约束和 GIF 转换，不依赖截图模块或其历史库，供截图、剪贴板、OCR、文件预览等能力复用。 |
| `clipboard.rs` | arboard + clipboard-manager | 系统剪贴板；公共 IPC `clipboard_write_image_file` 将磁盘图片发布到剪贴板，供捕获 toast / 历史回写等复用。 |
| `screencap/` | 消费系统能力 | **仅捕获工作流**：圈选 session、录制生命周期、历史、控制岛、标注合成。显示器 / 窗列表 / 区域抓帧 / 剪贴板写图走 `display` · `desktop_windows` · `clipboard` · `media`；禁止模块内直接 `xcap::Window` 或重复显示器识别。 |
| `ocr.rs` | 内建轻量 OCR (`~/.oar` 存模型) | PP-OCRv6 tiny/small/medium 下载 + 增量校验 |
| `macro_recorder.rs` | `rdev` + `enigo` | 记录键鼠事件到 `~/.qx/macros.db`；replay 通过 `enigo` 模拟 |

## AI

| 文件 | 说明 |
|---|---|
| `g4f.rs` | 内置 OpenRouter（默认）与 DeepSeek BYOK provider + 自定义 OpenAI-compatible BYOK；内置供应商固定 endpoint/model，用户只保存 API Key；`qxai_stream_chat_events` 起线程通过 `qxai://stream` 事件回推 chunk |
| `plugin_api.rs` | 面向插件的受控 AI 入口：`plugin_ai_chat/stream_chat/run_bash/grep_search/memory_*`；bash 子进程强制 timeout 且用 `bash -lc` 白名单 |
| `http_client.rs` | 复用的 reqwest 客户端（异步和 blocking 两份），设置 UA / timeout / accept-encoding |

## 插件 / 市场

| 文件 | 说明 |
|---|---|
| `marketplace/mod.rs` | `.qx-plugin` 安装、签名（ed25519）、`~/.qx/plugins/<id>/` 落盘、`index.json` 抓取、Raycast extension 转换、开发脚手架 |
| `permissions.rs` | macOS TCC：屏幕录制 / 辅助功能 / 输入监控 状态与请求 |
| `storage.rs` | 分桶统计 `~/.qx` 磁盘占用；`clear_cache/clear_files/clear_clipboard` |
| `settings/mod.rs` | `~/.qx/settings.json` 读写；写入后 re-register 全局快捷键 + 刷新托盘菜单 + emit `settings-updated` |
| `settings/entry_config.rs` | Launcher 快捷入口与托盘动作的默认配置；兼容识别旧版默认快捷入口，避免覆盖用户自定义 |
| `updater.rs` | 读取 release manifest，比较版本并下载安装更新 |
| `diagnostics.rs` | 结构化诊断事件与日志文件路径，供前端和异步任务定位问题 |

## 通用工具

| 文件 | 说明 |
|---|---|
| `http_client.rs` | 见上 |
| `vendor/cardinal/*` | 内嵌自研的 `search-cache` / `search-cancel` / `fswalk` 三个 crate（未上传 crates.io） |
| `file_search.rs` | 规范化并拒绝空白查询；文件名匹配统一忽略大小写与空格/连字符/下划线/点号等弱分隔，并为至少三个字符的查询提供有序子序列模糊召回。macOS 使用 Cardinal token/wildcard，Windows 只使用 Qx 随包提供的 Everything/ES 二进制和命名实例 `Qx`，不回退或操作用户安装的 Everything；查询使用 `nopath:` token/wildcard。每个 pass 只占一个 blocking 任务，并在任务内按用户分类优先召回与平衡结果。`request_id` 提供 latest-wins 淘汰，Cardinal 锁只保护内存索引且不跨 `mdfind` 等待；前端渐进合并多 pass。两端最终只接受 leaf-name 命中，按用户分类排序，分类内默认按 `modified_at` 倒序。 |

## 启动顺序（lib.rs `run` → `setup`）

顺序随版本微调；核心是：

1. 读 `~/.qx/settings.json`；`floating_panel::install`（Accessory + 面板化）
2. `settings::register_shortcuts` — 默认 **Alt+Space** 切换当前窗口显隐；**Alt+Shift+Space** 为 Launcher 搜索（默认关）
3. `safe_init` 包裹子系统（panic 不拖垮 setup）：
   - `clipboard::start_listener` — **始终 manage** ClipboardDb
   - `rss::init` — **始终 manage** RssDb（open 失败存 `None`，命令路径 lazy open）
   - settings / apps cache / file_search / icon preload 等
4. 托盘、display monitor 等

`safe_init` 只吞 **panic**；若 init 在 manage 之前就 panic，仍会缺 State——因此 init 应把 fallible IO 收成 `Result`，manage 放末尾且无条件。

## 添加新模块的推荐流程

1. `src-tauri/src/<module>.rs` 定义 `#[tauri::command]` 函数（`Result<T, String>` 签名）
2. `mod <module>;` 加到 `lib.rs`
3. `tauri::generate_handler![...]` 把新命令名追加进去
4. 若有 `State<T>`：**启动时无条件 `app.manage(T)`**（连接可 `Option` + lazy open）
5. `App.tsx` 或对应 module 用 `invoke("cmd_name", { args })` 调用
6. 更新 [`docs/ipc-catalogue.md`](./ipc-catalogue.md)，并运行 `npm run docs:check`
7. 若挂全局快捷键：在 `register_shortcuts` 用 `toggle_route`，并更新 [shell-and-shortcuts.md](./shell-and-shortcuts.md)
8. 如果需要 macOS 权限（TCC），把 id 加到 `permissions.rs::MacPermissionKind` 并在 UI 提示

## 常见坑

- **不要在 command 里做长任务**：会阻塞 IPC 线程。用 `std::thread::spawn` + `Emitter::emit` 回传。
- **不要在后台线程碰 UI**：Tauri v2 的 UI 只能主线程操作；从后台调 `app.get_webview_window(...).show()` 会 panic。用事件 + 前端消费。
- **managed State 必须始终 manage**：`if let Ok(conn) = open() { manage }` 会在 open 失败时导致 *state not managed*。对照 RSS/Clipboard，见 shell-and-shortcuts §5。
- **隐藏窗口不要只调 `Window::hide`**：应走 `floating_panel::hide*`，否则全局快捷键 toggle 与 `PANEL_OPEN` 不同步。见 shell-and-shortcuts §2–§4。
- **全局快捷键是 toggle**：再按同一模块键应关窗，不是再 show 一次。
- **NSPanel 相关的 selector**（`setBecomesKeyOnlyIfNeeded:`、`setFloatingPanel:`、`0x80` styleMask）**在纯 NSWindow 上会 abort**。Tauri 创建的是 NSWindow，所以 `floating_panel.rs` 只用 NSWindow-safe 的 API。见 v0.4.41 修复。
- **objc2 0.6 的 `set_class`** 有 debug_assert 检查新旧类的 instance size 相等，NSPanel 464 vs NSWindow 456，会 panic。想真变 NSPanel 得用 `tauri-nspanel` 或自建窗口。
- **命令重命名要同步搜前端** `Grep '"<old_name>"' src/`；漏改会导致运行时 `command not found` 报错。

# Rust 后端模块导览

> 状态：Current · 适用版本：v0.4.61 · Owner：Backend · 最后复核：2026-07-10

`src-tauri/src/` 下每个模块的职责和依赖点。核心入口是 `lib.rs` 的 `run()`（`main.rs` 只转调）。启动顺序、模块初始化、Tauri 命令注册全部在 `lib.rs` 的 `setup(|app| { ... })` 里。

## 顶层

| 文件 | 职责 |
|---|---|
| `main.rs` | thin wrapper，只调 `qx::run()` |
| `lib.rs` | 应用装配：托盘、全局快捷键、`generate_handler!`、`ActivationPolicy::Accessory`、启动各模块的 background thread |
| `floating_panel.rs` | 主窗口面板化（NSWindow + Accessory policy），非激活式显示、`show_on_cursor_monitor` |

## 输入 / 索引

| 文件 | 职责 |
|---|---|
| `apps.rs` | 扫描 `/Applications`、`~/Applications`、系统内建 utilities，解析 `Info.plist`，`sips` 生成 icon PNG，中文 pinyin fuzzy 匹配 (`apps_zh_dict.rs`) |
| `apps_zh_dict.rs` | 常见 macOS app 的中文别名 → pinyin 词典 |
| `file_search.rs` | Spotlight / mdfind 包装 + 结果缓存 |
| `history.rs` | `launch_history` / `search_history` SQLite 表；`record_*` 命令后台写入，`get_*` 命令批量读取 |
| `system_stats.rs` | Mach APIs：`host_processor_info`（每核 CPU）、`host_statistics64`（内存），供 `HomeSystemIsland` 每 1.6s 轮询 |
| `system_information.rs` | 主机名/芯片/内存/存储/网络/进程列表；`kill_process` 通过 `/bin/kill` 发 SIGTERM |
| `display_monitor.rs` | 用 `xcap` 监听显示器插拔，接入外接屏时自动 `floating_show` |
| `external_displays.rs` | 检测/安装 DDC CLI 驱动，枚举外接显示器并设置亮度、音量等控制项 |

## 数据模块

| 文件 | 数据库 | 说明 |
|---|---|---|
| `clipboard.rs` | `~/.qx/clipboard.db` | 后台线程 100ms 轮询系统剪贴板；图片存 PNG 落盘、DB 存路径 |
| `rss/mod.rs` + `fetcher.rs` + `storage.rs` + `types.rs` | `~/.qx/rss.db` | feed-rs 解析，OPML 导入导出，refresh 通过 `http_client` |
| `v2ex.rs` | 无 | 直接抓 v2ex.com HTML/JSON；hot/latest 无需 token，node/reply/notification 需 access token |
| `weather.rs` | 无 | ipapi.co 定位 → Open-Meteo（默认）或 OpenWeatherMap（需 key） |
| `github_calendar.rs` | 无 | 抓 GitHub profile 页面提取 `ContributionCalendar` |

## 媒体 / 输入模拟

| 文件 | 依赖 crate | 说明 |
|---|---|---|
| `screencap.rs` | `scrap` + `gifski` | 后台线程 BGRA 抓帧 → gifski 编码。停止时 flush 到 `~/.qx/gifs/`，写 `screencap_history.db` |
| `ocr.rs` | 内建轻量 OCR (`~/.oar` 存模型) | PP-OCRv6 tiny/small/medium 下载 + 增量校验 |
| `macro_recorder.rs` | `rdev` + `enigo` | 记录键鼠事件到 `~/.qx/macros.db`；replay 通过 `enigo` 模拟 |

## AI

| 文件 | 说明 |
|---|---|
| `g4f.rs` | 内置 provider catalog（DuckDuckGo 等）+ OpenAI-compatible BYOK；`qxai_stream_chat_events` 起线程通过 `qxai://stream` 事件回推 chunk |
| `plugin_api.rs` | 面向插件的受控 AI 入口：`plugin_ai_chat/stream_chat/run_bash/grep_search/memory_*`；bash 子进程强制 timeout 且用 `bash -lc` 白名单 |
| `http_client.rs` | 复用的 reqwest 客户端（异步和 blocking 两份），设置 UA / timeout / accept-encoding |

## 插件 / 市场

| 文件 | 说明 |
|---|---|
| `marketplace/mod.rs` | `.qx-plugin` 安装、签名（ed25519）、`~/.qx/plugins/<id>/` 落盘、`index.json` 抓取、Raycast extension 转换、开发脚手架 |
| `permissions.rs` | macOS TCC：屏幕录制 / 辅助功能 / 输入监控 状态与请求 |
| `storage.rs` | 分桶统计 `~/.qx` 磁盘占用；`clear_cache/clear_files/clear_clipboard` |
| `settings/mod.rs` | `~/.qx/settings.json` 读写；写入后 re-register 全局快捷键 + 刷新托盘菜单 + emit `settings-updated` |
| `updater.rs` | 读取 release manifest，比较版本并下载安装更新 |
| `diagnostics.rs` | 结构化诊断事件与日志文件路径，供前端和异步任务定位问题 |

## 通用工具

| 文件 | 说明 |
|---|---|
| `http_client.rs` | 见上 |
| `vendor/cardinal/*` | 内嵌自研的 `search-cache` / `search-cancel` / `fswalk` 三个 crate（未上传 crates.io） |

## 启动顺序（lib.rs `run` → `setup`）

1. `settings::load_settings()` 从 `~/.qx/settings.json` 读初始配置
2. `ClipboardDb`、`RssDb`、`screencap history db`、`macro db` 分别初始化
3. `apps::start_index_worker()` 在后台线程扫描 apps
4. `file_search::init()` 起 Spotlight 观察线程
5. `clipboard::start_polling_thread()` 剪贴板轮询
6. `display_monitor::start_display_monitor()` 显示器监听
7. `TrayIconBuilder` 挂载状态栏图标（`tray-template.png`）
8. `floating_panel::install(app)` 设置 `ActivationPolicy::Accessory` + 面板化窗口
9. `settings::register_global_shortcuts()` 注册用户自定义全局热键（默认 `Cmd+Space`）

## 添加新模块的推荐流程

1. `src-tauri/src/<module>.rs` 定义 `#[tauri::command]` 函数（`Result<T, String>` 签名）
2. `mod <module>;` 加到 `lib.rs`
3. `tauri::generate_handler![...]` 把新命令名追加进去
4. `App.tsx` 或对应 module 用 `invoke("cmd_name", { args })` 调用
5. 更新 [`docs/ipc-catalogue.md`](./ipc-catalogue.md) 的领域说明和注册命令基线，并运行 `npm run docs:check`
6. 如果需要 macOS 权限（TCC），把 id 加到 `permissions.rs::MacPermissionKind` 并在 UI 提示

## 常见坑

- **不要在 command 里做长任务**：会阻塞 IPC 线程。用 `std::thread::spawn` + `Emitter::emit` 回传。
- **不要在后台线程碰 UI**：Tauri v2 的 UI 只能主线程操作；从后台调 `app.get_webview_window(...).show()` 会 panic。用事件 + 前端消费。
- **NSPanel 相关的 selector**（`setBecomesKeyOnlyIfNeeded:`、`setFloatingPanel:`、`0x80` styleMask）**在纯 NSWindow 上会 abort**。Tauri 创建的是 NSWindow，所以 `floating_panel.rs` 只用 NSWindow-safe 的 API。见 v0.4.41 修复。
- **objc2 0.6 的 `set_class`** 有 debug_assert 检查新旧类的 instance size 相等，NSPanel 464 vs NSWindow 456，会 panic。想真变 NSPanel 得用 `tauri-nspanel` 或自建窗口。
- **命令重命名要同步搜前端** `Grep '"<old_name>"' src/`；漏改会导致运行时 `command not found` 报错。

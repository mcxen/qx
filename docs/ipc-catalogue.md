# IPC 命令目录

> 状态：Current · 适用版本：v0.5.17 · Owner：Backend · 最后复核：2026-07-15
>
> 事实来源：`src-tauri/src/lib.rs` 中的 `tauri::generate_handler!`

Qx 前后端通过 Tauri v2 的 `invoke` 通道通信。当前 `tauri::generate_handler!` 注册 **196 个命令**；不要引用易漂移的固定行号。本文按领域解释主要接口，文末“注册命令基线”必须与注册宏逐项一致。

`capabilities/default.json` 声明 Tauri IPC 边界及插件权限（`opener`、`global-shortcut`、`clipboard-manager`、`shell`、`core:window`、`core:path`）。任何窗口若未匹配 capability，就不能使用 IPC；当前 `main`、`recording-controls` 和 `region-picker` 都必须显式列入。自定义命令仍由 `generate_handler!` 注册，但动态创建的捕获窗口不能省略窗口 capability。

新增命令后请同步更新本表和调用方。

## apps

| 命令 | 签名 | 用途 |
|---|---|---|
| `search_apps` | `(query: String) -> Vec<AppEntry>` | 已安装 `.app` 打分排序，空 query 返回前 20 |
| `search_files` | `(query: String, pass?: u32, categories?: FileSearchCategory[], category_id?: String, request_id?: u64) -> Vec<AppEntry>` | Cardinal / Everything 文件名搜索；Launcher 显式传 `pass=0/1/2` 获得渐进批次并自行合并，QxAI / 插件等省略 `pass` 的调用方由后端执行并去重全部三轮，不能退化为仅 quick pass；`request_id` 使旧查询失效；所有平台统一 leaf-name 后置匹配，短 ASCII 查询不做松散逐字符召回；返回可选 `modified_at`，同分类先按名称相关性、再按修改时间倒序；Spotlight 作为 macOS 补充回退 |

调用方：`App.tsx`、`plugin/runtime.ts`、`plugin/context.ts`、`modules/qx-ai/react-agent.ts`

## clipboard

| 命令 | 用途 |
|---|---|
| `get_clipboard_history(limit?)` | 读取热窗口（置顶 + 最近）文本/图片/原生文件列表；文件返回主项 `file_path`、有序 `file_paths` 与 `file_kind`。默认约 80 条；完整冷存储分页见 `get_clipboard_history_page` |
| `get_clipboard_history_page(limit?, before_timestamp?, before_id?, before_pinned?, query?)` | 游标分页：首屏热窗口 omit `before_*`；滚到底传入上一页 `next_before_*` 加载冷存储更早记录。`query` 在全文/OCR/路径上检索。返回 `{ items, has_more, next_before_* }` |
| `get_clipboard_entry(id)` | 按 id 读取单条（热/冷均可见），供深链粘贴 |
| `read_clipboard_image_now()` | 立即读当前剪贴板图片，落盘并触发 `clipboard-updated` |
| `write_clipboard_image_entry(id)` | 将历史图片回写系统剪贴板 |
| `write_clipboard_file_entry(id)` | 使用原有顺序将历史文件列表作为真实文件对象整体回写系统剪贴板，使用时逐项校验存在性 |
| `clipboard_write_file_paths(paths)` | 将现有本地路径列表按原生文件对象写入剪贴板（macOS file list / Windows `CF_HDROP`）；供 QxAI 与内置模块复用，不降级为路径文本 |
| `clipboard_write_image_file(path)` | **系统能力**：把磁盘上的图片文件写入系统剪贴板（捕获 toast、导出等） |
| `clipboard_file_metadata(path)` | 异步读取文件大小、图片尺寸、媒体时长与预览 |
| `clipboard_compress_image(path, quality?)` | 启动后台图片压缩任务 |
| `clipboard_video_to_gif(path)` | 启动后台视频转 GIF 任务 |
| `clear_clipboard_history()` | 清空全部 |
| `delete_clipboard_entry(id)` | 删单条 |
| `toggle_clipboard_pin(id)` | 置顶开关 |
| `record_clipboard_copy(id)` | 累加 `copy_count` |
| `update_clipboard_text_entry(id, text)` | 明确保存文本条目的编辑草稿，不自动改写系统剪贴板 |
| `create_clipboard_text_entry(text)` | 将文本草稿另存为新历史条目并返回 ID |
| `read_image_file(path)` | 校验魔数后读磁盘图片二进制 |

## display / desktop windows（系统能力层）

| 命令 | 用途 |
|---|---|
| `display_list()` | 枚举显示器（稳定 ID、名称、尺寸、刷新率、缩放、旋转、主屏/内置屏，以及平台可提供的连接协议与 EDID 厂商/产品码）。**任何功能**需要显示器信息都走此命令，不得自建枚举；插件通过 `context.system.displays()` 消费。 |
| `display_brightness_list()` | 以同一模型列出 macOS/Windows 内置屏与外接屏亮度目标；保留 `rawCurrent/rawMax`、百分比、后端和失败阶段/错误码，避免识别失败被静默丢弃；插件通过 `context.system.displayBrightness()` 消费。 |
| `display_brightness_set(display_id, value)` | 设置统一显示器亮度目标（0–100）；macOS 内置屏走 DisplayServices、外接屏走内嵌 DDC/CI，Windows 内置屏走 WMI、物理显示器走 Win32 Monitor Configuration。 |
| `desktop_windows_list(query?)` | 枚举可见顶层窗口；可选按 `monitorId` 裁剪、`logicalScale` 换算逻辑坐标、名称排除。截图窗选、布局工具等共用。 |

前端端口：`src/system/display.ts`、`src/system/desktopWindows.ts`、`src/system/clipboard.ts`。

## rss

`rss_list_feeds`、`rss_add_feed(url)`、`rss_update_feed(id, url, title)`、`rss_remove_feed(id)`、`rss_list_articles(feed_id?, only_unread, query?)`、`rss_dashboard_snapshot(limit?)`、`rss_get_article(id)`、`rss_mark_read(id, is_read)`、`rss_set_reading_progress(id, progress)`、`rss_mark_all_read(feed_id)`、`rss_toggle_star(id, is_starred)`、`rss_refresh_feed(id)`、`rss_refresh_all()`、`rss_import_opml(content)`、`rss_export_opml()`、`rss_list_folders`、`rss_create_folder(name, parent_id?)`、`rss_rename_folder(id, name)`、`rss_delete_folder(id)`、`rss_set_feed_folder(feed_id, folder_id?)`、`rss_fetch_original_content(url)`、`rss_cache_article_image(url, referer?)`。`rss_dashboard_snapshot` 只返回未读总数和有界的最新文章标题、订阅源、链接及时间，不返回正文/图片；它是 Launcher Home 与轻量 Provider 的原子读取端口，前端先画本地缓存再后台刷新。两种刷新命令在真实 HTTP / 解析 / 持久化过程中发布 `rss:refresh-progress`；全量刷新 payload 的 `completed / total / failed` 以数据库完整订阅集合为基准。正文图片命令复用 Qx HTTP 代理配置，将受支持的远程位图限量下载到 `cache/rss-article-images`，把命中的具体缓存文件加入 Tauri asset protocol scope 后返回本地路径；前端不得让 WebView 绕过该端口直接承担正文图片网络兼容。

## v2ex

`v2ex_fetch_topics(mode)`、`v2ex_search_topics(query)`、`v2ex_fetch_node_topics(node)`（需 token）、`v2ex_fetch_topic_replies(topic_id)`、`v2ex_fetch_token_info()`、`v2ex_fetch_notifications()`。

## weather

`detect_location()`（IP 定位）、`fetch_weather()` / `fetch_weather_for_location()`（Open-Meteo / OpenWeatherMap）、`get_cached_weather()` / `get_cached_weather_for_location()`（读取缓存）。

## screencap

`start_recording(area?)`、`stop_recording()`、`recording_status()`、`screencap_show_controls()`、`screencap_hide_controls()`、`screencap_return_to_main()`、`convert_recording_to_gif(path)`、`save_gif(src, dest)`、`get_screencap_history(limit?)`（`list_gif_history` 别名）、`rename_screencap(id, new_name)`（在阻塞工作线程中同步重命名成品、录屏封面与历史路径，保留扩展名）、`delete_screencap(id)`、`is_recording()`。

## documents

`docs_workspace_path`、`docs_open_workspace`、`docs_list_files`、`docs_read_file`、`docs_write_file`、`docs_create_file`、`docs_rename_file`、`docs_delete_file`、`docs_set_language`、`docs_inspect_text`。

## QxTTY

`terminal_create_session`、`terminal_list_sessions`、`terminal_snapshot`、`terminal_write`、`terminal_resize`、`terminal_close_session`、`terminal_clear_buffer`。会话由 Rust PTY 管理器持有，前端卸载或主窗口隐藏时仍继续运行；输出通过 `qx-terminal-output` / `qx-terminal-exit` 事件增量回传。

## macros

`macro_start_recording()`、`macro_stop_recording(exclude_tail_ms?)`、`macro_save(name, data)`、`macro_create_demo(name)`、`macro_list()`、`macro_delete(id)`、`macro_cursor_overlay_show()`、`macro_cursor_overlay_hide()`、`macro_play(id, delay_ms?)`、`macro_toggle_playback_pause()`、`macro_stop_playback()`。

`macro_start_recording` 成功才会返回；失败会返回原生 hook / event tap
权限错误（macOS 使用 `macro_permission_denied:input-monitoring`，Windows 使用
`macro_permission_denied:keyboard-hook:<code>` 或 `macro_permission_denied:mouse-hook:<code>`）。
前端将这些稳定错误码映射为本地化提示；macOS 的“打开系统设置”按钮复用
`qx_permissions_request({ id: "input-monitoring" })`，不会由宿主静默授予权限。
录制由独立的 `MacroCaptureSession` 管理：原生回调只向有界队列投递原始事件，
`macro_stop_recording` 会先卸载 hook / event tap，再等待捕获线程和消费线程退出。
Esc、录制器按钮、模块卸载和应用退出都复用同一停止协议。

`exclude_tail_ms` 由宏录制设置提供，默认是 2 秒；停止时按捕获时间戳裁掉停止前尾部事件，
再把结果交给前端和 SQLite。应用退出没有前端参数时读取同一份持久化设置。

录制成功后，Workbench 会按显示器创建透明、点击穿透的指针可视化层；它不参与
捕获，也不复用截图指针监听器。录制 worker 以约 16ms 的上限发出 `macro:recording`
位置事件，卡片、灵动岛和各显示器 overlay 分别消费同一份轻量坐标数据；停止、卸载
和退出会隐藏并复用这些窗口。

`macro_create_demo(name)` 写入一个跨平台 smoke macro：启动 Google Chrome、等待应用就绪、
用原生地址栏快捷键定位并输入 `hello`，再提交搜索；Windows 只接受标准 Chrome 安装位置，
macOS 通过 `open -a "Google Chrome"` 启动，找不到应用时播放会明确报错而不会静默跳过。

`macro_play` 只负责在后台启动一个单实例播放任务并返回
`{ playback_id, macro_id, macro_name, total_steps, delay_ms }`；SQLite 查询在
`spawn_blocking` 中完成，Enigo 实例、延迟和原生输入均在独立 worker 中执行。
`delay_ms` 最大为 60 秒，播放等待和每个步骤都以 25ms 粒度检查取消标志与暂停状态。
`macro_stop_playback` 会设置取消标志并在阻塞线程中 join worker；Esc、灵动岛 Stop
和应用退出走同一停止路径。模块视图卸载不会取消播放，事件桥接和任务灵动岛会继续
运行，直到完成、失败或用户停止。

播放 worker 通过 `macro:playback` 事件报告 `waiting`、`playing`、`paused`、`completed`、
`cancelled`、`error`。`macro_toggle_playback_pause()` 只切换 worker 的协作式暂停标记，
不结束任务；暂停会冻结当前步骤/播放前延迟的剩余时间，继续后从同一位置恢复。事件包含
完成步数、总步数、当前（从 1 开始）步骤及原始 `MacroStep`，前端 Workbench 与灵动岛都
消费这份真实进度；播放灵动岛的暂停/继续动作显示平台化 `Space` 快捷键提示，Stop 仍
保持独立危险操作，不在回调或 UI 线程中执行数据库操作和布局工作。

## qxai / g4f

面向前端的：`qxai_list_providers`、`qxai_stream_chat_events(request_id, provider?, model?, messages, reasoning?)`、`qxai_stream_chat_with_tools_events(request_id, provider?, model?, messages, tools, tool_choice?, reasoning?)`、`qxai_chat_with_tools(...)`、`qxai_fetch_models(base_url, api_key)`、`qxai_get_builtin_provider_credentials`、`qxai_save_builtin_provider_credentials`、`qxai_get_custom_providers`、`qxai_save_custom_providers`。

内置只给插件层用的兼容命令：`g4f_chat`、`g4f_stream_chat`、`g4f_chat_custom`、`g4f_list_providers`、`qxai_stream_chat`。

## plugin AI （给插件的受控入口）

`plugin_ai_list_providers`、`plugin_ai_default_model`、`plugin_ai_agent_settings`、`plugin_ai_chat(req)`、`plugin_ai_stream_chat(req)`、`plugin_ai_stream_chat_events(request_id, req)`、`plugin_ai_run_bash(req)`（有 timeout）、`plugin_ai_grep_search(req)`、`plugin_ai_memory_list/add/delete`。QxAI 的宿主动作不另造 OS 分支：路径打开/定位复用 `plugin_system_open_path/reveal_path`，文本复制复用 `plugin_clipboard_write`，文件复制复用 `clipboard_write_file_paths`，发送文件先经 `clipboard_file_metadata` 校验并作为对话附件返回。

任何来自插件 iframe 的调用先进 `plugin/rpcMethods.ts` 做 capability 校验，再走这些命令。

## plugin 通用宿主 API

`plugin_clipboard_read/write`、`plugin_perform_paste`、`plugin_perform_paste_at_cursor`、`plugin_http_fetch(req)`（只允许 http/https + 超时）、`plugin_notification_show(req)`、`plugin_resolve_asset(id, asset_path)`。

插件 CLI 端口（`cli` 权限，**不**受 AI Agent Bash 开关门控）：`plugin_cli_run` / `plugin_cli_bash` / `plugin_cli_which`（同步），`plugin_cli_start` / `plugin_cli_poll` / `plugin_cli_cancel` / `plugin_cli_list_jobs`（异步并发 job）。Windows 的 GUI PATH 由宿主直接合并 Machine/User 环境注册表，不为路径发现启动 PowerShell；只有插件明确请求 PowerShell 或内置终端会按用户意图启动 shell。系统能力（`system` 权限）：`plugin_system_env` / `plugin_system_open_path` / `plugin_system_reveal_path` / `plugin_system_open_settings` / `plugin_system_set_wallpaper`；系统设置与壁纸均由宿主在 macOS / Windows 适配，不要求插件执行 PowerShell。

## marketplace

`fetch_plugin_index(source_id?, force_refresh?)`（合并 `settings.plugin_registries` 中所有已启用库的 `index.json`；条目带 `source_id` / `source_name` / `source_index_url` 归属；返回 `sources[]` 各库状态；默认优先使用 15 分钟本地索引缓存，`force_refresh` 跳过缓存并更新缓存）、`marketplace_update_compatible_plugins()`（后台刷新市场，按当前 Qx 版本/平台选择每个已安装插件的最高兼容版本，校验大小、SHA256、包 id 与版本后逐个安装；返回成功、跳过和失败明细，单个失败不阻塞其他插件）、`download_plugin(url)`、`install_plugin(path)`、`install_plugin_from_url(url)`、`install_raycast_extension_from_url(url)`、`uninstall_plugin(id)`、`list_installed_plugins()`（在阻塞线程枚举安装目录，避免占用 Tauri 命令/UI 调度线程）、`read_plugin_entry(id)`、`read_plugin_modules(id)`（返回受文件数与总字节上限保护的包内 ESM 图）、`set_plugin_enabled(id, enabled)`、`plugin_storage_get/set/delete(id, key, value?)`、`plugin_preferences_get/set(id, values?)`、`sign_plugin(dir, private_key_hex)`、`scaffold_plugin(name, output_dir)`。

## settings

`get_settings()`、`update_settings(settings)`、`reset_settings()`、`import_settings(path)`、`export_settings(path)`、`shortcuts_pause_global()`、`shortcuts_resume_global()`。写入操作会重新注册全局快捷键并刷新托盘菜单。

## screencap（工作流模块，消费系统能力）

截图模块进入时调用 `display_list()` 异步预热原生显示器缓存；`screencap_begin_capture_select(mode, includeMainWindow?)` 在鼠标所在显示器打开圈选层，`mode` 为 `screenshot` 或 `recording`；圈选层会为当前显示器集合创建轻量鼠标穿透遮罩，并由鼠标位置自动切换交互显示器。默认仅在圈选层成功显示后隐藏来源窗口；从跨模块浮动控制栏或全局截图快捷键启动截图时传入 `includeMainWindow=true`，主 Qx 窗口保持可见且解除内容保护，使 Qx 自身可进入截图，圈选层与控制栏仍始终排除。失败时保留原捕获岛/主窗口。

**系统能力门面（兼容旧调用，新代码优先用系统命令）：**

| 门面命令 | 应改用 |
|---|---|
| `screencap_list_displays` | `display_list` |
| `screencap_list_windows` | `desktop_windows_list`（带 session 的 monitorId + coordinateScale） |
| `screencap_copy_image_to_clipboard` | `clipboard_write_image_file` |

工作流专用：`screencap_select_display(monitor_id)`（保留为旧调用门面，主界面不再暴露）、`screencap_region_picker_ready()`（WebView 挂载后重放当前 picker session 并重新置前/聚焦）、`screencap_selection_preview(area)`（圈选层打开时对当前逻辑选区做轻量 PNG base64 预览，供马赛克等实时标注；不写历史、不放快门音；picker 表面 content-protected，不会进捕获栈）、`screencap_confirm_region_select(..., captureOptions?, copy_to_clipboard?, dismiss_ui?)`（`captureOptions` 是可选兼容扩展，包含保存/打开、缩略图、选区记忆、指针/点击、麦克风、录屏遮挡区和提示音；旧调用不传仍有效；`dismiss_ui` 用于 ⌘C/Ctrl+C 复制后保持主界面隐藏）、`screencap_list_audio_inputs()`（返回稳定 `AudioInput { id, name, isDefault, available }`）、`screencap_recapture_last_region`（无圈选层、按上次逻辑选区静默截图；全局快捷键 `recapture_last_region`）、`screencap_set_picker_passthrough`、`screencap_set_pointer_follow(enabled)`、`screencap_set_picker_interaction_lock(locked)`（拖拽中钉住当前屏，防 Windows 跨屏 handoff 清草稿）、`screencap_toggle_controls` / `screencap_set_controls_pinned`、`start_recording(area?, options?, captureOptions?)` / `stop_recording` / 历史命令。鼠标跨屏识别仍由根级 `display` 服务完成；区域抓帧底层走 `display::capture_region`；标注合成与历史仍属 screencap。Windows 截图和录屏共享 WGC 健康策略：远程会话直接使用 GDI；实体机会话若 WGC 返回近全黑空帧，则在截图持久化或录屏编码前拒绝该帧并回退 GDI，录屏时间轴从首个有效 fallback 帧开始。

截图/录屏成品先写入 Qx 图库，再由 delivery 服务导出；导出和“完成后打开”失败仅作为局部 warning。快门音由截图成功收尾播放，麦克风枚举/采集/合并由根级 `media::ffmpeg` sidecar 端口负责；共享 `input_events` 同时向宏录制和捕获指针/点击效果提供输入快照。

截图 worker 的捕获、编码或写盘错误（包括 worker panic）必须统一进入恢复路径：重新显示原选区或捕获入口并记录 `screencap.screenshot` 诊断事件，禁止在来源窗口已隐藏后直接提前返回。

## island_window

轻量浮窗（label `island`，蓝本 = screencap recording-controls 旗标，**非** main NSPanel）。默认 `appearance.island_float_enabled=true`（新装可用）；仍须用户从 Qx 底部灵动岛手动浮出，不会自动弹出。首次位于主屏工作区右上角，之后可拖动并持久化物理桌面坐标；失效坐标回落主屏。浮窗关闭会清除本次手动意图，session 更新不会自动重开；打开期间普通模块/插件状态按 `island_float_rotate_secs` 轮播，重要事件抢占。

| 命令 | 用途 |
|---|---|
| `island_window_ensure` | 创建隐藏的 island webview |
| `island_window_show` / `island_window_hide` | 显示 / 隐藏 |
| `island_window_remember_position` | 拖动期间更新 Rust mirror 坐标；最终位置由 main bridge 写回 Appearance |
| `island_window_set_compact` | 在 400px 展开态与 240px 缩小态之间切换真实浮窗尺寸 |
| `island_window_set_always_on_top` | 置顶 |
| `island_window_get_snapshot` | float 冷启动读 mirror |
| `island_sessions_publish` | main → Rust mirror JSON |

事件：`island:sessions`、`island:intent`（字符串名）。`main` 与 `island` 共享 Qx 焦点组；
两者之间切换焦点不会触发主窗自动隐藏，焦点离开两者后才按设置隐藏。设计见
`docs/qx-island-architecture.md`。

Screen Capture 的独立控制窗通过 `screencap:controls-pinned` 将关闭 / 取消常驻意图
回传主 webview，由设置 store 持久化，避免后台恢复旧的 pinned 状态。

## floating_panel

`floating_show`、`floating_hide`、`floating_hide_restore_focus`、`floating_previous_app_name`（返回召唤 Qx 前的前台应用名，供“粘贴到 …”反馈使用）、`floating_set_onboarding_active`、`floating_set_external_interaction_active`（系统设置/选择器期间抑制自动隐藏）、`floating_toggle`、`floating_request_key`（输入框获取焦点时调用，使 panel 成为 keyWindow）、`set_active_route(route)`（前端 tab 同步，供全局模块快捷键 toggle）。

行为约定（toggle、blur 竞态、勿裸 hide）见 [shell-and-shortcuts.md](./shell-and-shortcuts.md)。

## history

`record_launch(path, name)`、`get_launch_history(limit)`、`clear_launch_history`、`record_search(query)`、`get_search_history(limit)`、`clear_search_history`、`delete_search_entry(id)`、`record_search_click(path, name, kind?, icon?)`、`get_search_click_stats(limit?, days?)`、`clear_search_click_stats`。

- `record_search_click` — 启动器结果打开时写入 `search_click_events`（fire-and-forget）；写时 prune 30 天外事件。
- `get_search_click_stats` — 按 path 聚合最近 N 天（默认 30）点击量，供搜索结果异步加权 / 高频召回；不参与主搜索关键路径。
- `clear_search_click_stats` — 清空点击事件；设置里「清除启动历史」也会一并清掉。

## window material

- `set_window_glass_effect(enabled)` — 在 UI 主线程运行时启停主窗口原生材质；macOS 使用 Vibrancy，Windows 11 使用 Mica，Windows 10 使用高不透明度 WebView 表面回退，不启用拖拽性能较差的 Acrylic。CSS 不透明度与模糊参数由前端 token 独立控制。

## system 相关

- `get_system_stats()` — macOS 通过 `HOST_CPU_LOAD_INFO` 做系统 CPU tick 差分；
  内存通过 `HOST_VM_INFO64` 读取，并从 active + inactive + speculative + wired +
  compressed 中扣除 purgeable 与 external/file-cache 页；同时返回
  `kern.memorystatus_vm_pressure_level` 和 `vm.swapusage`。Windows 保持同构模型，
  使用 `GetSystemTimes` / `GlobalMemoryStatusEx`。
- `display_brightness_list/set` — macOS/Windows 内置屏与支持 DDC/CI 的外接屏亮度控制；平台适配由 Qx 原生核心提供，不依赖 Homebrew、PowerShell 或外部显示器工具
- `qx_system_information_check_system_info` — 主机名 / 芯片 / OS / 内核 / 序列号；Windows 通过注册表与 Win32 拓扑/内存 API
- `qx_system_information_check_storage` — macOS/Linux 通过 `df`，Windows 通过 `GetDiskFreeSpaceExW`
- `qx_system_information_check_network` — macOS/Linux 通过 `ifconfig`，Windows 通过 `GetAdaptersAddresses`
- `qx_system_information_list_processes` — macOS/Linux 通过 `ps`，Windows 通过 ToolHelp + Process Status API
- `qx_system_information_kill_process(pid)` — 拒 pid 0 和自身
- `qx_system_monitor_network_counters` — macOS/Linux 通过 `netstat`，Windows 通过 `GetIfTable2`
- `qx_system_monitor_power` — macOS 通过 I/O Registry，Windows 通过 `GetSystemPowerStatus`，其他平台使用 `battery` crate

## OCR

`download_ocr_model(size)`、`check_ocr_models(size)`、`ocr_recognize_path`、`ocr_recognize_clipboard_image`、`ocr_list_history`、`ocr_delete_history`、`ocr_clear_history`、`ocr_copy_result_text`、`ocr_status`。

## 存储 / 权限 / 杂项

- `get_file_size(path)`
- `open_app(path)` — 仅允许 `/Applications` 或 `~/Applications`
- `set_window_size(width, height)`
- `qx_storage_overview` — 返回总占用、可回收模块缓存、manifest 登记的插件缓存目标与受保护分桶
- `qx_storage_clear_cache_target(target_id)` — 只清理注册表中的单个可重建缓存；插件目标格式 `plugin:<id>:<cache-id>` 并只删除声明的 persist key
- `qx_storage_clear_cache/clear_files/clear_clipboard` — 分别清理全部注册缓存、生成文件或剪贴板附件
- `qx_permissions_status/request/request_all/open_settings` — macOS TCC（含 Full Disk Access）
- `qx_onboarding_platform` — 返回 `macos` / `windows` / `other`（首次启动引导）
- `floating_set_onboarding_active` — 引导期间抑制 blur 自动隐藏
- `floating_set_external_interaction_active` — 原生系统设置或文件选择期间抑制自动隐藏；回到 Qx 后恢复
- `github_contributions(username)` / `github_contributions_raw(username)`

## 注册命令基线

以下清单按 `src-tauri/src/lib.rs` 的注册顺序维护，供 `npm run docs:check` 自动核对：

<!-- IPC_COMMANDS_START -->
`tray_panel_hide`, `tray_panel_open_settings`, `tray_panel_run_action`, `tray_panel_resize`,
`tray_panel_get_focus_display`, `set_window_glass_effect`, `get_file_size`, `qx_log_event`, `qx_log_path`,
`search_apps`, `search_files`, `open_app`, `set_window_size`, `get_clipboard_history`,
`get_clipboard_history_page`, `get_clipboard_entry`, `read_clipboard_image_now`, `write_clipboard_image_entry`,
`write_clipboard_file_entry`, `clipboard_write_file_paths`, `clipboard_file_metadata`, `clipboard_file_preview`,
`clipboard_file_media_probe`, `clipboard_compress_image`, `clipboard_video_to_gif`, `clear_clipboard_history`,
`delete_clipboard_entry`, `toggle_clipboard_pin`, `record_clipboard_copy`, `update_clipboard_text_entry`,
`create_clipboard_text_entry`, `read_image_file`, `clipboard_write_image_file`, `display_list`,
`display_brightness_list`, `display_brightness_set`, `desktop_windows_list`, `floating_show`, `floating_hide`,
`floating_hide_restore_focus`, `floating_previous_app_name`, `floating_set_onboarding_active`,
`floating_set_external_interaction_active`, `floating_toggle`, `floating_request_key`, `set_active_route`,
`rss_list_feeds`, `rss_add_feed`, `rss_update_feed`, `rss_remove_feed`, `rss_list_articles`, `rss_dashboard_snapshot`, `rss_get_article`,
`rss_mark_read`, `rss_set_reading_progress`, `rss_mark_all_read`, `rss_toggle_star`, `rss_refresh_feed`,
`rss_refresh_all`, `rss_import_opml`, `rss_export_opml`, `rss_list_folders`, `rss_create_folder`,
`rss_rename_folder`, `rss_delete_folder`, `rss_set_feed_folder`, `rss_clear_read_articles`,
`rss_clear_all_articles`, `rss_fetch_original_content`, `get_settings`, `update_settings`, `reset_settings`,
`import_settings`, `export_settings`, `shortcuts_pause_global`, `shortcuts_resume_global`,
`qx_storage_overview`, `qx_storage_clear_cache`, `qx_storage_clear_cache_target`, `qx_storage_clear_files`,
`qx_storage_clear_clipboard`, `qx_storage_clear_clipboard_history`, `qx_storage_clear_launcher_history`,
`qx_storage_clear_rss_cache`, `qx_storage_clear_reclaimable`, `docs_workspace_path`, `docs_open_workspace`,
`docs_list_files`, `docs_read_file`, `docs_write_file`, `docs_create_file`, `docs_rename_file`,
`docs_delete_file`, `docs_set_language`, `docs_inspect_text`, `qx_system_information_check_system_info`,
`qx_system_information_check_storage`, `qx_system_information_check_network`,
`qx_system_information_list_processes`, `qx_system_information_kill_process`,
`qx_system_monitor_network_counters`, `qx_system_monitor_power`, `get_system_stats`, `terminal_create_session`,
`terminal_list_sessions`, `terminal_snapshot`, `terminal_write`, `terminal_resize`, `terminal_close_session`,
`terminal_clear_buffer`, `start_recording`, `stop_recording`, `recording_status`,
`screencap_begin_region_select`, `screencap_begin_capture_select`, `screencap_list_displays`,
`screencap_list_windows`, `screencap_set_picker_passthrough`, `screencap_set_pointer_follow`,
`screencap_set_picker_interaction_lock`, `screencap_select_display`, `screencap_cancel_region_select`,
`screencap_confirm_region_select`, `screencap_selection_preview`, `screencap_recapture_last_region`, `screencap_region_select_status`,
`screencap_region_picker_ready`, `screencap_show_controls`, `screencap_toggle_controls`,
`screencap_hide_controls`, `screencap_set_controls_pinned`, `screencap_return_to_main`,
`screencap_copy_image_to_clipboard`, `convert_recording_to_gif`, `save_gif`, `list_gif_history`,
`get_screencap_history`, `delete_screencap`, `is_recording`, `island_window_ensure`, `island_window_show`,
`island_window_hide`, `island_window_remember_position`, `island_window_set_compact`,
`island_window_set_always_on_top`, `island_window_get_snapshot`, `island_sessions_publish`,
`fetch_plugin_index`, `marketplace_update_compatible_plugins`, `download_plugin`, `install_plugin`, `install_plugin_from_url`,
`install_raycast_extension_from_url`, `uninstall_plugin`, `list_installed_plugins`, `read_plugin_entry`,
`read_plugin_modules`, `set_plugin_enabled`, `plugin_storage_get`, `plugin_storage_set`,
`plugin_storage_delete`, `plugin_storage_list`, `plugin_storage_clear`, `plugin_data_usage`,
`plugin_data_clear`, `plugin_preferences_get`, `plugin_preferences_set`, `sign_plugin`, `scaffold_plugin`,
`plugin_tray_set_items`, `plugin_tray_clear`, `plugin_tray_list`, `plugin_clipboard_read`,
`plugin_clipboard_write`, `plugin_perform_paste`, `plugin_perform_paste_at_cursor`, `plugin_run_applescript`,
`plugin_file_read_base64`, `plugin_file_exists`, `plugin_file_ensure_dir`, `plugin_file_write_base64`,
`plugin_file_empty_dir`, `plugin_file_list`, `plugin_ai_list_providers`, `plugin_ai_default_model`,
`plugin_ai_agent_settings`, `plugin_ai_chat`, `plugin_ai_stream_chat`, `plugin_ai_stream_chat_events`,
`plugin_ai_run_bash`, `plugin_cli_run`, `plugin_cli_bash`, `plugin_cli_which`, `plugin_cli_start`,
`plugin_cli_poll`, `plugin_cli_cancel`, `plugin_cli_list_jobs`, `plugin_system_env`,
`plugin_system_save_download`, `plugin_system_open_path`, `plugin_system_reveal_path`,
`plugin_system_open_settings`, `plugin_ai_grep_search`, `plugin_ai_memory_list`, `plugin_ai_memory_add`,
`plugin_ai_memory_delete`, `plugin_http_fetch`, `plugin_notification_show`, `plugin_resolve_asset`,
`qx_permissions_status`, `qx_permissions_request`, `qx_permissions_request_all`,
`qx_permissions_open_settings`, `qx_onboarding_platform`, `qx_update_check`, `qx_update_download_and_install`,
`qx_update_apply_and_restart`, `qx_update_progress_snapshot`, `qx_update_progress_close`, `qx_update_progress_cancel`, `download_ocr_model`,
`check_ocr_models`, `ocr_recognize_path`, `ocr_recognize_clipboard_image`, `ocr_list_history`,
`ocr_delete_history`, `ocr_clear_history`, `ocr_copy_result_text`, `ocr_status`, `clipboard_ocr_pending`,
`macro_start_recording`, `macro_stop_recording`, `macro_save`, `macro_create_demo`, `macro_list`, `macro_delete`, `macro_cursor_overlay_show`, `macro_cursor_overlay_hide`, `macro_play`, `macro_toggle_playback_pause`, `macro_stop_playback`,
`record_launch`, `get_launch_history`, `clear_launch_history`, `record_search`, `get_search_history`,
`clear_search_history`, `delete_search_entry`, `record_search_click`, `get_search_click_stats`,
`clear_search_click_stats`, `v2ex_fetch_topics`, `v2ex_search_topics`, `v2ex_fetch_node_topics`,
`v2ex_fetch_topic_replies`, `v2ex_fetch_token_info`, `v2ex_fetch_notifications`, `github_contributions`,
`github_contributions_raw`, `fetch_weather`, `fetch_weather_for_location`, `get_cached_weather`,
`get_cached_weather_for_location`, `detect_location`, `g4f_chat`, `g4f_stream_chat`, `g4f_chat_custom`,
`g4f_list_providers`, `qxai_stream_chat`, `qxai_stream_chat_events`, `qxai_stream_chat_with_tools_events`,
`qxai_chat_with_tools`, `qxai_list_providers`, `qxai_fetch_models`, `qxai_get_builtin_provider_credentials`,
`qxai_save_builtin_provider_credentials`, `qxai_get_custom_providers`, `qxai_save_custom_providers`,
`plugin_system_set_wallpaper`, `rename_screencap`, `rss_cache_article_image`, `screencap_list_audio_inputs`
<!-- IPC_COMMANDS_END -->

## 事件通道

命令之外，后端还通过 `Emitter::emit` 发这些事件：

| 事件 | 触发方 | 消费方 |
|---|---|---|
| `navigate` | 托盘 / `show_and_navigate` / `toggle` / 全局模块快捷键 | `App.tsx` `listen("navigate")` 设 tab |
| `apps:updated` / `apps:icons-ready` | 后台索引 | `App.tsx` `doSearch` 重刷 |
| `clipboard-updated` | 剪贴板轮询 / `read_clipboard_image_now` | `ClipboardPanel.tsx` |
| `clipboard-media-progress` | 图片压缩 / 视频转 GIF 后台任务 | `ClipboardPanel.tsx` 灵动岛进度 |
| `tray-focus-display` | Tray 打开时的点击显示器解析 | `TrayPanelApp.tsx` 将亮度控制置顶 |
| `qxai-stream` | `qxai_stream_chat_events` / `qxai_stream_chat_with_tools_events` 内部线程 | `modules/qx-ai/store.ts`、`react-agent.ts`、插件 iframe bridge |
| `ocr:download-progress` / `ocr-download-progress` | `download_ocr_model` | `modules/settings/OcrSettings.tsx` |
| `screencap:ocr` | 截图确认后 OCR | `screencap/store.ts`（editor 打开文本工具） |
| `qx-terminal-output` / `qx-terminal-exit` | QxTTY PTY reader | `modules/qx-tty/QxTTYPanel.tsx` |
| `macro:playback` | 宏播放 worker | `modules/macros/store.ts` + Workbench/灵动岛桥接 |
| `macro:recording` | 宏录制 worker（约 16ms 节流） | 宏录制状态、指针 overlay、灵动岛 |
| 显示器变化 | `display_monitor::start_display_monitor` | 内部 auto-show panel |

## 约定

- 每个命令的错误统一 `Result<T, String>`，字符串直接前端 `catch (e)` 展示。
- 后端不接触 UI；命令内如需异步用 `#[tauri::command]` + `async`，重活起 `std::thread::spawn` + 通过事件回主线程。
- 前端 `invoke("cmd", { camelCaseArg })`；后端参数用 snake_case，Tauri 自动转换。
- 插件永远不直接 `invoke`；先经过 `plugin/rpcMethods.ts` 的白名单和权限检查。见 [plugin-architecture.md](./plugin-architecture.md)。

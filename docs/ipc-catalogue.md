# IPC 命令目录

> 状态：Current · 适用版本：v0.5.17 · Owner：Backend · 最后复核：2026-07-15
>
> 事实来源：`src-tauri/src/lib.rs` 中的 `tauri::generate_handler!`

Qx 前后端通过 Tauri v2 的 `invoke` 通道通信。当前 `tauri::generate_handler!` 注册 **195 个命令**；不要引用易漂移的固定行号。本文按领域解释主要接口，文末“注册命令基线”必须与注册宏逐项一致。

`capabilities/default.json` 声明 Tauri IPC 边界及插件权限（`opener`、`global-shortcut`、`clipboard-manager`、`shell`、`core:window`、`core:path`）。任何窗口若未匹配 capability，就不能使用 IPC；当前 `main`、`recording-controls` 和 `region-picker` 都必须显式列入。自定义命令仍由 `generate_handler!` 注册，但动态创建的捕获窗口不能省略窗口 capability。

新增命令后请同步更新本表和调用方。

## apps

| 命令 | 签名 | 用途 |
|---|---|---|
| `search_apps` | `(query: String) -> Vec<AppEntry>` | 已安装 `.app` 打分排序，空 query 返回前 20 |
| `search_files` | `(query: String, pass?: u32, categories?: FileSearchCategory[], category_id?: String, request_id?: u64) -> Vec<AppEntry>` | Cardinal / Everything 渐进文件名搜索；每个 pass 单次后台调用按分类优先并平衡结果，`request_id` 使旧查询失效；返回可选 `modified_at`，同分类按修改时间倒序；Spotlight 作为 macOS 补充回退 |

调用方：`App.tsx`、`plugin/runtime.ts`、`plugin/context.ts`、`modules/qx-ai/react-agent.ts`

## clipboard

| 命令 | 用途 |
|---|---|
| `get_clipboard_history(limit?)` | 读取置顶 + 最近文本/图片剪贴板条目 |
| `read_clipboard_image_now()` | 立即读当前剪贴板图片，落盘并触发 `clipboard-updated` |
| `write_clipboard_image_entry(id)` | 将历史图片回写系统剪贴板 |
| `write_clipboard_file_entry(id)` | 将历史文件作为真实文件对象回写系统剪贴板 |
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
| `display_list()` | 枚举显示器（稳定 ID、名称、尺寸、主屏/内置屏）。**任何功能**需要显示器信息都走此命令，不得自建枚举。 |
| `desktop_windows_list(query?)` | 枚举可见顶层窗口；可选按 `monitorId` 裁剪、`logicalScale` 换算逻辑坐标、名称排除。截图窗选、布局工具等共用。 |

前端端口：`src/system/display.ts`、`src/system/desktopWindows.ts`、`src/system/clipboard.ts`。

## rss

`rss_list_feeds`、`rss_add_feed(url)`、`rss_update_feed(id, url, title)`、`rss_remove_feed(id)`、`rss_list_articles(feed_id?, only_unread, query?)`、`rss_get_article(id)`、`rss_mark_read(id, is_read)`、`rss_set_reading_progress(id, progress)`、`rss_mark_all_read(feed_id)`、`rss_toggle_star(id, is_starred)`、`rss_refresh_feed(id)`、`rss_refresh_all()`、`rss_import_opml(content)`、`rss_export_opml()`、`rss_list_folders`、`rss_create_folder(name, parent_id?)`、`rss_rename_folder(id, name)`、`rss_delete_folder(id)`、`rss_set_feed_folder(feed_id, folder_id?)`。

## v2ex

`v2ex_fetch_topics(mode)`、`v2ex_search_topics(query)`、`v2ex_fetch_node_topics(node)`（需 token）、`v2ex_fetch_topic_replies(topic_id)`、`v2ex_fetch_token_info()`、`v2ex_fetch_notifications()`。

## weather

`detect_location()`（IP 定位）、`fetch_weather()` / `fetch_weather_for_location()`（Open-Meteo / OpenWeatherMap）、`get_cached_weather()` / `get_cached_weather_for_location()`（读取缓存）。

## screencap

`start_recording(area?)`、`stop_recording()`、`recording_status()`、`screencap_show_controls()`、`screencap_hide_controls()`、`screencap_return_to_main()`、`convert_recording_to_gif(path)`、`save_gif(src, dest)`、`get_screencap_history(limit?)`（`list_gif_history` 别名）、`delete_screencap(id)`、`is_recording()`。

## documents

`docs_workspace_path`、`docs_open_workspace`、`docs_list_files`、`docs_read_file`、`docs_write_file`、`docs_create_file`、`docs_rename_file`、`docs_delete_file`、`docs_set_language`、`docs_inspect_text`。

## QxTTY

`terminal_create_session`、`terminal_list_sessions`、`terminal_snapshot`、`terminal_write`、`terminal_resize`、`terminal_close_session`、`terminal_clear_buffer`。会话由 Rust PTY 管理器持有，前端卸载或主窗口隐藏时仍继续运行；输出通过 `qx-terminal-output` / `qx-terminal-exit` 事件增量回传。

## macros

`macro_start_recording()`、`macro_stop_recording()`、`macro_save(name, data)`、`macro_list()`、`macro_delete(id)`、`macro_play(id)`。

## qxai / g4f

面向前端的：`qxai_list_providers`、`qxai_stream_chat_events(request_id, provider?, model?, messages)`、`qxai_chat_with_tools(...)`、`qxai_fetch_models(base_url, api_key)`、`qxai_get_builtin_provider_credentials`、`qxai_save_builtin_provider_credentials`、`qxai_get_custom_providers`、`qxai_save_custom_providers`。

内置只给插件层用的兼容命令：`g4f_chat`、`g4f_stream_chat`、`g4f_chat_custom`、`g4f_list_providers`、`qxai_stream_chat`。

## plugin AI （给插件的受控入口）

`plugin_ai_list_providers`、`plugin_ai_default_model`、`plugin_ai_agent_settings`、`plugin_ai_chat(req)`、`plugin_ai_stream_chat(req)`、`plugin_ai_run_bash(req)`（有 timeout）、`plugin_ai_grep_search(req)`、`plugin_ai_memory_list/add/delete`。

任何来自插件 iframe 的调用先进 `plugin/rpcMethods.ts` 做 capability 校验，再走这些命令。

## plugin 通用宿主 API

`plugin_clipboard_read/write`、`plugin_perform_paste`、`plugin_perform_paste_at_cursor`、`plugin_http_fetch(req)`（只允许 http/https + 超时）、`plugin_notification_show(req)`、`plugin_resolve_asset(id, asset_path)`。

插件 CLI 端口（`cli` 权限，**不**受 AI Agent Bash 开关门控）：`plugin_cli_run` / `plugin_cli_bash` / `plugin_cli_which`（同步），`plugin_cli_start` / `plugin_cli_poll` / `plugin_cli_cancel` / `plugin_cli_list_jobs`（异步并发 job）。系统路径能力（`system` 权限）：`plugin_system_env` / `plugin_system_open_path` / `plugin_system_reveal_path`。

## marketplace

`fetch_plugin_index`、`download_plugin(url)`、`install_plugin(path)`、`install_plugin_from_url(url)`、`install_raycast_extension_from_url(url)`、`uninstall_plugin(id)`、`list_installed_plugins()`、`read_plugin_entry(id)`、`set_plugin_enabled(id, enabled)`、`plugin_storage_get/set/delete(id, key, value?)`、`plugin_preferences_get/set(id, values?)`、`sign_plugin(dir, private_key_hex)`、`scaffold_plugin(name, output_dir)`。

## settings

`get_settings()`、`update_settings(settings)`、`reset_settings()`、`import_settings(path)`、`export_settings(path)`、`shortcuts_pause_global()`、`shortcuts_resume_global()`。写入操作会重新注册全局快捷键并刷新托盘菜单。

## screencap（工作流模块，消费系统能力）

`screencap_begin_capture_select(mode)` 在鼠标所在显示器打开圈选层，`mode` 为 `screenshot` 或 `recording`；仅在圈选层成功显示后隐藏来源窗口，失败时保留原捕获岛/主窗口。

**系统能力门面（兼容旧调用，新代码优先用系统命令）：**

| 门面命令 | 应改用 |
|---|---|
| `screencap_list_displays` | `display_list` |
| `screencap_list_windows` | `desktop_windows_list`（带 session 的 monitorId + coordinateScale） |
| `screencap_copy_image_to_clipboard` | `clipboard_write_image_file` |

工作流专用：`screencap_select_display(monitor_id)`、`screencap_confirm_region_select(...)`、`screencap_set_picker_passthrough`、`screencap_set_pointer_follow(enabled)`、`screencap_toggle_controls` / `screencap_set_controls_pinned`、`start_recording` / `stop_recording` / 历史命令。鼠标跨屏识别仍由根级 `display` 服务完成；区域抓帧底层走 `display::capture_region`；标注合成与历史仍属 screencap。

截图 worker 的捕获、编码或写盘错误（包括 worker panic）必须统一进入恢复路径：重新显示原选区或捕获入口并记录 `screencap.screenshot` 诊断事件，禁止在来源窗口已隐藏后直接提前返回。

## island_window

轻量浮窗（label `island`，蓝本 = screencap recording-controls 旗标，**非** main NSPanel）。默认由 `appearance.island_float_enabled=false` 关闭。

| 命令 | 用途 |
|---|---|
| `island_window_ensure` | 创建隐藏的 island webview |
| `island_window_show` / `island_window_hide` | 显示 / 隐藏 |
| `island_window_set_always_on_top` | 置顶 |
| `island_window_get_snapshot` | float 冷启动读 mirror |
| `island_sessions_publish` | main → Rust mirror JSON |

事件：`island:sessions`、`island:intent`（字符串名）。设计见 `docs/qx-island-architecture.md`。

## floating_panel

`floating_show`、`floating_hide`、`floating_hide_restore_focus`、`floating_previous_app_name`（返回召唤 Qx 前的前台应用名，供“粘贴到 …”反馈使用）、`floating_set_onboarding_active`、`floating_toggle`、`floating_request_key`（输入框获取焦点时调用，使 panel 成为 keyWindow）、`set_active_route(route)`（前端 tab 同步，供全局模块快捷键 toggle）。

行为约定（toggle、blur 竞态、勿裸 hide）见 [shell-and-shortcuts.md](./shell-and-shortcuts.md)。

## history

`record_launch(path, name)`、`get_launch_history(limit)`、`clear_launch_history`、`record_search(query)`、`get_search_history(limit)`、`clear_search_history`、`delete_search_entry(id)`、`record_search_click(path, name, kind?, icon?)`、`get_search_click_stats(limit?, days?)`、`clear_search_click_stats`。

- `record_search_click` — 启动器结果打开时写入 `search_click_events`（fire-and-forget）；写时 prune 30 天外事件。
- `get_search_click_stats` — 按 path 聚合最近 N 天（默认 30）点击量，供搜索结果异步加权 / 高频召回；不参与主搜索关键路径。
- `clear_search_click_stats` — 清空点击事件；设置里「清除启动历史」也会一并清掉。

## window material

- `set_window_glass_effect(enabled)` — 在 UI 主线程运行时启停主窗口原生材质；macOS 使用 Vibrancy，Windows 使用 Acrylic。CSS 不透明度与模糊参数由前端 token 独立控制。

## system 相关

- `get_system_stats()` — Mach APIs 读 CPU/内存
- `qx_external_displays_driver/install_driver/list/set_control` — DDC 驱动状态、安装、外接显示器枚举与亮度/音量控制
- `qx_system_information_check_system_info` — 主机名 / 芯片 / macOS 版本 / 内核 / 序列号
- `qx_system_information_check_storage` — 通过 `df -k /` 读根卷
- `qx_system_information_check_network` — `ifconfig` 枚举非 loopback IPv4
- `qx_system_information_list_processes` — `ps -axo pid,pcpu,pmem,comm`
- `qx_system_information_kill_process(pid)` — 拒 pid 0 和自身
- `qx_system_monitor_network_counters` — `netstat -ibn`
- `qx_system_monitor_power` — `battery` crate

## OCR

`download_ocr_model(size)`（tiny/small/medium）、`check_ocr_models(size)`。

## 存储 / 权限 / 杂项

- `get_file_size(path)`
- `open_app(path)` — 仅允许 `/Applications` 或 `~/Applications`
- `set_window_size(width, height)`
- `qx_storage_overview` — 分桶统计磁盘占用
- `qx_storage_clear_cache/clear_files/clear_clipboard`
- `qx_permissions_status/request/request_all/open_settings` — macOS TCC（含 Full Disk Access）
- `qx_onboarding_platform` — 返回 `macos` / `windows` / `other`（首次启动引导）
- `floating_set_onboarding_active` — 引导期间抑制 blur 自动隐藏
- `github_contributions(username)` / `github_contributions_raw(username)`

## 注册命令基线

以下清单按 `src-tauri/src/lib.rs` 的注册顺序维护，供 `npm run docs:check` 自动核对：

<!-- IPC_COMMANDS_START -->
`set_window_glass_effect`,
`get_file_size`, `qx_log_event`, `qx_log_path`, `search_apps`, `search_files`, `open_app`, `set_window_size`, `get_clipboard_history`, `read_clipboard_image_now`, `write_clipboard_image_entry`, `write_clipboard_file_entry`, `clipboard_file_metadata`, `clipboard_file_preview`, `clipboard_file_media_probe`, `clipboard_compress_image`, `clipboard_video_to_gif`, `clear_clipboard_history`, `delete_clipboard_entry`, `toggle_clipboard_pin`, `record_clipboard_copy`, `update_clipboard_text_entry`, `create_clipboard_text_entry`, `read_image_file`, `clipboard_write_image_file`, `display_list`, `desktop_windows_list`, `floating_show`, `floating_hide`, `floating_hide_restore_focus`, `floating_previous_app_name`, `floating_set_onboarding_active`, `floating_toggle`, `floating_request_key`, `set_active_route`, `rss_list_feeds`, `rss_add_feed`, `rss_update_feed`, `rss_remove_feed`, `rss_list_articles`, `rss_get_article`, `rss_mark_read`, `rss_set_reading_progress`, `rss_mark_all_read`, `rss_toggle_star`, `rss_refresh_feed`, `rss_refresh_all`, `rss_import_opml`, `rss_export_opml`, `rss_list_folders`, `rss_create_folder`, `rss_rename_folder`, `rss_delete_folder`, `rss_set_feed_folder`, `rss_clear_read_articles`, `rss_clear_all_articles`, `rss_fetch_original_content`, `get_settings`, `update_settings`, `reset_settings`, `import_settings`, `export_settings`, `shortcuts_pause_global`, `shortcuts_resume_global`, `qx_storage_overview`, `qx_storage_clear_cache`, `qx_storage_clear_files`, `qx_storage_clear_clipboard`, `qx_storage_clear_clipboard_history`, `qx_storage_clear_launcher_history`, `qx_storage_clear_rss_cache`, `qx_storage_clear_reclaimable`, `docs_workspace_path`, `docs_open_workspace`, `docs_list_files`, `docs_read_file`, `docs_write_file`, `docs_create_file`, `docs_rename_file`, `docs_delete_file`, `docs_set_language`, `docs_inspect_text`, `qx_system_information_check_system_info`, `qx_system_information_check_storage`, `qx_system_information_check_network`, `qx_system_information_list_processes`, `qx_system_information_kill_process`, `qx_system_monitor_network_counters`, `qx_system_monitor_power`, `get_system_stats`, `terminal_create_session`, `terminal_list_sessions`, `terminal_snapshot`, `terminal_write`, `terminal_resize`, `terminal_close_session`, `terminal_clear_buffer`, `qx_external_displays_driver`, `qx_external_displays_install_driver`, `qx_external_displays_list`, `qx_external_displays_set_control`, `start_recording`, `stop_recording`, `recording_status`, `screencap_begin_region_select`, `screencap_begin_capture_select`, `screencap_list_displays`, `screencap_list_windows`, `screencap_set_picker_passthrough`, `screencap_set_pointer_follow`, `screencap_select_display`, `screencap_cancel_region_select`, `screencap_confirm_region_select`, `screencap_region_select_status`, `screencap_show_controls`, `screencap_toggle_controls`, `screencap_hide_controls`, `screencap_set_controls_pinned`, `screencap_return_to_main`, `screencap_copy_image_to_clipboard`, `convert_recording_to_gif`, `save_gif`, `list_gif_history`, `get_screencap_history`, `delete_screencap`, `is_recording`, `island_window_ensure`, `island_window_show`, `island_window_hide`, `island_window_set_always_on_top`, `island_window_get_snapshot`, `island_sessions_publish`, `fetch_plugin_index`, `download_plugin`, `install_plugin`, `install_plugin_from_url`, `install_raycast_extension_from_url`, `uninstall_plugin`, `list_installed_plugins`, `read_plugin_entry`, `set_plugin_enabled`, `plugin_storage_get`, `plugin_storage_set`, `plugin_storage_delete`, `plugin_storage_list`, `plugin_storage_clear`, `plugin_data_usage`, `plugin_data_clear`, `plugin_preferences_get`, `plugin_preferences_set`, `sign_plugin`, `scaffold_plugin`, `plugin_tray_set_items`, `plugin_tray_clear`, `plugin_tray_list`, `plugin_clipboard_read`, `plugin_clipboard_write`, `plugin_perform_paste`, `plugin_perform_paste_at_cursor`, `plugin_run_applescript`, `plugin_file_read_base64`, `plugin_file_exists`, `plugin_file_ensure_dir`, `plugin_file_write_base64`, `plugin_file_empty_dir`, `plugin_file_list`, `plugin_ai_list_providers`, `plugin_ai_default_model`, `plugin_ai_agent_settings`, `plugin_ai_chat`, `plugin_ai_stream_chat`, `plugin_ai_run_bash`, `plugin_cli_run`, `plugin_cli_bash`, `plugin_cli_which`, `plugin_cli_start`, `plugin_cli_poll`, `plugin_cli_cancel`, `plugin_cli_list_jobs`, `plugin_system_env`, `plugin_system_open_path`, `plugin_system_reveal_path`, `plugin_ai_grep_search`, `plugin_ai_memory_list`, `plugin_ai_memory_add`, `plugin_ai_memory_delete`, `plugin_http_fetch`, `plugin_notification_show`, `plugin_resolve_asset`, `qx_permissions_status`, `qx_permissions_request`, `qx_permissions_request_all`, `qx_permissions_open_settings`, `qx_onboarding_platform`, `qx_update_check`, `qx_update_download_and_install`, `download_ocr_model`, `check_ocr_models`, `macro_start_recording`, `macro_stop_recording`, `macro_save`, `macro_list`, `macro_delete`, `macro_play`, `record_launch`, `get_launch_history`, `clear_launch_history`, `record_search`, `get_search_history`, `clear_search_history`, `delete_search_entry`, `record_search_click`, `get_search_click_stats`, `clear_search_click_stats`, `v2ex_fetch_topics`, `v2ex_search_topics`, `v2ex_fetch_node_topics`, `v2ex_fetch_topic_replies`, `v2ex_fetch_token_info`, `v2ex_fetch_notifications`, `github_contributions`, `github_contributions_raw`, `fetch_weather`, `fetch_weather_for_location`, `get_cached_weather`, `get_cached_weather_for_location`, `detect_location`, `g4f_chat`, `g4f_stream_chat`, `g4f_chat_custom`, `g4f_list_providers`, `qxai_stream_chat`, `qxai_stream_chat_events`, `qxai_chat_with_tools`, `qxai_list_providers`, `qxai_fetch_models`, `qxai_get_builtin_provider_credentials`, `qxai_save_builtin_provider_credentials`, `qxai_get_custom_providers`, `qxai_save_custom_providers`
<!-- IPC_COMMANDS_END -->

## 事件通道

命令之外，后端还通过 `Emitter::emit` 发这些事件：

| 事件 | 触发方 | 消费方 |
|---|---|---|
| `navigate` | 托盘 / `show_and_navigate` / `toggle` / 全局模块快捷键 | `App.tsx` `listen("navigate")` 设 tab |
| `apps:updated` / `apps:icons-ready` | 后台索引 | `App.tsx` `doSearch` 重刷 |
| `clipboard-updated` | 剪贴板轮询 / `read_clipboard_image_now` | `ClipboardPanel.tsx` |
| `clipboard-media-progress` | 图片压缩 / 视频转 GIF 后台任务 | `ClipboardPanel.tsx` 灵动岛进度 |
| `qxai://stream` | `qxai_stream_chat_events` 内部线程 | `modules/qx-ai/store.ts`、`react-agent.ts` |
| `ocr:download-progress` | `download_ocr_model` | `modules/settings/OcrSettings.tsx` |
| `qx-terminal-output` / `qx-terminal-exit` | QxTTY PTY reader | `modules/qx-tty/QxTTYPanel.tsx` |
| 显示器变化 | `display_monitor::start_display_monitor` | 内部 auto-show panel |

## 约定

- 每个命令的错误统一 `Result<T, String>`，字符串直接前端 `catch (e)` 展示。
- 后端不接触 UI；命令内如需异步用 `#[tauri::command]` + `async`，重活起 `std::thread::spawn` + 通过事件回主线程。
- 前端 `invoke("cmd", { camelCaseArg })`；后端参数用 snake_case，Tauri 自动转换。
- 插件永远不直接 `invoke`；先经过 `plugin/rpcMethods.ts` 的白名单和权限检查。见 [plugin-architecture.md](./plugin-architecture.md)。

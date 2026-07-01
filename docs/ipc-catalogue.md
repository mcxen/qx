# IPC 命令目录

Qx 前后端通过 Tauri v2 的 `invoke` 通道通信。所有 `#[tauri::command]` 都在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler!` 中注册（第 294–422 行）。当前共 127 个命令。

`capabilities/default.json` 只声明了 Tauri **插件**权限（`opener`、`global-shortcut`、`clipboard-manager`、`shell`、`core:window`、`core:path`）。自定义命令注册后即可从主 webview 直接调用，无需额外 capability 条目。

新增命令后请同步更新本表和调用方。

## apps

| 命令 | 签名 | 用途 |
|---|---|---|
| `search_apps` | `(query: String) -> Vec<AppEntry>` | 已安装 `.app` 打分排序，空 query 返回前 20 |
| `search_files` | `(query: String) -> Vec<AppEntry>` | 调用 mdfind 返回最多 12 条结果 |

调用方：`App.tsx`、`plugin/runtime.ts`、`plugin/context.ts`、`modules/qx-ai/react-agent.ts`

## clipboard

| 命令 | 用途 |
|---|---|
| `get_clipboard_history(limit?)` | 读取置顶 + 最近文本/图片剪贴板条目 |
| `read_clipboard_image_now()` | 立即读当前剪贴板图片，落盘并触发 `clipboard-updated` |
| `write_clipboard_image_entry(id)` | 将历史图片回写系统剪贴板 |
| `clear_clipboard_history()` | 清空全部 |
| `delete_clipboard_entry(id)` | 删单条 |
| `toggle_clipboard_pin(id)` | 置顶开关 |
| `record_clipboard_copy(id)` | 累加 `copy_count` |
| `read_image_file(path)` | 校验魔数后读磁盘图片二进制 |

## rss

`rss_list_feeds`、`rss_add_feed(url)`、`rss_update_feed(id, url, title)`、`rss_remove_feed(id)`、`rss_list_articles(feed_id?, only_unread, query?)`、`rss_get_article(id)`、`rss_mark_read(id, is_read)`、`rss_mark_all_read(feed_id)`、`rss_toggle_star(id, is_starred)`、`rss_refresh_feed(id)`、`rss_refresh_all()`、`rss_import_opml(content)`、`rss_export_opml()`。

## v2ex

`v2ex_fetch_topics(mode)`、`v2ex_search_topics(query)`、`v2ex_fetch_node_topics(node)`（需 token）、`v2ex_fetch_topic_replies(topic_id)`、`v2ex_fetch_token_info()`、`v2ex_fetch_notifications()`。

## weather

`detect_location()`（IP 定位）、`fetch_weather()`（Open-Meteo / OpenWeatherMap）。

## screencap

`start_recording(area?)`、`stop_recording() -> gif_path`、`save_gif(src, dest)`、`get_screencap_history(limit?)`（`list_gif_history` 别名）、`delete_screencap(id)`、`is_recording()`。

## macros

`macro_start_recording()`、`macro_stop_recording()`、`macro_save(name, data)`、`macro_list()`、`macro_delete(id)`、`macro_play(id)`。

## qxai / g4f

面向前端的：`qxai_list_providers`、`qxai_stream_chat_events(request_id, provider?, model?, messages)`、`qxai_chat_with_tools(...)`、`qxai_fetch_models(base_url, api_key)`、`qxai_get_custom_providers`、`qxai_save_custom_providers`。

内置只给插件层用的兼容命令：`g4f_chat`、`g4f_stream_chat`、`g4f_chat_custom`、`g4f_list_providers`、`qxai_stream_chat`。

## plugin AI （给插件的受控入口）

`plugin_ai_list_providers`、`plugin_ai_default_model`、`plugin_ai_agent_settings`、`plugin_ai_chat(req)`、`plugin_ai_stream_chat(req)`、`plugin_ai_run_bash(req)`（有 timeout）、`plugin_ai_grep_search(req)`、`plugin_ai_memory_list/add/delete`。

任何来自插件 iframe 的调用先进 `plugin/rpcMethods.ts` 做 capability 校验，再走这些命令。

## plugin 通用宿主 API

`plugin_clipboard_read/write`、`plugin_perform_paste`、`plugin_perform_paste_at_cursor`、`plugin_http_fetch(req)`（只允许 http/https + 超时）、`plugin_notification_show(req)`、`plugin_resolve_asset(id, asset_path)`。

## marketplace

`fetch_plugin_index`、`download_plugin(url)`、`install_plugin(path)`、`install_plugin_from_url(url)`、`install_raycast_extension_from_url(url)`、`uninstall_plugin(id)`、`list_installed_plugins()`、`read_plugin_entry(id)`、`set_plugin_enabled(id, enabled)`、`plugin_storage_get/set/delete(id, key, value?)`、`plugin_preferences_get/set(id, values?)`、`sign_plugin(dir, private_key_hex)`、`scaffold_plugin(name, output_dir)`。

## settings

`get_settings()`、`update_settings(settings)`、`reset_settings()`、`import_settings(path)`、`export_settings(path)`。写入操作会重新注册全局快捷键并刷新托盘菜单。

## floating_panel

`floating_show`、`floating_hide`、`floating_hide_restore_focus`、`floating_toggle`、`floating_request_key`（输入框获取焦点时调用，使 panel 成为 keyWindow）。

## history

`record_launch(path, name)`、`get_launch_history(limit)`、`clear_launch_history`、`record_search(query)`、`get_search_history(limit)`、`clear_search_history`、`delete_search_entry(id)`。

## system 相关

- `get_system_stats()` — Mach APIs 读 CPU/内存
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
- `qx_permissions_status/request/open_settings` — macOS TCC
- `github_contributions(username)` / `github_contributions_raw(username)`

## 事件通道

命令之外，后端还通过 `Emitter::emit` 发这些事件：

| 事件 | 触发方 | 消费方 |
|---|---|---|
| `navigate` | 托盘菜单 quick_entry / `show_and_navigate` | `App.tsx` DOM `qx:navigate` |
| `apps:updated` / `apps:icons-ready` | 后台索引 | `App.tsx` `doSearch` 重刷 |
| `clipboard-updated` | 剪贴板轮询 / `read_clipboard_image_now` | `ClipboardPanel.tsx` |
| `qxai://stream` | `qxai_stream_chat_events` 内部线程 | `modules/qx-ai/store.ts`、`react-agent.ts` |
| `ocr:download-progress` | `download_ocr_model` | `modules/settings/OcrSettings.tsx` |
| 显示器变化 | `display_monitor::start_display_monitor` | 内部 auto-show panel |

## 约定

- 每个命令的错误统一 `Result<T, String>`，字符串直接前端 `catch (e)` 展示。
- 后端不接触 UI；命令内如需异步用 `#[tauri::command]` + `async`，重活起 `std::thread::spawn` + 通过事件回主线程。
- 前端 `invoke("cmd", { camelCaseArg })`；后端参数用 snake_case，Tauri 自动转换。
- 插件永远不直接 `invoke`；先经过 `plugin/rpcMethods.ts` 的白名单和权限检查。见 [plugin-architecture.md](./plugin-architecture.md)。

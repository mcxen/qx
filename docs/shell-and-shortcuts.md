# Shell、全局快捷键与托管 State

> 状态：Current · 适用版本：v0.5.13 · Owner：Core · 最后复核：2026-07-14

本文记录 **浮动主窗口 / 全局快捷键切换 / RSS·Clipboard 托管 State / 搜索框重聚焦** 的约定与坑。改这些行为前先读这里，避免全库搜一遍。

相关源码：

| 区域 | 路径 |
|------|------|
| 浮动面板 + 开合状态 | `src-tauri/src/floating_panel.rs` |
| 全局快捷键注册 | `src-tauri/src/settings/mod.rs` → `register_shortcuts` |
| 启动顺序 / safe_init | `src-tauri/src/lib.rs` |
| RSS State | `src-tauri/src/rss/mod.rs`、`rss/storage.rs` |
| Clipboard State | `src-tauri/src/clipboard.rs`（`start_listener`） |
| tab ↔ route 同步 | `src/App.tsx`（`set_active_route`） |
| 搜索框焦点 | `src/SearchBar.tsx`、`src/App.tsx` |
| 快捷键文案 UI | `src/modules/settings/ShortcutSettings.tsx` |

---

## 1. 设计目标

1. **Launcher 召唤与当前窗口显隐分离**：`toggle_launcher` 隐藏时显示 Launcher 并聚焦搜索、显示时隐藏；`toggle_window` 只切换显隐，不改变当前 route / 子界面。
2. **模块快捷键**（剪贴板 / RSS / GIF）：打开对应 tab；若已在该 tab 再按 → 隐藏窗口；若窗口开着但在别的 tab → 切到该模块。
3. **所有关闭路径**应尽量走 Rust `floating_panel::hide*`，保证内部 `PANEL_OPEN` / `LAST_HIDE_AT` 一致。
4. **Tauri managed state**（`RssDb`、`ClipboardDb`）在启动时**始终** `app.manage(...)`，不能因 DB open 失败而漏注册（否则前端会报 *state not managed* / 缺少 `.manage()`）。

---

## 2. 浮动面板状态机（`floating_panel.rs`）

### 2.1 内部状态

| 符号 | 类型 | 含义 |
|------|------|------|
| `PANEL_OPEN` | `AtomicBool` | 业务层认为面板是否应处于打开（比单独 `is_visible()` 更稳，尤其 NSPanel） |
| `LAST_HIDE_AT` | `Instant?` | 上次 `hide` 时间 |
| `ACTIVE_ROUTE` | `String` | 当前 tab/route（`launcher` / `clipboard` / `rss` / …） |
| `HIDE_TOGGLE_GRACE` | ~280ms | 关闭后的防抖窗口 |

`mark_panel_open()` / `mark_panel_closed()` 由 `show_floating` / `hide` 调用。

`panel_appears_open(win)` = `PANEL_OPEN || win.is_visible()`。

### 2.2 公开 API

| 函数 | 行为 |
|------|------|
| `show_floating` | `mark_open` + show +（macOS）key window |
| `hide` | `mark_closed` + hide |
| `hide_and_restore_focus` | hide + 恢复先前前台 App（粘贴/切换场景） |
| `toggle` | **当前窗口快捷键**：开 → 关；关 → 开，保留当前 route |
| `toggle_launcher` | 隐藏时显示窗口并 navigate `launcher`；显示时隐藏并恢复焦点 |
| `toggle_route(route)` | **模块快捷键**（见下） |
| `show_and_navigate(route)` | 显示并 `emit("navigate", route)`，同时 `remember_active_route` |
| `set_active_route`（command） | 前端 tab 变化时同步 Rust 侧 route |

### 2.3 `toggle_route(route)` 规则

```text
if panel open && active_route == route  → hide_and_restore_focus  (切换：关)
else if !open && same route && recently_closed (~280ms)
                                       → stay closed  (吸收 blur 竞态，勿立刻再开)
else                                   → show_and_navigate(route)
```

### 2.4 经典竞态：blur 自动隐藏 vs 全局热键

用户设置里默认 `autoHideOnBlur: true`。

错误时序（修之前）：

1. 用户再按模块快捷键（意图：关闭）
2. 面板失焦 → 前端 `win.hide()` → 窗口已不可见
3. 全局热键回调执行 `toggle_route`，看到 `!is_visible` → 当成「打开」→ 又 show

正确做法：

- 关闭统一走 `invoke("floating_hide_restore_focus")`（或 `floating_hide`），写 `PANEL_OPEN=false` + `LAST_HIDE_AT`
- `toggle` / `toggle_route` 在 grace 内对同一 route **保持关闭**

前端失焦隐藏（`App.tsx` focus listener）必须用 Rust hide，不要裸 `getCurrentWindow().hide()`。

---

## 3. 全局快捷键注册（`settings/mod.rs`）

`register_shortcuts(app, settings)`：

1. `unregister_all`
2. 按 settings 注册：
   - `toggle_launcher` → `floating_panel::toggle_launcher`
   - `toggle_window` → `floating_panel::toggle`
   - `clipboard` → `toggle_route(app, "clipboard")`
   - `rss` → `toggle_route(app, "rss")`
   - `capture_screenshot` → 在鼠标所在显示器开始截图圈选
   - `record_gif`（legacy id）→ 在鼠标所在显示器开始录屏圈选
   - `app_shortcuts` 启动本机 App（不走 toggle_route）
3. 仅 `ShortcutState::Pressed` 触发一次

默认键（`Settings::default`）：

| id | 默认键 | 默认 enabled |
|----|--------|--------------|
| `toggle_launcher` | `Alt+Space` | true |
| `toggle_window` | `Alt+Shift+Space` | false |
| `clipboard` | `Alt+V` | false |
| `capture_screenshot` | `Alt+Shift+S` | false |
| `record_gif` | `Alt+G` | false |
| `rss` | `Alt+R` | false |

用户配置：`~/.qx/settings.json` → `shortcuts`。

`portable_shortcut_key`：`Cmd`/`Meta`/`Primary`/`Mod` → 注册用 `CmdOrCtrl`；裸 `Ctrl` 保持 Control。

### 3.1 绑定建议

- **不要**把模块快捷键绑到 `Ctrl+V` / `Cmd+V`（系统粘贴会与热键抢事件，聚焦 WebView 时尤其明显）。
- 优先 `Alt`/`Option` + 字母，与输入框编辑冲突少。

### 3.2 前端 route 同步

`App.tsx`：

```ts
useEffect(() => {
  void invoke("set_active_route", { route: tab }).catch(() => {});
}, [tab]);
```

`navigate` 事件把 Rust emit 的 payload 设为 tab。**toggle_route 依赖 `ACTIVE_ROUTE` 与 UI tab 一致**；改 tab 名时两边一起改。

---

## 4. 隐藏窗口的正确入口

| 场景 | 应调用 |
|------|--------|
| 全局快捷键关闭 | `hide_and_restore_focus`（toggle 内） |
| Esc 最终隐藏 | `invoke("floating_hide_restore_focus")` |
| 失焦自动隐藏 | 同上 |
| 启动 App / 粘贴后隐藏 | 同上（需还焦点给目标 App 时） |
| 仅收起、不必还焦点 | `invoke("floating_hide")` |
| 关窗口按钮（close requested） | Rust `floating_panel::hide` |

**反模式**：业务路径长期裸调 `getCurrentWindow().hide()` —— 会导致 `PANEL_OPEN` 与可见性脱节，快捷键切换异常。

---

## 5. Tauri managed State：始终 `.manage()`

### 5.1 症状

前端 `invoke("rss_*")` 报错类似：

- `state not managed`
- 文案里提到缺少 `.manage()`

### 5.2 原因

旧逻辑：`rss::init` 仅在 `storage::open()` **成功**时 `app.manage(RssDb)`。open 失败则命令层完全找不到 State。

Clipboard 一直是：open 失败也 manage（连接为 `Option`），按需重连。

### 5.3 正确模式（RSS 已对齐 Clipboard）

```text
rss::init:
  conn = open().ok()   // 失败 → None + 日志
  app.manage(RssDb(Arc<Mutex<Option<Connection>>>))   // 始终 manage

with_db / ensure_open:
  if slot is None → 再试 open()
  再执行 SQL
```

要点：

- **manage 与 open 成功解耦**；manage 只是注册句柄，开销可忽略。
- setup 里 `safe_init("rss", …)` 吞 panic 时，仍应保证 `init` 末尾 manage 已执行（open 用 `Result`，勿 panic）。
- 用户看到的应是 `rss db open: …`，而不是 missing manage。

文件：

- `RssDb` / `ensure_open`：`rss/storage.rs`
- `init` / `with_db`：`rss/mod.rs`
- Clipboard 对照：`clipboard.rs` → `start_listener` 里 `ClipboardDb(Arc<Mutex<Option<Connection>>>)`

---

## 6. 启动器搜索框重聚焦

问题：Option+Space 再次召唤时 `SearchBar` 仍挂载，mount 时的 `focus()` 不会再跑 → 无法直接打字。

约定：

| API | 位置 | 作用 |
|-----|------|------|
| `FOCUS_LAUNCHER_SEARCH_EVENT` | `SearchBar.tsx` | `qx:focus-launcher-search` |
| `requestLauncherSearchFocus()` | `SearchBar.tsx` | 派发上述事件 |
| 监听 + `focusInput` | `SearchBar` | 先 `requestPanelKeyWindow` 再 `input.focus` |
| 调用点 | `App.tsx` | 窗口 show/focus、`navigate` → `launcher` |

`focusInput` 在 `visible` 变化时也会 rAF + 短 timeout 再试（key window 异步）。

---

## 7. 改动检查清单

改全局快捷键 / 隐藏 / RSS 初始化时：

- [ ] 新隐藏路径是否走 `floating_hide*` 或 `floating_panel::hide*`？
- [ ] `toggle` / `toggle_route` 是否仍满足「再按关闭」？
- [ ] 新 managed State 是否在失败路径仍 `manage`？
- [ ] 新 tab id 是否写入 `set_active_route` / `navigate` / `toggle_route` 字符串？
- [ ] 快捷键是否避开系统粘贴/Spotlight（`keyboard.ts` 保留键）？
- [ ] 文档：本文件 + 必要时 `ipc-catalogue.md`、`rust-backend.md`

---

## 8. 快速验证

1. 启用剪贴板快捷键（默认建议 `Alt+V`）→ 按一次打开剪贴板 → 再按隐藏。
2. 窗口在 launcher 时按剪贴板快捷键 → 切到 clipboard（不先关）。
3. 开着剪贴板时点桌面触发 blur 隐藏 → 再按快捷键应能重新打开（grace 过后）。
4. 破坏 `rss.db` 权限或路径后启动 → 命令应返回 open 错误，**不应** missing manage。
5. Option+Space 隐藏再显示 → 可直接输入搜索。
6. 在 RSS / Clipboard / Settings 内用 `toggle_window` 隐藏再显示 → 仍停留原 route 和子界面。
7. 任意界面使用 `toggle_launcher` → 隐藏时显示 Launcher 并聚焦搜索；再次按下隐藏。

---

## 9. 版本笔记

| 版本/提交 | 内容 |
|-----------|------|
| v0.5.13 | 模块快捷键同 route 再按 dismiss；`ACTIVE_ROUTE` + `set_active_route` |
| 后续 fix | `PANEL_OPEN` / `LAST_HIDE_AT` 防 blur 竞态；隐藏走 Rust；RSS 始终 manage + lazy open；SearchBar 重聚焦 |

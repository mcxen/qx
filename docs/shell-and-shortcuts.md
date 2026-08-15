# Shell、全局快捷键与托管 State

> 状态：Current · 适用版本：v0.6.53 · Owner：Core · 最后复核：2026-08-01

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
   前端 `setTab` **不得**清空 launcher `results`；Option+Space 重开应先 paint 缓存首页，再后台刷新（见 `docs/frontend-architecture.md`）。
2. **模块快捷键**（剪贴板 / RSS / GIF）：打开对应 tab；若已在该 tab 再按 → 隐藏窗口；若窗口开着但在别的 tab → 切到该模块。
3. **所有关闭路径**应尽量走 Rust `floating_panel::hide*`，保证内部 `PANEL_OPEN` / `LAST_HIDE_AT` 一致。
4. **Tauri managed state**（`RssDb`、`ClipboardDb`）在启动时**始终** `app.manage(...)`，不能因 DB open 失败而漏注册（否则前端会报 *state not managed* / 缺少 `.manage()`）。
5. **进程首窗可见**：Qx 完全退出后再次启动时，`App.tsx` 在设置与窗口尺寸恢复完成后
   主动 `floating_show` 一次；这与同一进程内的快捷键 toggle / hide 状态分开。首次安装
   使用能显示 Launcher 右侧 Quick Entries 的宽窗尺寸，老用户继续恢复保存尺寸。

Windows 的透明无边框主窗口使用 Tao 的 undecorated-shadow 模式，由 DWM 在 WebView
边界外绘制四周原生阴影；`tauri.conf.json` 与 `floating_panel::install` 都保持
`shadow=true`。WebView 自己只画语义边框与内高光，不用会被窗口矩形裁切的 CSS 外阴影。
macOS 继续由 AppKit 绘制 launcher 外阴影。

Windows/Tao 以 Per-Monitor V2 运行。显示器 `workArea.size` 与 resize event payload 是
物理像素，首窗/设置尺寸是逻辑像素：前端必须使用显示器或窗口 scale factor 做转换，
并在 `scaleChanged` 后使用事件携带的新比例解释紧随其后的 resize，不能给 WebView
额外设置 CSS zoom。1280×720 等紧凑工作区允许 Launcher 响应式收起 Context Panel，
不得用 980×612 的首窗硬下限把窗口撑到接近全屏。

无边框窗口的移动与缩放必须分开：Top Bar 的 `data-tauri-drag-region` 只负责移动。
Windows 下，`QxShell` 最外沿由八方向 `startResizeDragging` 手柄负责缩放；不得把
四条边缘再次标成 drag region，否则 WebView2 会优先开始移动窗口，表现为
`resizable: true` 但鼠标无法拖动改变大小。Tauri/tao 在 macOS 对该 API 返回
unsupported，因此 macOS 不渲染 WebView 手柄，继续使用 Cocoa/NSPanel 的原生可调整
大小边缘，避免覆盖层吞掉原生命中。
Windows WebView2 不保证父级 `data-tauri-drag-region` 穿过铺满顶栏的搜索/控件子树；
`QxShell` 因此在 8px 顶部/侧边 resize hit zone 内侧保留独立握区，并对顶栏的
非交互子元素显式调用 `startDragging()`。输入、按钮、链接、select、contenteditable
与 `data-qx-no-window-drag` 必须排除，避免拖窗抢走文字选择或点击。
Top Bar 的移动只能由该显式 handler 发起，不得再叠加
`data-tauri-drag-region` 或 `-webkit-app-region: drag`；Windows WebView2 对同一
pointerdown 启动两条原生 move loop 会产生明显卡顿。自绘 Title Bar 不经过该 React
handler，继续单独使用 Tauri drag region。
该调用还必须由 `src-tauri/capabilities/default.json` 显式授予
`core:window:allow-start-resize-dragging`；`core:window:default` 和
`allow-start-dragging` 都不包含缩放 IPC。

Windows 11 主窗口由 DWM Mica 承担桌面背景材质；Windows 10 使用高不透明度
WebView 表面回退，不启用 `window-vibrancy` 官方明确标注会造成拖拽/缩放卡顿的
Acrylic。WebView 内的 canvas/top/context/bottom 也不再叠加 CSS
`backdrop-filter`，避免移动透明窗口时每帧重复采样桌面并执行多层 blur。Windows
的 surface opacity floor 负责保持文字和区域层级，macOS Vibrancy/CSS blur 语义保持不变。

Appearance 中的 `title_bar_visible` 启用 Qx 自绘标题栏，macOS 与 Windows 共用同一
Shell 端口并按平台排列控制按钮。拖动继续使用 `allow-start-dragging`，最大化使用
`allow-toggle-maximize`，最小化必须显式授予 `core:window:allow-minimize`。关闭按钮走
`floating_hide_restore_focus`，不得调用原生 close 销毁可复用主窗口。

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

### 文件管理器选择的唤起前快照

`show_floating` 与 `show_and_navigate` 在 Qx 取得焦点前调用根级 `file_manager` 服务。Windows 先保存前台 Explorer HWND，再在 worker 中读取该窗口的 `SelectedItems`；macOS 仅在 Finder 为前台应用时读取 Finder selection。结果以带单调 `revision` 的 `file-manager:selection` 事件和 `file_manager_get_selection` 命令发布。Qx 已经位于前台或来源不是系统文件管理器时不得清空上一份快照，否则模块切换会丢失用户刚才的输入上下文。

### 2.3 `toggle_route(route)` 规则

```text
if panel open && active_route == route  → hide_and_restore_focus  (切换：关)
else if !open && same route && recently_closed (~280ms)
                                       → stay closed  (吸收 blur 竞态，勿立刻再开)
else                                   → show_and_navigate(route)
```

### 2.4 经典竞态：blur 自动隐藏 vs 全局热键

窗口显示方式在 Settings → Appearance → Window & Density 统一管理：
`always-on-top` 始终置顶、`normal` 按普通窗口参与前后层级、`auto-hide` 悬浮在桌面上且失焦自动隐藏。
旧版 `autoHideOnBlur` 仍作为兼容字段保留，不再单独作为用户设置展示。
同一处还可选择是否保留 macOS Dock / Windows 任务栏图标；关闭时 Qx 继续以后台工具方式运行，开启时按传统桌面应用显示在应用列表中。

错误时序（修之前）：

1. 用户再按模块快捷键（意图：关闭）
2. 面板失焦 → 前端 `win.hide()` → 窗口已不可见
3. 全局热键回调执行 `toggle_route`，看到 `!is_visible` → 当成「打开」→ 又 show

正确做法：

- 关闭统一走 `invoke("floating_hide_restore_focus")`（或 `floating_hide`），写 `PANEL_OPEN=false` + `LAST_HIDE_AT`
- `show_floating_now` 在原生层统一设置 500ms auto-hide grace，吸收 Windows WebView2
  与 macOS panel 在 `show + focus` 期间的瞬时 `Focused(false)`；模块不得各自复制延时
- 剪贴板等需要说明动作目标的模块通过 `floating_previous_app_name` 读取召唤面板前的应用名；它只用于“粘贴到 …”反馈，实际还原焦点仍统一走 `floating_hide_restore_focus`。
- `toggle` / `toggle_route` 在 grace 内对同一 route **保持关闭**
- 主窗口与 `island` 浮窗属于同一 Qx 焦点组。原生层收到任一窗口 `Focused(false)` 后
  等待 80ms 再检查两窗焦点；主窗 → 灵动岛的切换不得触发自动隐藏，只有两窗都未聚焦
  才按设置隐藏主窗。灵动岛再失焦到外部应用时也必须重新执行同一判定。

前端 `App.tsx` focus listener 不自行决定 blur 是否隐藏，只在原生判定完成后同步真实窗口
可见性；所有显式关闭仍必须走 Rust hide，不要裸 `getCurrentWindow().hide()`。

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
   - `toggle_capture_controls` → 显示/隐藏截图与录屏捕获灵动岛，不改变当前主窗口 route
   - `app_shortcuts` 启动本机 App（不走 toggle_route）
3. 仅 `ShortcutState::Pressed` 触发一次

macOS 的 `Cmd+Space` 是唯一的系统保留例外：设置页允许录入它，注册时由
`settings/macos_shortcut_override.rs` 使用窄范围的 CoreGraphics event tap 在
Spotlight 之前消费精确的 `Cmd+Space`，然后调用同一个 Qx 动作回调。该适配器不
记录或转发其他键，也不改变普通快捷键的 Tauri 注册路径。它需要用户在 macOS
“系统设置 → 隐私与安全性 → 辅助功能 / 输入监控”中允许 Qx；没有权限时 Qx
继续运行，并在诊断日志中记录接管失败。Windows 的 `Ctrl+Space` 可由 Tauri 全局快捷键
端口正常注册，不得在设置校验层误报为系统保留组合。

应用启动快捷键可在 **设置 → 快捷键 → 应用启动** 用「添加应用」打开可搜索 Popover
（`search_apps`）选择本机 App 后录制；也可在启动器结果右键录制。绑定键存
`settings.app_shortcuts`（id 形如 `app:<path>`）。添加/录制全程留在 Settings，
不得唤起目标 App 或因 Esc 误关主窗（Popover Esc 只关选择器；录制时
`shortcuts_pause_global`）。

插件 command 的全局快捷键走同一宿主注册生命周期，但不是 `app_shortcuts`：插件
manifest 的 `shortcuts[]` 只提供默认声明（默认应为 disabled），用户在 **设置 →
扩展 → 已安装 → 插件 → Shortcuts** 的 Toggle / ShortcutRecorder 中启用或重录。
用户值持久化在 `settings.shortcuts` 的稳定 namespaced id
`plugin:<pluginId>:<command>`；注册前将其与 manifest 默认合并，修改后由宿主统一
重新注册。插件 command 不得伪装成原生 App 快捷键。

所有带 Panel 的内置模块与市场插件还会显示一个通用“打开插件”录入项，保存为
`open:<route>`（例如 `open:file-actions`、`open:plugin:<pluginId>`）。Rust
`register_shortcuts` 统一注册这些面板快捷键，并沿用 `toggle_route` 的再次按键隐藏语义。
插件命令的 `plugin:<pluginId>:<command>` 也由 Rust 注册；触发时只向已加载的前端
runtime 发布 `plugin-global-shortcut`，再由 registry 校验启用状态并解析命令。前端不得
直接调用 global-shortcut `register`，否则 Settings 保存或录制暂停后的 `unregister_all`
会让插件绑定永久丢失。

默认键（`Settings::default`）。Windows 避开系统窗口菜单及 PowerToys Run 常用的
`Alt+Space`；macOS 继续使用对应的 `Option+Space`：

| id | macOS 默认键 | Windows 默认键 | 默认 enabled |
|----|---------------|-----------------|--------------|
| `toggle_window` | `Alt+Space` | `Ctrl+Alt+Space` | true |
| `toggle_launcher` | `Alt+Shift+Space` | `Ctrl+Alt+Shift+Space` | false |
| `clipboard` | `Alt+V` | `Alt+V` | false |
| `capture_screenshot` | `Ctrl+G` | `Ctrl+G` | true |
| `record_gif` | `Alt+G` | `Alt+G` | false |
| `toggle_capture_controls` | `Alt+Shift+C` | `Alt+Shift+C` | false |
| `rss` | `Alt+R` | `Alt+R` | false |

启动时单个全局键若被系统或第三方程序占用，只记录诊断并继续创建托盘和首启界面；
不得因为快捷键注册失败中止 `setup`，否则初始隐藏窗口会表现成 Qx 完全无法启动。
设置保存仍把注册错误返回给用户，以便更换冲突按键。

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

### 3.3 快捷键录制器

- Windows 截图完成、复制或取消时，必须先 cloak 透明 picker 和 shade HWND，隐藏并跨过一次
  `DwmFlush` 合成边界后再恢复主 WebView；复用前解除 cloak，并在启动时为 WebView2 配置
  透明默认背景。

- 录制期间以 `Esc`、取消按钮或点击录制器外部作为取消入口；不得用录制按钮的
  DOM `blur` 取消。Windows 按下 `Alt` 时可能短暂转移控件焦点，而截图/录屏默认键
  正是 `Alt+Shift+S` / `Alt+G`，把 blur 当取消会导致主键永远无法录入。
- `shortcuts_pause_global` 与 `shortcuts_resume_global` 必须严格串行。快速按键时也必须
  保证先完成注销、再恢复注册，禁止异步竞态把所有全局热键留在注销状态。
- 全局截图快捷键在主 Qx 窗口可见时保留当前模块，让 Qx 自身可被截图；截图 picker 会用
  专用的 capture-main-visible guard 暂停失焦自动隐藏。取消、完成或切换为录屏时必须清除此
  guard；圈选层和独立截图控制栏始终保持内容保护。
- 截图会话必须记录启动瞬间主 Qx 窗口是否可见。桌面应用中用全局快捷键启动后，Esc 仅
  关闭 picker 并保持 Qx 隐藏；只有从可见 Qx 界面启动的会话，Esc 才恢复原模块。该来源
  状态随跨显示器 picker 迁移保留，不得用“取消后总是打开截图模块”的布尔逻辑替代。
- Windows 在保留主窗口截图时，必须先解除主窗口的内容保护，再显示、置顶并聚焦 picker；
  所有主窗口/控制栏变更完成后要重新确认 picker 的交互与焦点。焦点交接失败必须立即隐藏
  全屏 picker、结束 capture session 并恢复可操作界面，不能留下吞掉桌面点击但收不到 Esc
  的透明遮罩。picker WebView 还需保留窗口内 Esc 兜底，不依赖某个 React 根节点持有焦点。

---

## 4. 隐藏窗口的正确入口

Windows 主窗口保持无边框并使用 DWM 原生阴影。Windows 11 的非客户区边框与阴影是两个独立属性：宿主必须在启用阴影后将 `DWMWA_BORDER_COLOR` 设置为 `DWMWA_COLOR_NONE`，只移除一像素黑色/强调色边框，不得为隐藏黑框而关闭四边阴影或在 WebView 内伪造无法越过窗口边界的 CSS 阴影。

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

`focusInput` 在 `visible` 变化与 Launcher 再次获得 key focus 时都会 immediate + rAF + 一次短 timeout 有限重试（key window / WebView first responder 异步）；失焦/隐藏必须立即取消前端 retry 与 debounce。Rust `floating_request_key` 在 UI 线程触碰 AppKit 前必须重新确认 `PANEL_OPEN && is_visible`，禁止迟到的 `makeKeyAndOrderFront` 复活已因 outside click 隐藏的窗口。重试不得形成轮询，也不得从已聚焦的其他文本编辑器或打开的键盘弹层抢焦点。Launcher 空 query 的 Esc 另有 window bubble fallback，仅在 React/Radix 未消费事件时隐藏窗口，不使用进程级键盘 monitor。

Windows WebView2 已经拥有普通激活窗口语义，`usePanelKeyWindow` 不得在每次 DOM focus 时调用
`floating_request_key`；该原生 key-window 请求只用于 macOS 非激活 NSPanel。否则输入框、按钮与
列表之间的焦点移动会产生重复 IPC 和 WebView2 `set_focus` 抖动，直接拖慢键盘与搜索。

### 6.0 窗口激活后台任务

`src/shell/windowActivation.ts` 是窗口 show/focus/navigate 后的统一异步端口。`App.tsx` 的
原生 focus 回调只同步可见状态、恢复 Launcher 快照和搜索焦点，然后发布一次 activation；
缓存修复、使用记录读取、系统指标、剪贴板目标名称、截图会话与历史同步必须注册为稳定 id
的 activation task。端口负责延迟到首帧之后、进入浏览器 idle queue、按 id 合并、限频，并在
窗口隐藏时取消尚未开始的任务。

禁止模块新增裸 `window.focus` / `focusin` 后台刷新监听，禁止在 focus 回调中扫描插件目录、
遍历文件、查询数据库、启动多轮系统采样或等待 IPC。插件文件只在首次异步加载、用户手动
“重新扫描”，以及执行时发现命令/面板缺失后的单次统一兜底刷新中读取。

焦点所有权分成两层：

- Launcher 的 `SearchBar` 在明确召唤/返回 Launcher 时聚焦，并保留 capture 级裸字符兜底；
  焦点意外落到非编辑控件时，首字符与 Backspace/Delete 可直接写入主搜索框。
- 模块 `QxModuleSearch` 默认 `autoFocus=false`。需要以搜索开场的列表或聊天输入必须显式
  opt in，且只在 mount 时聚焦一次。用户随后点击列表、详情、按钮、表单或阅读区后，
  新区域取得焦点；`QxShell` 不注册 window `pointerup` 监听把焦点抢回搜索框。

Action 菜单关闭时只恢复打开菜单前的焦点；若 Action 已打开 Dialog/Listbox 或把焦点交给
新的编辑器，则新的焦点所有者优先。任何重聚焦都不得从真实编辑器、Workbench 表单或
IME 候选窗口抢焦点。

搜索 provider 不在 input 事件中直接运行：当前约 45ms 静默后启动，查询变化立即 abort 并
提升 sequence；渐进结果提交按静默窗口合并，避免 Zustand 外部 store 的同步通知阻塞下一次
按键。排序 Worker 保持常驻，同一时刻只执行一个任务并仅保留最新等待任务。

### 6.1 macOS 全局输入监听的线程约束

`src-tauri/src/input_events.rs` 使用 `rdev` 的 CoreGraphics event tap 收集物理按键和鼠标事件。
macOS 的 TIS/TSM 键盘布局 API（例如 `TSMGetInputSourceProperty`）只能在主 dispatch queue 调用；
它们不能从 event-tap 的 `qx-input-events` 回调线程执行。项目维护的 `vendor/rdev` 因此保留
`EventType::KeyPress/KeyRelease` 与鼠标事件，但在 macOS 监听回调中将 `Event::name` 留空。
Qx 的宏录制和指针合成只依赖物理 `Key`/鼠标事件，不得为了字符名称重新调用 TIS/TSM。

### 6.2 窗口内动作

模块动作不是全局快捷键。Feature 只发布稳定 ID 的 `QxShellAction[]`，
用 `primaryActionId` 指定主动作；QxShell 让 Bottom Bar 与未修饰 Enter 执行同一对象，
并从集合自动生成 Actions 入口。搜索槽中的 Enter 也遵循该主动作，但 IME 组合输入优先。
模块不得再写一份 bare Enter handler，也不得注册 `Cmd/Ctrl+K` 或 Esc 的进程级监听。
文本编辑器和非 Shell 输入框继续保留原生编辑语义。

Launcher 结果右键通过 `QxShell.actionMenuRequest` 发布 viewport 坐标：宿主先更新当前选择，
再将既有 Actions Popover 锚定到指针附近。它不得维护另一份右键动作集合。键盘
`Cmd/Ctrl+K` 和 Bottom Bar Actions 按钮不发布坐标，继续使用右下角宿主锚点。
结果列表的 pointer hover 只负责视觉反馈，不写 `selectedIndex`；选择只能由方向键、单击
或右键确认。双击复用当前条目的 Enter 主动作，不另写文件/文件夹打开分支。

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
8. Windows 开启 PowerToys Run 后启动 Qx → Qx 仍有托盘与首启界面；默认
   `Ctrl+Alt+Space` 可召唤窗口。
9. Windows 打开快捷键录制器，分别录入 `Alt+G`、`Alt+Shift+S` → 按下 Alt 时录制器
   不取消，完整组合键可保存；保存后从其他应用触发应进入录屏/截图圈选。

---

## 9. 版本笔记

| 版本/提交 | 内容 |
|-----------|------|
| v0.5.13 | 模块快捷键同 route 再按 dismiss；`ACTIVE_ROUTE` + `set_active_route` |
| 后续 fix | `PANEL_OPEN` / `LAST_HIDE_AT` 防 blur 竞态；隐藏走 Rust；RSS 始终 manage + lazy open；SearchBar 重聚焦 |

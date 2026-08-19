# Qx — Technical Architecture Document

## 文件管理器选择端口

文件管理器上下文由根级 `file_manager` 服务承担：`floating_panel` 在显示 Qx 前只采集轻量来源提示（Windows Explorer HWND / macOS Finder 前台状态），worker 随后解析有序选择并发布 revision 快照。内置 File Actions、只读 `file-preview` route 与插件 `context.files.*` 都依赖该快照；两个内置 surface 通过 `useFileManagerSelection` 消费同一 revision，模块启停统一归属 `file-actions`。重命名、归拢、ZIP 压缩/解压在 blocking worker 执行并再次校验 revision。根级 `file_preview` 只按当前 revision/index 提供有界元数据、目录和字节流，WebView 不获得通用本地路径读取能力；PDF/Office/压缩包渲染器按格式懒加载，PPTX 渲染器监听可用区域并动态适宽。

> 状态：Current · 适用版本：v0.6.97 · Owner：Core · 最后复核：2026-08-19
>
> 桌面启动器（Raycast 风格）| Tauri v2 + React + TypeScript + Rust
>
> 事实来源：`package.json`、`src/`、`src-tauri/src/`

---

## 1. 项目概述

Qx 是跨平台桌面启动器，定位为 Raycast / Alfred 的开源替代。当前交付平台是 **macOS 与 Windows**；Linux 仅有可移植回退，不是对等交付目标。核心功能包括：应用/文件搜索、剪贴板历史、RSS、QxAI、截图录屏、文件操作、宏录制、插件市场与外接显示器控制。

### 技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 桌面框架 | Tauri v2 | 2.x |
| 前端 | React + TypeScript | React 19 / TypeScript 5.8 |
| 构建 | Vite | 7.x |
| 状态管理 | Zustand | 5.x |
| CSS | 自定义 CSS Variables (Geist 风格) | — |
| 后端 | Rust | — |
| 音频/视频 | scrap (录屏) + gifski (GIF编码) | 最新 |
| 宏录制 | rdev (捕捉) + enigo (回放) | 最新 |
| RSS | feed-rs + reqwest + rusqlite | 最新 |
| DB | SQLite via rusqlite | — |
| 操作系统绑定 | macOS + Windows（交付）；其它目标可移植回退 | — |

---

## 2. 整体架构

```
Qx/
├── src/                          # React 前端
│   ├── App.tsx                   # 主应用壳（路由、全局键盘、窗口管理）
│   ├── App.css                   # 全局样式 + CSS 变量
│   ├── store.ts                  # 全局 Zustand store
│   ├── ThemeProvider.tsx         # light/dark/system 主题
│   ├── i18n.ts                   # 语言解析 + useT
│   ├── Launcher.tsx              # 搜索壳；idle home 经 islandHost 单写
│   ├── island/                   # QxIsland session / DockHost / recents / float
│   ├── home-island/              # 可插拔空闲 HUD + 异步 metrics 总线
│   ├── components/               # 公共 UI（QxShell、ui）
│   ├── launcher/                 # context、quick entries、actions
│   ├── modules/
│   │   ├── clipboard/  screencap/  rss/  qx-ai/
│   │   ├── macros/  weather/  documents/  file-actions/
│   │   ├── qx-tty/  p-zai/
│   │   └── settings/
│   └── plugin/                   # 插件系统
├── src-tauri/                    # Rust 后端
│   └── src/
│       ├── lib.rs                # Tauri App 启动 + 命令注册
│       ├── main.rs               # 入口
│       ├── apps.rs               # macOS 应用搜索
│       ├── clipboard.rs          # 剪贴板监听 + SQLite 持久化
│       ├── display.rs            # 系统级显示器识别、枚举与跨后端映射
│       ├── display/brightness_windows.rs # Windows WMI + Monitor Configuration 亮度适配
│       ├── media/                # Qx 核心媒体层：尺寸、H.264/MP4 与 GIF 转换
│       ├── screencap/            # 捕获编排、状态、窗口、截图、录制与历史适配
│       ├── macro_capture.rs      # 独立可停止的原生宏捕获 session（macOS event tap / Windows 双 hook）
│       ├── macro_cursor_overlay.rs # 录制期间每显示器透明点击穿透指针层
│       ├── macro_recorder.rs     # 宏录制结果、SQLite 持久化与回放 (enigo)
│       ├── diagnostics.rs        # 有界结构化诊断日志与日志路径
│       ├── runtime/health.rs     # 低频 UI event-loop stall / recovery probe
│       ├── display_monitor.rs    # 轻量 topology probe；变化时刷新捕获清单
│       ├── display_macos.m       # 内嵌 macOS DisplayServices + DDC/CI 适配
│       ├── updater.rs            # 跨平台更新检查、验证与 helper 编排
│       ├── updater/              # Windows NSIS 适配、缓存支持与 updater 测试
│       ├── settings/             # 设置读写 (JSON)
│       │   ├── mod.rs
│       │   └── ...
│       ├── rss/                  # RSS 引擎（含 icon/article image cache）
│       ├── file_manager.rs / file_preview.rs
│       ├── island_window.rs
│       └── marketplace/          # 插件市场
```

---

## 3. 前端核心架构

### 3.1 状态管理层

前端使用三个 Zustand Store：

**全局 Store (`src/store.ts`)**
```
useStore:
  - visible: boolean          // 窗口可见性
  - query: string             // 搜索框内容
  - results: AppEntry[]       // 搜索结果
  - selectedIndex: number     // 选中位置
  - tab: Tab                  // 当前视图 (launcher|clipboard|rss|...)
  - clipboardHistory: ClipboardEntry[]
```

`ClipboardEntry` 对文件类条目同时保留主项 `file_path`、有序 `file_paths` 与稳定的
`file_kind`；`folder` 不是普通文件的展示别名，必须从原生文件引用语义捕获并跨
数据库/API 边界保留。多选文件作为一个 file-list 条目保存和回写；旧库缺少
`file_paths` 时由 `file_path` 在读取边界补齐。

**插件注册中心 (`src/plugin/registry.ts`)**
```
usePluginRegistry:
  - plugins: InstalledPlugin[]       // 已安装插件
  - commands: RegisteredCommand[]    // 所有可用命令（内置 + 外部）
  - panels: Record<string, RegisteredPanel>
  - load(), findCommands(), runCommand()
```

**各模块 Store** (Zustand 独立实例):
- `useRssStore` — RSS 视图状态、订阅源/文章数据
- `useSettingsStore` — 设置偏好
- `useScreencapStore` — 录制状态
- `useMacroStore` — 宏录制状态

### 3.2 视图导航 (Tab 路由)

当前使用 `switch(tab)` 在 `renderBody()` 中条件渲染。无 React Router：

```
tab = "launcher"   → SearchBar + ResultsList
tab = "clipboard"  → ClipboardPanel
tab = "screencap"  → ScreenRecorder
tab = "rss"        → RssReader (→ feeds/articles/detail 子视图)
tab = "macros"     → MacroRecorder
tab = "settings"   → SettingsPanel
tab = "plugin:*"   → PluginPanelViewport
```

**导航入口**:
1. **Launcher 搜索**: 用户输入关键字 → `findCommands()` 匹配内置/插件命令 → Enter → dispatch `qx:navigate` DOM 事件 → `setTab()`
2. **Tauri 后端事件**: Rust 端可 emit `navigate` 事件 → 前端 listen 切换
3. **快捷键**: ⌘, → 设置页面

### 3.3 插件系统（内置 + 外部）

**内置模块（静态注册）**：
- `src/plugin/builtin.ts` 的 `BUILTIN_MODULES` 生成 Settings/Launcher 消费的合成
  `InstalledPlugin` 条目；`src/modules/catalog.ts` 管成熟度和可禁用性，
  `src/modules/builtinIcons.ts` 管图标，`App.tsx` composition root 负责 lazy view 与 route。
- `src/modules/` 不是自动扫描目录。新增内置模块必须完成上述登记，并同步搜索/主页入口、
  快捷键 route、i18n 与 `docs/module-port-inventory.md`；不能只创建 React 文件。
- 内置模块通过 React 组件渲染，不创建插件 iframe；启停统一读取 `builtin_modules`。

**外部插件（目录发现）** (`marketplace::list_installed_plugins` + `plugin/registry.ts`)：
- 安装器先校验 `.qx-plugin`，再解包到 `~/.qx/plugins/<id>/`。Rust 在 blocking worker
  中枚举直接子目录并读取 `manifest.json`；目录 ID 必须合法且与 Manifest ID 一致。
- 启动加载一次已安装快照；Settings 的 Rescan 才触发完整 refresh。没有持续目录 watcher，
  也没有允许执行的插件 ID 白名单。
- Registry 先保留全部发现项供 Settings 管理，再按 enabled、`platforms`、
  `min_app_version` 与依赖拓扑选择 runtime；不兼容插件不得创建 iframe、command、panel、
  后台任务或全局快捷键。仅提供 surface 的插件可 Manifest-only 懒加载。
- 可执行插件运行在独立 sandboxed iframe，通过 `postMessage` RPC 请求宿主能力。权限不是
  发现机制：`manifest.permissions` 与精确 `invoke:<command>` 在 RPC 边界再次做能力白名单
  校验，插件不直接继承主 WebView 的 Tauri capability。

### 3.4 主题系统

**实现**:
- `ThemeProvider.tsx` — `light | dark | system`；system 跟 `prefers-color-scheme`
- 同步 `data-theme` + `.dark` 到 `<html>`
- token 在 `src/styles/base.css`（含 `--qx-system-island-*` 灵动岛）

### 3.5 i18n 与显示语言

- `src/i18n.ts`：`general.language` = `system | en | zh-CN`
- system：仅 OS 简体中文 → `zh-CN`，否则 `en`
- 快捷键符号不翻译；文案 `useT` + zh 表

### 3.6 Home Island（灵动岛）

- 包：`src/home-island/`（注册表 + resolve + 设置 UI + data bus）
- **可扩展**：新模式只 register，不改 Launcher / Appearance 分支
- **非阻塞数据**：`data/bus.ts` 兴趣采样；UI 只读 `useSyncExternalStore`；Rust 命令 `spawn_blocking`
- 详细规范：[UI_SPEC.md](../UI_SPEC.md) Home Island 节、[frontend-architecture.md](./frontend-architecture.md)

### 3.7 CSS 结构

- CSS Variables + 全局 `qx-*` 类名；样式在 `src/styles/`
- Shell chrome：`--qx-shell-chrome-x`、`--qx-topbar-h`、`--qx-bottom-bar-h`（上下栏厚度接近）

### 3.8 Storage 管理

- `src-tauri/src/storage.rs` 维护唯一缓存目标注册表，`qx_storage_overview` 与逐项/全部缓存清理共用同一批目标，避免“界面统计到但清理遗漏”或平台路径漂移。
- 可重建缓存、历史/离线记录、生成文件、数据库、插件包、`plugin-data` 与设置分别统计；
  只有注册为可重建缓存的目标可走 `qx_storage_clear_cache_target`。插件可通过 manifest
  登记精确 persist key，宿主把其占用从受保护 Plugin Data 桶转入 Cache 桶，避免重复统计。
- 前端 `StorageSettings` 位于 Settings → System，只消费后端 `cache_targets` 模型并按模块显示，不拼接平台路径，也不重复渲染物理存储桶，插件持久数据与已保存媒体不会被标成缓存。

---

## 4. 模块详解

### 4.1 Launcher / 应用搜索

- 输入搜索 → 非空 query 约 45ms debounce → `doSearch()`（空 query 立即走首页缓存）
- 同时搜索: 插件命令 + 本地应用 (`search_apps`) + 可选文件/剪贴板/模块表面
- 结果排序: `rankSearchResults`（匹配档位优先；同档按 30 天搜索点击量 `clickCount` 加权；文件同档再按类型偏置：PDF/Word/Excel 等办公文档优于源码/日志）
- 点击落库: `record_search_click` → `history.db` 表 `search_click_events`（滚动 30 天）；`get_search_click_stats` 后台异步召回，不阻塞主搜索
- 空闲底部 HUD：`useHomeIslandContribution` 写 `islandHost` home session（`src/home-island` + `src/island`）
- 键盘: ↑↓ 导航, Enter 打开 / 切换 tab, Esc 级联（先关岛最近浏览）/ hide

### 4.2 剪贴板历史

- Rust 端: `clipboard.rs` 负责监听、数据库和存储约束；`clipboard/native.rs` 隔离
  NSPasteboard / Windows `CF_HDROP` 读取，`capture.rs` 负责“成功后提交序号”的重试游标，
  `file_list.rs` 负责跨平台文件列表不变量；`history.rs`、`editing.rs`、`media.rs` 分别承载
  历史命令、文本编辑和文件媒体/原生回写
- SQLite 持久化: `clipboard.db`
- 支持: 分类(link/code/long)、搜索、日期筛选、固定、计数、文本草稿编辑与另存
- 交互: 单击 / 键盘选中只排队恢复条目，**主窗口失焦隐藏后再写入系统剪贴板**（避免 `record_clipboard_copy` 改 timestamp 导致列表在窗口仍打开时跳动）；显式 ⌘C 立即复制；双击文本进入草稿编辑；Enter 粘贴；⌘P 固定；⌘⌫ 删除

### 4.3 RSS 阅读器

- Rust 引擎: `src-tauri/src/rss/` (feed-rs 解析 + reqwest 网络 + rusqlite 持久化)
- 本地缓存: `rss.db` (订阅源 + 文章)
- 离线缓存: 可选开关
- 三视图: Feeds 列表 → Articles 列表 (按 today/yesterday/earlier 分组) → Article 详情
- 键盘走 Shell 协议：↑↓ 列表，Enter 阅读层级，Esc 级联；不注册 `F/J/K/R/S/U/O/L` 裸键。修饰键：`⌘/Ctrl+R` 刷新当前订阅，`⌘/Ctrl+D` 星标，`⌘/Ctrl+S` 下载 HTML，`⌘/Ctrl+Shift+R` 全部刷新
- Settings → Reader View 图片模式：全宽 / 固定大小 / 小图；小图点击 `QxMediaViewer`
- 支持 OPML 导入/导出
- 单 Feed 刷新执行一条真实 HTTP 流程并用 activity 表达不可测的请求阶段；刷新全部从数据库读取完整订阅集合逐个抓取，通过 `rss:refresh-progress` 发布当前 Feed、completed/total 和失败数，Bottom Island 不使用固定模拟百分比。
- RSS 后台调度属于 Rust 领域服务：默认每天刷新，Settings 可选择 6 / 12 / 24 小时或关闭。

- Launcher Home 的 RSS 卡片不加载完整 RSS 面板。宿主通过 `rss_dashboard_snapshot(limit)` 获取
未读计数和最新文章的轻量投影，并在 `src/home-dashboard/cache.ts` 中保留版本化缓存；首帧先
展示缓存，刷新失败不清空可用内容。社区插件可以在 `manifest.surfaceProviders[]` 中声明
`rss.unread-latest`，由同一宿主适配器复用该快照；Provider 只提供本地化标题/说明和关联入口，
不注入 Home DOM/CSS，也不会因 Home 展示启动插件 iframe。
- 应用运行时每 15 分钟检查持久化的 `rss_meta.last_refresh_all_at`，所选周期到期才复用全量刷新流程。手动全量刷新同样更新时间戳；
  单 Feed、手动全量和后台全量共享异步刷新锁，数据库阶段通过 blocking pool 执行，任务不依赖
  React 面板挂载且不改变窗口可见性或焦点。

### 4.5 截图与录屏

- Rust: `screencap/` 编排圈选/截图/录制；画面与 GIF 走根级 `media/`（OpenH264 / gifski）
- 截图 PNG、录屏 MP4/MOV，可按需转 GIF；历史分截图/录屏两组，列表与图库键盘走 `useQxListSelection`
- 捕获控制条是独立受保护工具栏，不占用 Bottom Island

### 4.6 宏录制

- Rust: 独立 `MacroCaptureSession`（macOS event tap / Windows 双低级 hook）+ enigo (回放)
- 记录: 鼠标移动/点击、键盘按键
- 保存/删除；回放是可延迟、可停止的后台单实例任务；点击步骤保留坐标，未知步骤/按键不会静默跳过
- 内置示范宏通过受限的 `launch_application` / `text_input` 步骤打开 Google Chrome、定位地址栏并搜索 `hello`；macOS 使用 `open -a`，Windows 只解析标准 Chrome 安装目录
- 列表复用 Workbench 的 `useQxListSelection`、`useQxMasterDetail`、`QxResizableSplit`
  和 `QxActionSections`；Enter 进入详情/播放，↑↓ 选择，步骤详情高亮当前步骤
- `macro:playback` 事件驱动主从详情和灵动岛的真实完成度/当前步骤；播放 worker 在退出时
  与录制 worker 一样通过 cancel + join 清理
- `macro:recording` 事件以约 16ms 节流推送当前坐标；录制期间为每个显示器创建可复用的
  透明点击穿透指针层，窗口/UI 变化只经过主线程端口，原生 hook 不触碰布局或数据库

### 4.7 设置

- 分组导航（General / Search / Shortcuts / Appearance / Extensions / AI Agent / OCR / RSS / Permissions / Storage / Advanced / About），不是固定 6 个标签
- Rust 后端: `~/.qx/settings.json`
- 快捷键自定义: 键盘录制绑定 UI
- 打开/关闭只走 `openSettings` / `closeSettings`（见 `docs/settings-panel.md`）

### 4.8 插件市场

- GitHub 仓库 `mcxen/qx-plugins` 作为市场源
- zip 包发布机制
- 签名验证 (`sign_plugin`)
- 权限系统
- 前端插件库：`PluginManager.tsx`
  - `Installed`：本地插件/内置模块搜索，`All / Built-in / External / Enabled / Disabled` 筛选，启用/禁用、卸载、preferences、权限详情。
  - `Browse`：远程市场搜索，左侧列表 + 右侧详情，展示版本说明、历史版本、作者、大小、权限、最低 Qx 版本、更新时间、SHA256，并提供安装状态反馈。最低版本不满足时 UI 禁用所有安装来源并引导到 About；Rust 安装边界再次拒绝不兼容包。
  - 导入入口：本地 `.zip` / `.qx-plugin`、GitHub repo/release/archive URL、Raycast extension tree URL。
  - 后续优化：组件拆分、键盘列表导航、大列表虚拟化。

---

## 5. Rust 后端架构

### 5.1 Tauri 命令注册

`lib.rs` 的 `generate_handler!` 注册命令以 [`ipc-catalogue.md`](./ipc-catalogue.md) 文末基线为准（当前约 196 个）。领域分组示例:

```
apps::* (search_apps)
clipboard::* (get/clear/delete/toggle/record)
rss::* (list/add/update/remove/refresh/mark/toggle/import/export)
settings::* (get/update/reset/import/export)
screencap::* (start/stop/save/list/delete/pin)
macro_recorder::* (start/stop/save/list/delete/play)
marketplace::* (fetch/download/install/auto-update/uninstall/list/sign)
updater::* (check/download_and_install/helper_replace)
```

 Tauri capability 是窗口级 IPC 边界。静态主窗口与动态创建的 `recording-controls`、`region-picker` 都必须在 `src-tauri/capabilities/default.json` 中显式登记；圈选期间按显示器动态创建的 `region-picker-shade-*` 仅渲染鼠标穿透遮罩，不调用 IPC，因此不扩大 capability。缺失的次级窗口不能调用显示器枚举、捕获确认或事件监听。`npm run check:architecture` 会校验交互捕获 surface，避免窗口实现与 capability 配置再次漂移。

### 5.2 数据持久化

| 数据库 | 路径 | 用途 |
|--------|------|------|
| `rss.db` | `~/Library/Application Support/qx/` | 订阅源 & 文章 |
| `clipboard.db` | 同上 | 剪贴板历史 |
| `screencap.db` | 同上 | 录制历史 |
| `settings.json` | `~/.qx/` | 用户设置 |

### 5.3 后台服务

- **剪贴板监听**: `clipboard::start_listener()` — 始终 `manage` ClipboardDb；轮询系统剪贴板
- **RSS**: `rss::init` — 始终 `manage` RssDb（`Option` + lazy open）；见 [shell-and-shortcuts.md](./shell-and-shortcuts.md) §5
- **Icon 预加载**: `apps::preload_icons()` — 后台生成并缓存最长边为 128px 的应用图标；macOS 通过 AppKit / sips 读取 `.app`，Windows 通过 Shell 解析开始菜单 `.lnk` 的 `HICON` 并转为 PNG；RSS 启动任务把远程 favicon 压为 64px 本地缓存
- **全局快捷键**: `settings::register_shortcuts()` — **toggle** 开/关主窗口；细节见 [shell-and-shortcuts.md](./shell-and-shortcuts.md)

---

## 6. 键盘导航

模块键盘统一走 QxShell：`useQxListSelection` / `useQxMasterDetail` + `useEscBack`。
Esc 先关岛最近浏览，再 inner → query → leave。Actions 菜单是 `⌘/Ctrl+K`。
内置 RSS **不**注册 `F/J/K/R/S/U/O/L` 裸键。截图录屏历史用标准列表/图库导航，
不是“无键盘”。细节以 `UI_SPEC.md` 与 `docs/module-port-inventory.md` 为准。

---

## 7. 性能与优化

### 7.1 已知问题

1. **Alt+Space 首次唤起慢**: `ActivationPolicy::Accessory` 已解决（移除 Dock 图标后 macOS 不再暂停应用）
2. **fd 耗尽**: 上次重建时出现 system fd 表耗尽，疑似某个库或进程泄漏文件句柄
3. **SQLite 并发**: 后端多个模块独立打开 SQLite 文件，无连接池

### 7.2 优化方向

**前端**:
- [x] 搜索 debounce（非空约 45ms；空 query 走首页缓存）
- [x] 图标缓存（应用：sips + `~/.qx/icons/`，最长边 128px；RSS：`cache/rss-icons`，最长边 64px + 30 天复用）
- [ ] 虚拟列表 (react-window / tanstack-virtual) — 剪贴板、文章列表大数量时
- [ ] 模块懒加载 (`React.lazy` + Suspense)
- [ ] 大型模块 (PluginManager 935 行) 拆分为子组件

**后端**:
- [ ] 单 SQLite 连接池而非多独立文件
- [ ] 剪贴板使用 FSEvents / kqueue 监听而非轮询
- [ ] RSS 后台定时刷新 (可选)
- [ ] 日志系统

**打包**:
- [x] GitHub Actions release workflow
- [ ] 代码签名 (macOS notarization)
- [x] 自动更新（macOS bundle replacement / Windows NSIS helper + per-target GitHub Release manifest）
- [ ] 增量更新

### 7.3 安全

- CSP: `null`（无限制 — 需配置）
- 插件沙箱: iframe sandbox (`allow-scripts`)
- 插件签名: ed25519 签名验证
- 权限声明: 插件 manifest 声明所需权限
- AI 能力: 插件通过 `context.ai` 使用 QxAI provider/model 目录、模型选择和文本/图片多模态聊天；自定义 OpenAI-compatible provider 的模型优先通过 `/models` API 获取，API key 由 Qx 后端代管，不暴露给插件。Settings -> AI Agent 提供全局 Agent 模式、默认模型、工具、bash、MCP 预留、后台任务和 rg/grep 搜索开关；bash 与 grep 后端调用会读取该配置进行门控。Agent Runtime 的 ReAct、MCP、memory、soul、background task 设计见 `docs/ai-agent-runtime.md`。

---

## 8. 改进路线图

### P0 - 必须
1. **RSS 功能: 添加默认订阅** — 首次使用无引导，用户不知道如何添加
2. **ScreenRecorder 键盘** — 当前完全不能用键盘操作

### P1 - 重要
1. **Settings 标签页键盘切换** — 当前只能鼠标点或搜索过滤
2. **剪切板类型筛选键盘快捷** — Ctrl+1~5 切换
3. **大文件拆分** — App.tsx (775行), PluginManager.tsx (935行), ClipboardPanel.tsx (379行)
4. **模块懒加载** — 首屏加载约 308KB JS bundle，可拆为异步 chunk

### P2 - 增强
1. **虚拟列表** — 剪贴板历史 >500 条时性能下降
2. **RSS 定时后台刷新** — 当前需手动 R/R
3. **自动更新体验** — 展示 helper 安装失败详情、支持更多平台
4. **国际化的 Geist 字体** — 中日韩字体回退
5. **Windows/Linux 适配测试**

### P3 - 远期
1. **插件库高级能力** — 插件详情截图/README、分页或虚拟列表、评分/来源信任展示
2. **OCR 模块**
3. **AI 能力扩展** — 将 QxAI 接入更多内置模块和插件工作流
4. **Store 统一** — 整合多个 Zustand store 为单一状态树 vs 保持模块化

---

## 9. 开发指南

### 开发环境

```bash
# 前端 dev
npm run dev                 # Vite dev server on :1420
# Tauri dev（前端 + 后端热重载）
npm run tauri dev

# TypeScript 检查
npx tsc --noEmit

# Rust 检查
cargo check

# 构建 release
npm run tauri build -- --bundles app
```

### 编码约定

- 类名: `qx-*` 前缀
- CSS 变量: `--qx-*`
- 文件名: PascalCase 组件 + kebab-case 工具
- 状态管理: 全局用 `useStore`（store.ts），模块专用独立 store

---

## 10. 附录: 关键文件

行数会漂移，以仓库为准。入口：

| 文件 | 说明 |
|------|------|
| `src/App.tsx` | 主应用壳：tab、搜索编排、host Esc、最近浏览记录 |
| `src/island/` | Docked/floating 岛、recents、recentMotion |
| `src/modules/settings/plugins/PluginManager.tsx` | 插件库 Installed / Browse |
| `src/modules/clipboard/ClipboardPanel.tsx` | 剪贴板 |
| `src/modules/file-actions/` | File Actions / QxPreview |
| `src/modules/screencap/ScreenRecorder.tsx` | 截图录屏工作流 |
| `src/modules/rss/` | RSS 订阅/文章/阅读 |
| `src-tauri/src/lib.rs` | Tauri 装配 + `generate_handler!`（命令表见 ipc-catalogue） |
| `src-tauri/src/file_manager.rs` | 文件选择快照与写操作 |
| `src-tauri/src/rss/` | RSS SQLite、抓取、图片缓存 |

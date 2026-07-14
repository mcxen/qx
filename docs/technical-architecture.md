# Qx — Technical Architecture Document

> 状态：Current · 适用版本：v0.5.12 · Owner：Core · 最后复核：2026-07-14
>
> 桌面启动器（Raycast 风格）| Tauri v2 + React + TypeScript + Rust
>
> 事实来源：`package.json`、`src/`、`src-tauri/src/`

---

## 1. 项目概述

Qx 是一个以 macOS 为当前交付平台的桌面启动器，定位为 Raycast / Alfred 的开源替代。核心功能包括：应用搜索与启动、剪贴板历史、RSS 阅读器、AI、屏幕录制、宏录制、插件市场以及外接显示器控制。Windows/Linux 仍是方向性规划，不代表当前已具备可交付兼容性。

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
| 操作系统绑定 | macOS (优先), Windows/Linux (规划) | — |

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
│   ├── Launcher.tsx              # 搜索壳；idle island → home-island
│   ├── home-island/              # 可插拔灵动岛 + 异步 metrics 总线
│   ├── components/               # 公共 UI（QxShell、Matrix、ui）
│   ├── launcher/                 # context、quick entries、actions
│   ├── modules/
│   │   ├── clipboard/  screencap/  rss/  qx-ai/
│   │   ├── macros/  weather/  documents/  v2ex/
│   │   └── settings/
│   └── plugin/                   # 插件系统
├── src-tauri/                    # Rust 后端
│   └── src/
│       ├── lib.rs                # Tauri App 启动 + 命令注册
│       ├── main.rs               # 入口
│       ├── apps.rs               # macOS 应用搜索
│       ├── clipboard.rs          # 剪贴板监听 + SQLite 持久化
│       ├── screencap.rs          # 屏幕录制 (scrap + gifski)
│       ├── macro_recorder.rs     # 宏捕捉与回放 (rdev + enigo)
│       ├── diagnostics.rs        # 诊断日志与日志路径
│       ├── display_monitor.rs    # 显示器插拔监听
│       ├── external_displays.rs  # DDC 驱动、显示器枚举与控制
│       ├── updater.rs            # 更新检查与下载安装
│       ├── settings/             # 设置读写 (JSON)
│       │   ├── mod.rs
│       │   └── ...
│       ├── rss/                  # RSS 引擎
│       │   ├── mod.rs
│       │   ├── types.rs
│       │   ├── storage.rs        # SQLite CRUD
│       │   └── fetcher.rs        # 网络抓取 + feed-rs 解析
│       └── marketplace/          # 插件市场
│           └── mod.rs
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

**内置模块注册** (`registerAllBuiltins()`):
- 启动时调用，将 6 个内置模块的 command + panel 信息写入 `usePluginRegistry`
- 每个内置 command 的 `run()` 调用 `navigateToTab(mod.id)`
- 内置模块仍通过 React 组件渲染（非 iframe）

**外部插件** (`plugin/runtime.ts`):
- 从 `~/.qx/plugins/` 加载 zip 包
- 每个插件运行在独立的 sandboxed iframe 中
- 通过 `postMessage` RPC 与主进程通信
- 支持 Tauri invoke、storage、toast 等 API

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

---

## 4. 模块详解

### 4.1 Launcher / 应用搜索

- 输入搜索 → 100ms debounce → `doSearch()`
- 同时搜索: 插件命令 + 本地应用 (`search_apps`)
- 空闲底部 HUD：`resolveHomeIsland`（`src/home-island`）
- 键盘: ↑↓ 导航, Enter 打开 / 切换 tab, Esc 级联 / hide

### 4.2 剪贴板历史

- Rust 端: `clipboard.rs` — 基于 `tauri-plugin-clipboard-manager` 轮询
- SQLite 持久化: `clipboard.db`
- 支持: 分类(link/code/long)、搜索、固定、计数
- 键盘: ↑↓ 导航, Enter 复制, ⌘P 固定, ⌘⌫ 删除, 类型 Filter 无键盘

### 4.3 RSS 阅读器

- Rust 引擎: `src-tauri/src/rss/` (feed-rs 解析 + reqwest 网络 + rusqlite 持久化)
- 本地缓存: `rss.db` (订阅源 + 文章)
- 离线缓存: 可选开关
- 三视图: Feeds 列表 → Articles 列表 (按 today/yesterday/earlier 分组) → Article 详情
- 键盘全覆盖: ↑↓/j/k 导航, S 星标, U 读/未读, O 浏览器打开, R 刷新, N 添加, E 编辑
- 支持 OPML 导入/导出

### 4.5 屏幕录制 GIF

- Rust: scrap (画面捕捉) + gifski (GIF 编码)
- 支持: 区域选择、文件大小预估、历史列表
- **缺失: 键盘处理** — 无 ↑↓ 导航、Enter/删除快捷键

### 4.6 宏录制

- Rust: rdev (事件捕捉) + enigo (回放)
- 记录: 鼠标移动/点击、键盘按键
- 保存/回放/删除
- 键盘: 只有 Esc/Enter (保存对话框), **缺失 ↑↓ 列表导航**

### 4.7 设置

- 6 个标签页: General, Extensions, Shortcuts, Appearance, RSS, Advanced
- Rust 后端: JSON 文件 `~/.config/qx/settings.json`
- 快捷键自定义: 键盘录制绑定 UI
- **缺失: 标签页 ↑↓ 键盘切换**

### 4.8 插件市场

- GitHub 仓库 `mcxen/qx-plugins` 作为市场源
- zip 包发布机制
- 签名验证 (`sign_plugin`)
- 权限系统
- 前端插件库：`PluginManager.tsx`
  - `Installed`：本地插件/内置模块搜索，`All / Built-in / External / Enabled / Disabled` 筛选，启用/禁用、卸载、preferences、权限详情。
  - `Browse`：远程市场搜索，左侧列表 + 右侧详情，展示版本、作者、大小、权限、最低 Qx 版本、更新时间、SHA256，并提供安装状态反馈。
  - 导入入口：本地 `.zip` / `.qx-plugin`、GitHub repo/release/archive URL、Raycast extension tree URL。
  - 后续优化：组件拆分、键盘列表导航、大列表虚拟化。

---

## 5. Rust 后端架构

### 5.1 Tauri 命令注册

`lib.rs` 的 `invoke_handler!` 注册 ~45 个 Tauri 命令。命令按模块分组:

```
apps::* (search_apps)
clipboard::* (get/clear/delete/toggle/record)
rss::* (list/add/update/remove/refresh/mark/toggle/import/export)
settings::* (get/update/reset/import/export)
screencap::* (start/stop/save/list/delete)
macro_recorder::* (start/stop/save/list/delete/play)
marketplace::* (fetch/download/install/uninstall/list/sign)
updater::* (check/download_and_install/helper_replace)
```

### 5.2 数据持久化

| 数据库 | 路径 | 用途 |
|--------|------|------|
| `rss.db` | `~/Library/Application Support/qx/` | 订阅源 & 文章 |
| `clipboard.db` | 同上 | 剪贴板历史 |
| `screencap.db` | 同上 | 录制历史 |
| `settings.json` | `~/.config/qx/` | 用户设置 |

### 5.3 后台服务

- **剪贴板监听**: `clipboard::start_listener()` — 始终 `manage` ClipboardDb；轮询系统剪贴板
- **RSS**: `rss::init` — 始终 `manage` RssDb（`Option` + lazy open）；见 [shell-and-shortcuts.md](./shell-and-shortcuts.md) §5
- **Icon 预加载**: `apps::preload_icons()` — 后台 sips 转换
- **全局快捷键**: `settings::register_shortcuts()` — **toggle** 开/关主窗口；细节见 [shell-and-shortcuts.md](./shell-and-shortcuts.md)

---

## 6. 键盘导航审计

### 当前覆盖

| Tab | 键盘操作 | 缺失快捷键 |
|-----|---------|-----------|
| Launcher | Type, ↑↓, Enter, Esc, ⌘, | — |
| Clipboard | ↑↓, Enter, ⌘P, ⌘⌫, Esc | 类型过滤无快捷键 |
| RSS Feeds | ↑↓, Enter, R, Shift+R, N, E, Esc | — |
| RSS Articles | ↑↓/j/k, Enter, S, U, O, R, Esc | — |
| RSS Detail | j/k, S, U, O, Esc | — |
| ScreenRecorder | **无** | ↑↓, Enter, ⌫, Esc |
| MacroRecorder | Esc, Enter (保存时) | ↑↓ 列表导航 |
| Settings | Esc, 搜索过滤 | ↑↓ 切换标签页 |
| Plugin Mgr | 搜索过滤 | ↑↓ 列表导航 |

### 推荐改进

1. **ScreenRecorder**: 添加 `handleKeyDown` — ↑↓ 历史导航, Enter 选中, ⌫ 删除, Esc 关闭
2. **MacroRecorder**: 添加 ↑↓ 列表导航, Enter 回放, ⌫ 删除
3. **Settings**: Ctrl+Tab / Ctrl+数字 切换标签页
4. **Clipboard**: Ctrl+数字 快速切换类型过滤
5. **通用**: 所有模块页面增加 ⌘K 唤起命令面板

---

## 7. 性能与优化

### 7.1 已知问题

1. **Alt+Space 首次唤起慢**: `ActivationPolicy::Accessory` 已解决（移除 Dock 图标后 macOS 不再暂停应用）
2. **fd 耗尽**: 上次重建时出现 system fd 表耗尽，疑似某个库或进程泄漏文件句柄
3. **SQLite 并发**: 后端多个模块独立打开 SQLite 文件，无连接池

### 7.2 优化方向

**前端**:
- [x] 搜索 debounce (100ms)
- [x] 图标缓存 (sips + `~/.qx/icons/`)
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
- [x] 自动更新（自定义 macOS helper + GitHub Release manifest + quarantine xattr cleanup）
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
3. **MacroRecorder 列表键盘** — 不能选择已有的宏

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

## 10. 附录: 关键文件清单

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/App.tsx` | 775 | 主应用壳，包含渲染逻辑、键盘处理、窗口管理 |
| `src/modules/settings/PluginManager.tsx` | 935 | 插件库 UI，Installed/Browse 已可用，后续需要拆分 |
| `src/modules/clipboard/ClipboardPanel.tsx` | 379 | 剪贴板面板 + 工具函数混在一起 |
| `src/modules/macros/MacroRecorder.tsx` | 304 | 宏录制面板，需要键盘增强 |
| `src/modules/screencap/ScreenRecorder.tsx` | 402 | 屏幕录制，缺失键盘 |
| `src/modules/rss/RssPanel.tsx` | 293 | RSS 订阅列表 |
| `src/modules/rss/ArticleList.tsx` | 321 | RSS 文章列表 |
| `src/modules/rss/store.ts` | 321 | RSS store + 辅助函数 |
| `src/modules/rss/ArticleDetail.tsx` | 299 | RSS 文章详情 |
| `src-tauri/src/lib.rs` | 175 | Tauri 启动 + 45 个命令注册 |
| `src-tauri/src/rss/storage.rs` | 266 | RSS SQLite CRUD |
| `src-tauri/src/rss/fetcher.rs` | 202 | RSS 网络抓取 + 解析 |

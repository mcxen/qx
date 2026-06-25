# Qx — Technical Architecture Document

> 桌面启动器（Raycast 风格）| Tauri v2 + React + TypeScript + Rust  
> 项目路径: `~/Documents/OpenSpring/Qx/`  
> 作者: mcxen

---

## 1. 项目概述

Qx 是一个跨平台桌面启动器，定位为 Raycast / Alfred 的开源替代。核心功能包括：应用搜索与启动、剪贴板历史、RSS 阅读器、屏幕录制 (GIF)、宏录制播放、插件市场。

### 技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 桌面框架 | Tauri v2 | 2.x |
| 前端 | React + TypeScript | 18+ |
| 构建 | Vite | 7.x |
| 状态管理 | Zustand | 4.x |
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
│   ├── App.css                   # 全局样式 + CSS 变量 (Geist 主题)
│   ├── store.ts                  # 全局 Zustand store
│   ├── ThemeProvider.tsx         # Geist 主题上下文
│   ├── SearchBar.tsx             # Launcher 搜索栏
│   ├── ResultsList.tsx           # Launcher 搜索结果列表
│   ├── components/               # 公共 UI 组件
│   │   └── ui.tsx               # Kbd, LinkButton 等
│   ├── modules/
│   │   ├── clipboard/            # 剪贴板历史
│   │   ├── scrrencap/            # 屏幕录制 (GIF)
│   │   ├── rss/                  # RSS 阅读器
│   │   ├── macros/               # 宏录制与回放
│   │   └── settings/             # 设置界面
│   └── plugin/                   # 插件系统
│       ├── types.ts              # 插件类型定义
│       ├── registry.ts           # 插件注册中心 (Zustand)
│       ├── builtin.ts            # 内置模块注册
│       ├── runtime.ts            # 插件沙箱运行
│       └── PluginHost.tsx        # 插件 iframe 容器
├── src-tauri/                    # Rust 后端
│   └── src/
│       ├── lib.rs                # Tauri App 启动 + 命令注册
│       ├── main.rs               # 入口
│       ├── apps.rs               # macOS 应用搜索
│       ├── clipboard.rs          # 剪贴板监听 + SQLite 持久化
│       ├── screencap.rs          # 屏幕录制 (scrap + gifski)
│       ├── macro_recorder.rs     # 宏捕捉与回放 (rdev + enigo)
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

### 3.4 主题系统 (Geist)

**实现**:
- `ThemeProvider.tsx` — React Context, `data-theme` 属性在 `<html>` 上
- `App.css` — 两组 CSS 变量 (`[data-theme="light"]` 和 `[data-theme="dark"]`)
- 引用 `Geist Variable` 字体

**变量体系**:
```
--qx-bg-100/200/300         背景层级
--qx-border-1/2/3            边框层级
--qx-text-primary/secondary/tertiary  文字层级
--qx-accent / --qx-accent-soft        主题色
--qx-danger / --qx-warning / --qx-success  语义色
--qx-overlay-1/2              悬停/选中覆盖层
--qx-canvas-opacity           窗口透明度
--qx-radius                  圆角
--qx-font-size              字号
```

### 3.5 CSS 结构

- 使用 CSS Variables（自定义属性），无 Tailwind/TailwindCSS
- 类名命名约定: `qx-*` (如 `qx-list-row`, `qx-plugin-toolbar`, `qx-raycast`)
- 无 CSS-in-JS，所有样式在 `App.css` 和模块级 CSS（若有）

---

## 4. 模块详解

### 4.1 Launcher / 应用搜索

- 输入搜索 → 100ms debounce → `doSearch()`
- 同时搜索: 插件命令 + macOS 本地应用 (via `search_apps` Rust 命令)
- plist 解析 → icon 缓存 (`~/.qx/icons/`, sips 转换 .icns → PNG)
- 键盘: ↑↓ 导航, Enter 打开应用/切换 tab

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
- 前端: partial (`PluginManager.tsx` 604 行，需拆分)

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
```

### 5.2 数据持久化

| 数据库 | 路径 | 用途 |
|--------|------|------|
| `rss.db` | `~/Library/Application Support/qx/` | 订阅源 & 文章 |
| `clipboard.db` | 同上 | 剪贴板历史 |
| `screencap.db` | 同上 | 录制历史 |
| `settings.json` | `~/.config/qx/` | 用户设置 |

### 5.3 后台服务

- **剪贴板监听**: `clipboard::start_listener()` — Tauri 事件驱动
- **Icon 预加载**: `apps::preload_icons()` — 后台 sips 转换
- **全局快捷键**: `settings::register_shortcuts()` — `tauri-plugin-global-shortcut`

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
- [ ] 大型模块 (PluginManager 604 行) 拆分为子组件

**后端**:
- [ ] 单 SQLite 连接池而非多独立文件
- [ ] 剪贴板使用 FSEvents / kqueue 监听而非轮询
- [ ] RSS 后台定时刷新 (可选)
- [ ] 日志系统

**打包**:
- [x] GitHub Actions release workflow
- [ ] 代码签名 (macOS notarization)
- [ ] 自动更新 (`tauri-plugin-updater`)
- [ ] 增量更新

### 7.3 安全

- CSP: `null`（无限制 — 需配置）
- 插件沙箱: iframe sandbox (`allow-scripts`)
- 插件签名: ed25519 签名验证
- 权限声明: 插件 manifest 声明所需权限

---

## 8. 改进路线图

### P0 - 必须
1. **RSS 功能: 添加默认订阅** — 首次使用无引导，用户不知道如何添加
2. **ScreenRecorder 键盘** — 当前完全不能用键盘操作
3. **MacroRecorder 列表键盘** — 不能选择已有的宏

### P1 - 重要
1. **Settings 标签页键盘切换** — 当前只能鼠标点或搜索过滤
2. **剪切板类型筛选键盘快捷** — Ctrl+1~5 切换
3. **大文件拆分** — App.tsx (695行), PluginManager.tsx (604行), ClipboardPanel.tsx (372行)
4. **模块懒加载** — 首屏加载约 308KB JS bundle，可拆为异步 chunk

### P2 - 增强
1. **虚拟列表** — 剪贴板历史 >500 条时性能下降
2. **RSS 定时后台刷新** — 当前需手动 R/R
3. **自动更新** — `tauri-plugin-updater` 集成
4. **国际化的 Geist 字体** — 中日韩字体回退
5. **Windows/Linux 适配测试**

### P3 - 远期
1. **插件市场完整前端** — 浏览、安装、管理 UI
2. **OCR 模块**
3. **AI 模块** — 基于 LLM 的智能搜索
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
| `src/App.tsx` | 695 | 主应用壳，包含渲染逻辑、键盘处理、窗口管理 |
| `src/modules/settings/PluginManager.tsx` | 604 | 插件管理 UI，需要拆分 |
| `src/modules/clipboard/ClipboardPanel.tsx` | 372 | 剪贴板面板 + 工具函数混在一起 |
| `src/modules/macros/MacroRecorder.tsx` | 346 | 宏录制面板，需要键盘增强 |
| `src/modules/screencap/ScreenRecorder.tsx` | 325 | 屏幕录制，缺失键盘 |
| `src/modules/rss/RssPanel.tsx` | 306 | RSS 订阅列表 |
| `src/modules/rss/ArticleList.tsx` | 321 | RSS 文章列表 |
| `src/modules/rss/store.ts` | 321 | RSS store + 辅助函数 |
| `src/modules/rss/ArticleDetail.tsx` | 299 | RSS 文章详情 |
| `src-tauri/src/lib.rs` | 175 | Tauri 启动 + 45 个命令注册 |
| `src-tauri/src/rss/storage.rs` | 266 | RSS SQLite CRUD |
| `src-tauri/src/rss/fetcher.rs` | 202 | RSS 网络抓取 + 解析 |

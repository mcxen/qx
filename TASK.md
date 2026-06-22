# Qx — 跨平台桌面启动器工具 MVP

## 项目概述

Qx 是一个跨平台桌面启动器工具（macOS + Windows），采用 Raycast 亮色毛玻璃风格 UI 设计。技术栈为 Tauri v2（Rust 后端）+ React 19（TypeScript 前端）。核心功能包括：Spotlight 式快捷启动器、截图（区域截图 + OCR）、录屏转 GIF、剪切板管理、宏录制/回放、插件系统。

---

## P0 — Tauri v2 项目骨架

1. 使用 `npm create tauri-app@latest` 初始化项目（React + TypeScript + Vite）
2. 配置 `tauri.conf.json`：
   - 窗口 680x500（默认），无标题栏，背景毛玻璃，圆角 12px
   - `decorations: false, transparent: true`
   - `resizable: true`，最小窗口 480x360，保持 17:10 宽高比
   - 全局快捷键：Alt+Space 唤出/隐藏
   - 系统托盘图标
3. 安装依赖：tailwindcss v4, framer-motion, zustand, @tauri-apps/plugin-global-shortcut, @tauri-apps/plugin-clipboard-manager, @tauri-apps/plugin-shell
4. 基础 React 入口 + Tailwind 配置 + 暗色主题（但第一次用 Raycast 亮色风格）
5. 亮色毛玻璃主题 CSS（颜色变量用 `--color-canvas: rgba(246,246,246,0.85)` 等）

## P0 — 启动器搜索框 + 应用扫描

1. **Rust 后端**（`src-tauri/src/launcher/`）：
   - 扫描 macOS `/Applications` + `~/Applications` + `/System/Applications` 目录
   - 读取 Info.plist 获取应用名、图标路径、Bundle ID
   - 使用 `tauri::api::path` 获取标准目录
   - 返回 `Vec<AppEntry { name, path, icon, bundle_id }>`
   - 记录使用次数（SQLite `app_index` 表）

2. **React 前端**：
   - 搜索框：占位符 "Search for apps and commands..."，16px，无边框，圆角 8px
   - 列表项：48px 高，标题 14px(500) + 副标题 13px(400) + 右侧标签 12px(400)
   - 实时模糊搜索（fuse.js 或 Rust 端正则匹配）
   - 选中高亮 + Enter 执行（`tauri::api::shell::open`）
   - 窗口失焦自动隐藏

3. 底部操作栏 36px：快捷键提示（"↩ Open" / "⌘K Commands" 等）

## P0 — 截图

**Rust**: xcap 截取全屏 → 前端遮罩框选 → 裁剪保存 + SQLite 索引
**前端**: Alt+S 触发 → 全屏半透明遮罩 + 拖拽框选 → 确认裁剪

## P0 — 剪切板管理

**Rust**: 后台监听剪切板变化 → 文本/图片/文件分类存储到 SQLite
**前端**: Alt+V 唤出面板 → 列表展示历史 → 搜索 → 点击复制+自动粘贴

## P1 — 录屏 GIF

Alt+G 开始/停止 → scap 录制帧序列 → gifski 编码 → 保存 + 预览

## P1 — 宏录制/回放

rdev 录制 → enigo 回放 → 绑定触发词 → 存储到 SQLite

## P2 — 插件系统

本地目录扫描 ~/.qx/plugins/ → 加载 manifest.json → Script/View 两种插件类型

---

## 设计系统

```css
--color-canvas: rgba(246, 246, 246, 0.85);    /* 半透明毛玻璃白底 */
--color-surface: #ffffff;
--color-surface-hover: rgba(0, 0, 0, 0.04);
--color-surface-active: rgba(0, 0, 0, 0.08);
--color-border: rgba(0, 0, 0, 0.08);
--color-text-primary: #1a1a1a;
--color-text-secondary: #666666;
--color-text-tertiary: #999999;
--color-accent: #6366f1;
--color-accent-hover: #4f46e5;
```

**核心原则**：亮色半透明毛玻璃、backdrop-filter: blur(40px)、大留白、行高44-48px、圆角柔和、无阴影。

**窗口布局**：
```
┌─────────────────────────────────────────────────────────┐
│ 🔍 Search for apps and commands...                    │ ← 44px
├─────────────────────────────────────────────────────────┤
│ ── SUGGESTIONS ────────────────────────────────────── │
│ ⊙ View Topics By Node          V2EX          Command  │ ← 48px
│ 📦 GeekZip                                  Application │
│ ◆ Visual Studio Code                       Application │
├─────────────────────────────────────────────────────────┤
│ ↩ Open    ⌘K Commands    ⌘, Settings                  │ ← 36px
└─────────────────────────────────────────────────────────┘
```

## 数据库（SQLite）

```sql
CREATE TABLE clipboard_history (id INTEGER PRIMARY KEY AUTOINCREMENT, content_type TEXT NOT NULL, content TEXT, preview TEXT, is_favorite INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE screenshots (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, thumbnail_path TEXT, ocr_text TEXT, width INTEGER, height INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE macros (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, label TEXT NOT NULL, steps TEXT NOT NULL, icon TEXT, use_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE app_index (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, path TEXT NOT NULL, icon_path TEXT, use_count INTEGER DEFAULT 0, platform TEXT NOT NULL);
CREATE TABLE plugins (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL, path TEXT NOT NULL, enabled INTEGER DEFAULT 1, installed_at INTEGER NOT NULL);
```

## 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| Alt+Space | 唤出/隐藏启动器 |
| Alt+V | 唤出剪切板面板 |
| Alt+S | 截图 |
| Alt+G | 录屏 GIF（开始/停止） |
| Alt+R | 开始/停止宏录制 |
| Esc | 关闭当前窗口 |

## P1 — 全局设置界面（Raycast 风格）

**概述**：参考 Raycast Extensions 设置页面设计，提供一个全局设置面板，支持插件管理、快捷键自定义、扩展偏好配置等。通过 `⌘,` 或搜索 "settings" / "preferences" 唤出。

### UI 设计

**唤醒方式**：
- 快捷键 `⌘,` 在启动器窗口内打开设置
- 输入 "settings" / "preferences" / "plugins" / "shortcuts" 等关键词唤出
- 底部操作栏增加设置入口按钮 ⚙️

**布局**（仿 Raycast Extensions）：

```
┌────────────────────────────────────────────────────────────┐
│ 🔍 Search settings...                    ⚙️ Qx v0.1.0    │ ← 44px 搜索框
├────────────────────────────────────────────────────────────┤
│ ◀  General                          │  ┌─── 设置内容区 ──┐│
│    Extensions (Plugins)             │  │                  ││
│    Shortcuts                        │  │                  ││
│    Appearance                       │  │                  ││
│    Advanced                         │  │                  ││
│                                     │  │                  ││
└────────────────────────────────────────────────────────────┘
  左侧导航栏 200px                      右侧内容区（填充剩余）
```

**左侧导航**：固定 200px 宽，条目带图标 + 文字，选中高亮，支持关键字过滤
**右侧内容**：对应选中标签的具体配置表单/列表

### 功能模块

**1. 插件管理（Extensions）** — 参考 Raycast Store：
- 已安装插件列表：名称、版本、启用/禁用开关、描述
- 插件详情：权限说明、快捷键绑定、配置项
- 手动安装：从本地目录选择 manifest.json 或 .qx 插件包
- 卸载按钮
- 刷新/扫描本地插件目录 `~/.qx/plugins/`
- 插件来源标记（本地 / 待开发：内置商店）

**2. 快捷键设置（Shortcuts）** — 参考 Raycast Keyboard Shortcuts：
- 列出所有可配置快捷键（全局 + 模块内）：
  | 动作 | 当前快捷键 | 重置 |
  |------|-----------|------|
  | 唤出/隐藏启动器 | `Alt+Space` | ↺ |
  | 截图 | `Alt+S` | ↺ |
  | 剪切板面板 | `Alt+V` | ↺ |
  | 录屏 GIF | `Alt+G` | ↺ |
  | RSS 阅读器 | `Alt+R` | ↺ |
  | 启动器设置 | `⌘,` | ↺ |
- 点击快捷键绑定 → 弹出记录器（wait for key combination）→ 显示组合键
- 冲突检测：同一快捷键被多个动作占用时红色提示
- 分组：全局 / 截图 / 剪切板 / RSS / 录屏 / 宏
- 支持禁用某个快捷键（设为 None）

**3. 通用设置（General）**：
- 开机自启（Launch at Login）开关
- 语言选择（简体中文 / English）
- 检查更新 + 自动更新开关
- 数据存储路径
- 重置所有设置按钮

**4. 外观设置（Appearance）**：
- 主题切换：亮色 / 暗色 / 跟随系统
- 毛玻璃透明度滑块（0.7 - 0.95）
- 窗口宽度/高度设置（最小 400x300）
- 圆角大小（8px / 12px / 16px）
- 字体大小（13px / 14px / 15px / 16px）

**5. 高级设置（Advanced）**：
- 日志级别（Error / Warn / Info / Debug）
- 开发者模式开关（显示 DevTools 入口）
- 导出/导入配置（JSON）
- 数据清理（清空缓存/历史/日志）

### 技术方案

```
src/modules/settings/
├── SettingsPanel.tsx       // 主面板（导航 + 内容区）
├── GeneralSettings.tsx     // 通用设置
├── PluginManager.tsx       // 插件管理
├── ShortcutSettings.tsx    // 快捷键设置（含键记录器）
├── AppearanceSettings.tsx  // 外观设置
├── AdvancedSettings.tsx    // 高级设置
└── store.ts                // 设置状态管理
```

**Rust 后端**：
```rust
// src-tauri/src/settings/mod.rs — 设置存储
// 使用 JSON 文件存储 ~/.qx/settings.json
// Tauri commands:
// - get_settings() -> Settings
// - update_settings(settings: Settings)
// - reset_settings()
// - import_settings(path: String)
// - export_settings(path: String)
```

**设置数据结构**：
```typescript
interface Settings {
  general: {
    launchAtLogin: boolean;
    language: 'zh-CN' | 'en';
    autoUpdate: boolean;
    dataPath: string;
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
    blurOpacity: number;     // 0.7-0.95
    windowWidth: number;
    windowHeight: number;
    borderRadius: number;
    fontSize: number;
  };
  shortcuts: Record<string, ShortcutBinding>;
  plugins: PluginConfig[];
  advanced: {
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    devMode: boolean;
  };
}
```

**快捷键记录器组件**（ShortcutRecorder）：
- 聚焦后监听键盘事件
- 记录修饰键组合（Alt/Cmd/Ctrl/Shift + 单键）
- 显示当前录制状态（"Press shortcut..." / 已绑定组合键）
- 验证：排除系统预留快捷键、检测冲突
- 点击 Esc 或点击"X"取消录制

### 快捷键更新

| 快捷键 | 功能 |
|--------|------|
| `Alt+Space` | 唤出/隐藏启动器 |
| `Alt+V` | 唤出剪切板面板 |
| `Alt+S` | 截图 |
| `Alt+G` | 录屏 GIF（开始/停止） |
| `Alt+R` | 唤出 RSS 阅读器 |
| `⌘,` | 打开设置 |


## 开发优先级

1. **P0**: Tauri v2 项目骨架 + 全局快捷键 + 系统托盘 + 亮色毛玻璃窗口
2. **P0**: 启动器搜索框 + macOS 应用扫描 + 搜索匹配 + 执行
3. **P0**: 截图（全屏捕获 + 区域框选 + 保存 + 历史查看）
4. **P0**: 剪切板监听 + 历史存储 + 面板展示 + 搜索
5. **P1**: 录屏 GIF（区域选择 + 录制 + 编码 + 预览）
6. **P1**: 全局设置界面（Raycast 风格 — 插件管理 + 快捷键自定义 + 外观 + 通用 + 高级）
7. **P1**: RSS 阅读器（Raycast 风格 List+Detail+Navigation，三栏→钻取改造）
8. **P1**: 宏录制/回放（录制 + 编辑 + 绑定触发词 + 回放）
9. **P2**: GitHub 插件市场（公开仓库索引 + 按需下载安装 + 插件包格式 .qx）
10. **P2**: 插件系统（加载机制 + Script 插件 + View 插件 + API SDK）
11. **P2**: OCR 集成（截图自动识别 + 搜索）

---

**执行要求**：
- 严格按照 P0→P1→P2 顺序开发
- 每个功能完成后确保能编译通过
- 使用 Tauri v2 最新稳定版
- Rust 后端逻辑拆分到单独模块文件
- 前端组件按 modules/ 目录组织

---

## P1 — RSS 阅读器（Raycast 风格 List+Detail+Navigation）

**概述**：参考 Raycast Extension 的 List + Detail + ActionPanel 模式，在 Qx 启动器内嵌一个 RSS 阅读器。通过搜索 "rss" / "feeds" 或快捷键 `Alt+R` 唤出。

**设计原则**（来自 Raycast 开发者指南）：
- **List 是主容器**：搜索框过滤、Section 分组、Dropdown 二级筛选
- **ActionPanel**：每个条目附加操作菜单（快捷键 + 文字提示）
- **Detail**：选中条目后展示完整内容
- **Navigation**：钻取式导航（列表 → 详情），而非三栏平铺
- 整体与 Qx 搜索框体验一致：输入 → 过滤 → 选中 → 查看/执行

### 交互流程

```
启动器搜索 "rss" → 进入 RSS 阅读器视图
    │
    ├── 默认视图：订阅源列表 (List)
    │   └── 每个订阅源显示：图标 + 名称 + 未读数 + 最后更新时间
    │   └── ActionPanel: [↩ 查看文章] [R 刷新] [⌘D 删除] [⌘R 重命名]
    │
    ├── 选中订阅源 → 文章列表 (List, 钻取 Navigation)
    │   └── 文章项：标题 + 摘要(1行) + 发布时间 + 已读/星标状态
    │   └── Section: "今天" / "昨天" / "更早"（按时间分组）
    │   └── ActionPanel: [↩ 阅读] [S 星标] [U 切换未读] [O 浏览器打开]
    │   └── 搜索框过滤当前订阅的文章
    │
    ├── 选中文章 → 阅读详情 (List.Detail / 独立 Detail 视图)
    │   └── 标题 + 元信息（作者/时间/来源链接）
    │   └── 正文内容（HTML 清洗后渲染 + 内嵌图片自动加载）
    │   └── ActionPanel: [O 浏览器打开] [S 星标] [U 已读/未读] [图片保存]
    │   └── 快捷键：J/K 上下篇 / R 刷新 / U 切换未读
    │   └── Esc 返回文章列表
    │
    └── 返回：Esc 逐级回退，或搜索其他内容退出
```

### UI 组件

```
src/modules/rss/
├── RssPanel.tsx          // 入口：订阅源列表（List 视图）
├── ArticleList.tsx       // 文章列表（List + Sections 按时间分组）
├── ArticleDetail.tsx     // 文章阅读（Detail 视图）
├── AddFeedDialog.tsx     // 添加订阅对话框
├── ImageLightbox.tsx     // 图片放大查看
└── store.ts              // zustand 状态 + 文章缓存
```

**关键实现细节**：
- `RssPanel` 使用自定义 List 组件（仿 Raycast List.Item），支持搜索过滤、Section 分组
- `ArticleList` 继承 List 模式，`searchBarAccessory` 放置 Dropdown 筛选（全部/未读/星标）
- `ArticleDetail` 使用类似 Raycast Detail 的右半屏展示，支持 HTML 渲染
- ActionPanel 固定在底部操作栏区域（36px），显示当前选中条目的可用操作
- Navigation 用 React state 管理（`view: 'feeds' | 'articles' | 'detail'` + `selectedId`）

### 功能需求

**订阅管理**：
- Rust 后端：RSS/Atom feed 解析（`feed-rs` crate）
- SQLite 存储订阅源 URL、名称、图标、最后更新时间
- 支持手动添加/删除订阅源
- 支持 OPML 导入/导出

**列表阅读**：
- 订阅源列表：显示所有订阅，未读数标记，支持搜索过滤
- 文章列表：时间分组（今天/昨天/更早），标题+摘要+时间
- 文章详情：全文阅读，支持 HTML 渲染，内嵌图片
- 标记已读/未读，全部标记已读，星标

**图片查看**：
- 文章内嵌图片自动加载显示
- 点击图片放大查看（lightbox 模式）
- 支持图片保存到本地

### 技术方案

```rust
// Rust 后端
// Cargo.toml 新增依赖
feed-rs = "2"     // RSS/Atom 解析
reqwest = { version = "0.12", features = ["rustls-tls"] }  // HTTP 获取 feed
quick-xml = "0.36" // XML 解析

// 模块文件
src-tauri/src/rss/
├── mod.rs       // 模块入口 + Tauri commands
├── fetcher.rs   // 网络获取 + 解析
├── storage.rs   // SQLite CRUD
└── types.rs     // 数据结构

// 前端组件
src/modules/rss/
├── RssPanel.tsx        // 主面板（三栏布局）
├── FeedList.tsx        // 订阅源列表
├── ArticleList.tsx     // 文章列表
├── ArticleViewer.tsx   // 文章阅读区
├── ImageLightbox.tsx   // 图片放大查看
├── AddFeedDialog.tsx   // 添加订阅对话框
└── store.ts            // zustand 状态
```

### 数据库表

```sql
CREATE TABLE rss_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  icon TEXT,
  last_fetched INTEGER,
  error_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE rss_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES rss_feeds(id),
  guid TEXT NOT NULL UNIQUE,
  title TEXT,
  summary TEXT,
  content TEXT,
  author TEXT,
  link TEXT,
  image_url TEXT,
  is_read INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  published_at INTEGER,
  created_at INTEGER NOT NULL
);
```

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+R` | 唤出 RSS 阅读器 |
| `J` / `K` | 上/下篇文章 |
| `R` | 刷新当前订阅 |
| `U` | 切换仅未读 |
| `S` | 星标/取消星标 |
| `O` | 浏览器打开原文 |
| `Esc` | 返回列表 / 关闭阅读器 |

## P2 — GitHub 插件市场

**概述**：Qx 闭源后，通过一个公开的 GitHub 仓库维护插件索引，用户按需选择下载安装。每个功能模块（截图、剪切板、RSS、录屏等）都是独立插件，用户只装自己需要的。

### 架构

```
                 ┌─────────────────────────┐
                 │  GitHub: qx-plugins      │
                 │  ├── index.json          │ ← 插件清单
                 │  ├── plugins/            │
                 │  │   ├── screenshot.qx   │ ← .qx 插件包
                 │  │   ├── rss-reader.qx   │
                 │  │   └── clipboard.qx    │
                 │  └── README.md           │
                 └─────────┬───────────────┘
                           │ fetch index.json (raw.githubusercontent.com)
                           ▼
                 ┌─────────────────────────┐
                 │  Qx 应用                 │
                 │  PluginManager           │ ← 已实现的管理 UI
                 │  ├─ 市场标签页            │ ← 从 GitHub 拉取列表
                 │  ├─ 已安装标签页           │ ← 本地 ~/.qx/plugins/
                 │  └─ 安装/卸载/启用/禁用    │
                 └─────────────────────────┘
```

### .qx 插件包格式

每个插件是一个 zip 包（后缀 .qx），包含：

```
screenshot-1.0.0.qx
├── manifest.json        # 元数据：name, version, author, description, permissions
├── backend/             # Rust 编译产物 (.dylib / .dll / .so)
│   └── libscreenshot.dylib
└── frontend/            # 前端静态文件
    ├── index.html
    ├── index.js         # 编译后的 JS
    └── style.css
```

**manifest.json**：
```json
{
  "id": "screenshot",
  "name": "Screenshot",
  "version": "1.0.0",
  "min_app_version": "0.1.0",
  "author": "Qx",
  "description": "Capture screenshots with area selection and OCR",
  "permissions": ["screen_capture", "file_write", "notification"],
  "entry": "frontend/index.js",
  "shortcuts": {
    "alt+s": "capture_screen"
  }
}
```

### GitHub 仓库结构

公开仓库 `mcxen/qx-plugins`，根目录 `index.json`：

```json
{
  "schema_version": 1,
  "plugins": [
    {
      "id": "screenshot",
      "name": "Screenshot",
      "version": "1.0.0",
      "description": "区域截图 + OCR",
      "download_url": "https://github.com/mcxen/qx-plugins/releases/download/v1.0.0/screenshot-1.0.0.qx",
      "size_bytes": 245760,
      "checksum_sha256": "abc123...",
      "required_permissions": ["screen_capture", "file_write"],
      "updated_at": "2026-06-22T00:00:00Z"
    }
  ]
}
```

### 实现方案

**Rust 后端**（`src-tauri/src/marketplace/`）：
- `fetch_index()` — HTTP GET 获取 index.json（raw.githubusercontent.com）
- `download_plugin(url, dest)` — 下载 .qx 包到临时目录
- `install_plugin(path)` — 解压 .qx 到 ~/.qx/plugins/<id>/
- `uninstall_plugin(id)` — 删除插件目录 + 清理注册
- `list_installed_plugins()` — 扫描 ~/.qx/plugins/ 目录

**前端组件**（`src/modules/marketplace/`）：
- `Marketplace.tsx` — 市场列表（从 GitHub 获取的可用插件）
- `PluginDetail.tsx` — 插件详情页（描述/权限/大小/安装按钮）
- `InstalledPlugins.tsx` — 已安装插件管理（启用/禁用/卸载）

**PluginManager 改造**：当前 `PluginManager.tsx` 已实现本地插件管理 UI，需接入：
- 新增「市场」标签页（Marketplace tab）
- 插件搜索框过滤市场/已安装列表
- 安装进度条（下载 → 解压 → 注册）
- 版本更新检测（本地版本 vs 市场版本）

### 分发策略

| 阶段 | 内容 |
|------|------|
| 内置核心 | 搜索框 + 应用扫描 + 基础 UI（随主程序分发） |
| 可选插件 | 截图 / 剪切板 / RSS / 录屏 GIF / 宏录制（从市场下载） |
| 第三方插件 | 开发者通过 PR 提交到 qx-plugins 仓库，审核后发布 |

### 安全性

- 每个插件声明 `permissions`，安装时展示给用户确认
- Tauri capability 系统限制插件可访问的 API
- .qx 包提供 checksum 验证完整性
- 插件运行在 Tauri WebView 隔离上下文中
- 未来：插件签名验证（可选）

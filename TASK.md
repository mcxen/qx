# Qx — 跨平台桌面启动器工具 MVP

## 项目概述

Qx 是一个跨平台桌面启动器工具（macOS + Windows），采用 Raycast 亮色毛玻璃风格 UI 设计。技术栈为 Tauri v2（Rust 后端）+ React 19（TypeScript 前端）。核心功能包括：Spotlight 式快捷启动器、截图（区域截图 + OCR）、录屏转 GIF、剪切板管理、宏录制/回放、插件系统。

---

## P0 — Tauri v2 项目骨架

1. 使用 `npm create tauri-app@latest` 初始化项目（React + TypeScript + Vite）
2. 配置 `tauri.conf.json`：
   - 窗口 680x500，无标题栏，背景毛玻璃，圆角 12px
   - `decorations: false, transparent: true`
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

## 开发优先级

1. **P0**: Tauri v2 项目骨架 + 全局快捷键 + 系统托盘 + 亮色毛玻璃窗口
2. **P0**: 启动器搜索框 + macOS 应用扫描 + 搜索匹配 + 执行
3. **P0**: 截图（全屏捕获 + 区域框选 + 保存 + 历史查看）
4. **P0**: 剪切板监听 + 历史存储 + 面板展示 + 搜索
5. **P1**: 录屏 GIF（区域选择 + 录制 + 编码 + 预览）
6. **P1**: 宏录制/回放（录制 + 编辑 + 绑定触发词 + 回放）
7. **P2**: 插件系统（加载机制 + Script 插件 + View 插件 + API SDK）
8. **P2**: OCR 集成（截图自动识别 + 搜索）

---

**执行要求**：
- 严格按照 P0→P1→P2 顺序开发
- 每个功能完成后确保能编译通过
- 使用 Tauri v2 最新稳定版
- Rust 后端逻辑拆分到单独模块文件
- 前端组件按 modules/ 目录组织

---

## P1 — RSS 阅读器（控制台内嵌模块）

**概述**：在 Qx 启动器内嵌一个 RSS 阅读器，支持订阅管理、列表阅读、图片查看。作为控制台的扩展功能，可通过搜索或快捷键唤出。

### 功能需求

**订阅管理**：
- Rust 后端：RSS/Atom feed 解析（`feed-rs` crate）
- SQLite 存储订阅源 URL、名称、图标、最后更新时间
- 支持手动添加/删除订阅源
- 支持 OPML 导入/导出

**列表阅读**：
- 订阅源列表（左列）：显示所有订阅，未读数标记
- 文章列表（中列）：选中订阅后显示文章标题、摘要、发布时间
- 文章详情（右列/弹窗）：全文阅读，支持 Markdown/HTML 渲染
- 标记已读/未读，全部标记已读

**图片查看**：
- 文章内嵌图片自动加载显示
- 点击图片放大查看（lightbox 模式）
- 支持图片保存到本地

**前端 UI**：
- 三栏布局（订阅列表 / 文章列表 / 阅读区），参考 Reeder / NetNewsWire 风格
- 亮色毛玻璃风格，与启动器统一
- 快捷键：`J/K` 上下篇文章，`R` 刷新，`U` 切换未读
- 搜索框过滤文章

**控制台集成**：
- 在启动器中输入 "rss" / "feeds" 唤出阅读器
- 阅读器作为一个 View 插件或内嵌模块，占满启动器窗口
- 支持系统托盘通知新文章

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

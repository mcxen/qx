# Qx — macOS Productivity Launcher

<img src="README.assets/%E5%B7%B2%E7%94%9F%E6%88%90%E5%9B%BE%E5%83%8F%202.png" alt="Qx app icon" width="160" />

**English** | [中文](#qx--macos-效率启动器)

Qx is a **menu-bar resident desktop launcher** for macOS, inspired by Raycast. It pops up with a global hotkey, giving you instant access to search, clipboard history, screenshots, screen recording (GIF), RSS feeds, macros, and more — all within a unified, keyboard-first interface.

Built with **Tauri v2**, **React 19**, **TypeScript**, and **Rust**. It uses the macOS native frosted-glass appearance, Mach kernel APIs for system stats, and vendored native search for fast file lookups.

> **Status**: v0.4.26 — active development

---

## Features

| Module | Description |
|--------|-------------|
| **Launcher** | Fuzzy-search installed apps, files, built-in commands, and plugin actions |
| **Clipboard** | Persisted clipboard history with text/image support, pinning, filtering, inline preview |
| **Screenshot** | Full-screen or region capture, recent screenshot gallery |
| **Screen Recording** | Region-based GIF recording at 15fps (gifski), auto-saves to history |
| **RSS Reader** | Add feeds, inline article reading, star/bookmark, OPML import/export, background auto-refresh |
| **Macros** | Record and replay keyboard/mouse macro sequences |
| **Dev Tools** | Text / JSON / Markdown utility tools |
| **GitHub Calendar** | View your GitHub contribution graph inline |
| **Plugin System** | Sandboxed iframe-based plugin runtime with RPC bridge, marketplace, archive import, ed25519 signature verification |
| **Settings** | General, appearance (light/dark/system theme with Geist design system), keyboard shortcuts, macOS permissions, plugin management |

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Shell** | [Tauri v2](https://v2.tauri.app) (macOS private API, tray icon, frosted glass) |
| **Frontend** | React 19 + TypeScript + Vite 7 |
| **Styling** | Tailwind CSS v4 + CSS custom properties (Geist-inspired 10-step design tokens) |
| **State** | Zustand (global, plugin registry, per-module stores) |
| **Animation** | Framer Motion v12 |
| **Backend** | Rust (async via tokio, Tauri commands) |
| **Database** | SQLite via rusqlite (apps cache, clipboard history, RSS, plugin data) |
| **i18n** | English / Simplified Chinese |
| **Plugin Runtime** | Sandboxed iframe + postMessage RPC bridge |

### Rust Dependencies (key)

| Crate | Purpose |
|-------|---------|
| `xcap` | Screenshot capture |
| `scrap` + `gifski` | Screen recording → GIF encoding |
| `rdev` + `enigo` | Macro record/replay |
| `feed-rs` | RSS/Atom parsing |
| `reqwest` | HTTP client (RSS fetch, marketplace, GitHub API) |
| `rusqlite` | App data persistence |
| `objc2` / `core-graphics` | macOS native APIs |
| `window-vibrancy` | Frosted glass effect |
| `ed25519-dalek` | Plugin signature verification |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Tauri v2 Shell                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │              React 19 + TypeScript                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │  │
│  │  │ Launcher │ │ Clipboard│ │ RSS / Settings /   │   │  │
│  │  │ (search) │ │ History  │ │ Screenshot / etc.  │   │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Plugin System (iframe sandbox + RPC bridge) │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Rust Backend (Tauri Commands)          │  │
│  │  apps  |  clipboard  |  screenshot  |  screencap   │  │
│  │  rss   |  settings   |  marketplace  |  system_    │  │
│  │        |             |               |  stats       │  │
│  │  macros | file_search | history | ocr | github_    │  │
│  │        |             |         |     | calendar     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Shell Layout

```
┌──────────────────────────────────────────────┐
│ Top Bar: Back + Search + Quick Actions       │
├──────────────────────────────────────────────┤
│ Main Area (content)       │ Context Panel    │
│                           │ (240–340px)      │
├──────────────────────────────────────────────┤
│ Esc      [ Dynamic Island ]          Actions │
└──────────────────────────────────────────────┘
```

The Dynamic Island is always centered via `position: absolute; left: 50%; transform: translateX(-50%)`. Three visual styles are available: `solid`, `elevated`, and `glass`.

---

## Screenshots

> *Screenshots to be added.*

| View | Preview |
|------|---------|
| Launcher + Search Results | `<!-- screenshot -->` |
| Clipboard History | `<!-- screenshot -->` |
| RSS Reader | `<!-- screenshot -->` |
| Settings — Appearance | `<!-- screenshot -->` |
| Screen Recording (GIF) | `<!-- screenshot -->` |

---

## Installation

### Homebrew (recommended)

```bash
brew tap mcxen/qx
brew install --cask qx
```

> **Note for users in China**: If GitHub is inaccessible, use SSH: `git clone git@github.com:mcxen/homebrew-qx.git /opt/homebrew/Library/Taps/mcxen/homebrew-qx`

### Manual

1. Download `qx_<version>_aarch64-apple-darwin.app.zip` from [Releases](https://github.com/mcxen/qx/releases)
2. Unzip and move `Qx.app` to `/Applications`
3. Right-click → Open (first launch needs Gatekeeper override)
4. Qx lives in the menu bar — click the icon or press the global hotkey to open

### Update

```bash
brew update
brew upgrade --cask qx
```

---

## Usage

### Global Hotkey

| Action | Default Shortcut |
|--------|-----------------|
| Toggle Qx window | `⌘Space` (configurable in Settings → Shortcuts) |

### Launcher

Type anything into the search bar. Results include:

- **Apps** — fuzzy-matched from LaunchServices DB
- **Files** — native file search (kMDQuery)
- **Commands** — `settings`, `clipboard`, `rss`, `gif`, `macro`, `screenshot`
- **Calculator** — inline expression evaluation (`42 * 3.14`, `sqrt(144)`)
- **Plugin commands** — from installed plugins

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate results |
| `Enter` | Select / confirm |
| `Esc` | 3-level cascade: close detail → clear search → back to launcher |
| `⌘K` | Open Actions menu for current selection |
| `⌘,` | Open Settings |
| `⌘P` | Toggle pin (clipboard) |
| `⌘⌫` | Delete current entry |

### Modules

**Clipboard** — every copy is saved automatically. Open via `⌘⇧V` or search `clipboard`. Supports text, images, pinning, and type filtering.

**Screenshot** — search `screenshot`. Take full-screen or region capture. Recent screenshots shown in a gallery.

**Screen Recording** — search `gif` / `screencap`. Region-select and record up to 180s. Output is auto-encoded to animated GIF via gifski.

**RSS Reader** — search `rss`. Add feeds by URL, read articles inline with a detail pane, star to bookmark. Supports OPML import/export.

**Macros** — search `macro`. Record keyboard/mouse sequences and replay them. Saved macros persist in history.

**Settings** — search `settings` or press `⌘,`. Configure theme, shortcuts, RSS, plugins, and advanced options.

**Permissions** — open Settings → Permissions to check macOS Screen Recording, Accessibility, and Input Monitoring access. Green means Qx already has access; red means the feature needs approval. Use Request/Open to jump to the right System Settings privacy pane, then refresh the status after changing access.

**Plugins** — open Settings → Extensions to manage installed plugins, browse the marketplace, or import a plugin archive. Qx accepts local `.zip` / `.qx-plugin` packages, GitHub repository URLs, and direct GitHub archive URLs such as release assets or `https://github.com/<owner>/<repo>/archive/refs/heads/main.zip`. Repository URLs are downloaded as the `main` branch archive. The archive may contain the plugin at the zip root or inside a GitHub-generated top-level folder; Qx locates `manifest.json`, installs that plugin root into `~/.qx/plugins/<plugin-id>`, verifies ed25519 signatures when present, and enables the plugin automatically.

---

## Development

### Prerequisites

- [Rust](https://rustup.rs) (edition 2021)
- Node.js ≥ 20
- macOS 14+ (for Tauri v2 + macOS private APIs)

### Setup

```bash
git clone https://github.com/mcxen/qx.git
cd qx
npm install
```

### Development

```bash
npm run tauri dev
```

This starts a Vite dev server on `:1420` and opens a Tauri window.

### Build for Distribution

```bash
npm run tauri build -- --target aarch64-apple-darwin --bundles app
```

### Validation

```bash
cd src-tauri && cargo check
npx tsc --noEmit
```

---

## Project Structure

```
src/                          # Frontend (React + TypeScript)
├── App.tsx                   # Root component + tab routing
├── App.css                   # Global styles + CSS variable references
├── store.ts                  # Global Zustand store
├── ThemeProvider.tsx         # Light/dark/system theme provider
├── i18n.ts                   # EN / zh-CN translations
├── Launcher.tsx              # Main launcher with search + results
├── modules/                  # Feature modules
│   ├── clipboard/            # Clipboard history panel
│   ├── rss/                  # RSS reader (list + detail + store)
│   ├── settings/             # Settings (8 sub-panels + store)
│   ├── screenshot/           # Screenshot panel + region overlay
│   ├── screencap/            # Screen recorder + GIF history
│   ├── macros/               # Macro recorder + replayer
│   ├── documents/            # Dev text/JSON/MD tools
│   └── github-calendar/      # GitHub contributions viewer
├── plugin/                   # Plugin system
│   ├── types.ts              # Plugin manifest/command/panel types
│   ├── registry.ts           # Zustand registry + topological sort
│   ├── runtime.ts            # iframe sandbox + RPC bridge
│   ├── builtin.ts            # Built-in modules as pseudo-plugins
│   └── PluginHost.tsx        # iframe container + panel viewport
├── components/               # Shared components
│   ├── QxShell.tsx           # Core 3-layer shell layout
│   ├── HomeSystemIsland.tsx  # CPU/MEM/GPU sparkline island
│   └── ui.tsx                # Toggle, Select, Slider, Modal, etc.
├── hooks/
│   └── useEscBack.ts         # 3-level cascading Esc hook
├── search/
│   └── calculator.ts         # Inline expression evaluator
└── styles/                   # CSS files (base, shell, launcher, etc.)

src-tauri/                    # Rust backend
├── Cargo.toml                # Rust dependencies
├── tauri.conf.json           # Window/config (680×500, transparent, no-decor)
├── src/
│   ├── main.rs               # Binary entry
│   ├── lib.rs                # Tauri app setup (plugins, tray, shortcuts)
│   ├── apps.rs               # App scanning + fuzzy search
│   ├── clipboard.rs          # Clipboard listener + SQLite history
│   ├── screenshot.rs         # Screenshot capture (xcap)
│   ├── screencap.rs          # Screen recording to GIF (scrap + gifski)
│   ├── rss/                  # RSS module (fetcher, storage, types)
│   ├── settings/mod.rs       # TOML settings + global shortcuts
│   ├── marketplace/mod.rs    # Plugin marketplace (index, download, verify)
│   ├── system_stats.rs       # Mach kernel CPU/MEM/GPU stats
│   ├── macro_recorder.rs     # Keyboard/mouse macro record/replay
│   ├── file_search.rs        # Native file search (vendored)
│   ├── history.rs            # Launch + search history
│   ├── display_monitor.rs    # External display monitor
│   ├── ocr.rs                # OCR model management
│   ├── github_calendar.rs    # GitHub contribution fetch
│   └── v2ex.rs               # V2EX topic fetch/search
```

---

## Contributing

Contributions are welcome under the [Qx Source-Available License](#license).

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run validation: `cargo check` (in `src-tauri/`) and `npx tsc --noEmit`
5. Commit and push
6. Open a Pull Request

### Coding Guidelines

- Read `UI_SPEC.md` and `AGENTS.md` before making UI changes — they contain comprehensive design rules and technical constraints.
- Follow the **Esc Cascading Protocol**: all openable modules must use `useEscBack` for 3-level back navigation (inner state → query → launcher).
- Use CSS custom properties (`var(--qx-*)`) — never hardcode color values.
- File paths must use `convertFileSrc()` — no `file://` URLs.
- Custom Slider component (`src/components/ui.tsx`) — no `<input type="range">`.
- System stats use Mach kernel APIs — no `sysinfo` crate.

---

## License

Source-available — see [LICENSE](./LICENSE) for full terms.

- ✅ View, study, and modify source for **personal / non-commercial** use
- ❌ Commercial use, redistribution, or SaaS requires **written permission**
- Contributions are under the same license

---

## Acknowledgments

- [Vercel Geist Design System](https://vercel.com/geist) for design inspiration
- [Tauri](https://tauri.app) for the desktop framework
- [Raycast](https://raycast.com) for the product concept

---

# Qx — macOS 效率启动器

Qx 是一款常驻菜单栏的 macOS 桌面启动器，类 Raycast 风格，通过全局快捷键唤起。集搜索、剪贴板历史、截图、GIF 录屏、RSS 阅读、宏录制等功能于一体。

基于 **Tauri v2** + **React 19** + **TypeScript** + **Rust**，使用 macOS 原生毛玻璃效果、Mach 内核 API 获取系统状态。

> **版本**: v0.4.26 — 活跃开发中

## 功能特性

| 模块 | 说明 |
|------|------|
| **启动器** | 模糊搜索应用、文件、内置命令和插件动作 |
| **剪贴板** | 持久化历史记录，支持文本/图片、置顶、筛选和内联预览 |
| **截图** | 全屏或区域截图，近期截图画廊 |
| **录屏** | 选择区域录制为 GIF（15fps，gifski 编码），自动保存历史 |
| **RSS 阅读器** | 添加订阅源、内联阅读、收藏、OPML 导入/导出、后台自动刷新 |
| **宏录制** | 录制和回放键盘/鼠标宏序列 |
| **开发者工具** | 文本 / JSON / Markdown 实用工具 |
| **GitHub 日历** | 内联查看 GitHub 贡献图 |
| **插件系统** | 基于沙盒 iframe 的插件运行时，含 RPC 桥接、市场、压缩包导入和 ed25519 签名验证 |
| **设置** | 通用、外观（亮色/暗色/跟随系统，Geist 设计系统）、快捷键、macOS 权限、插件管理 |

## 安装

### Homebrew（推荐）

```bash
brew tap mcxen/qx
brew install --cask qx
```

### 手动安装

从 [Releases](https://github.com/mcxen/qx/releases) 下载并安装。

## 权限

打开「设置 → 权限」可以查看 macOS 屏幕录制、辅助功能和输入监听授权状态。绿灯表示已授权，红灯表示相关功能还需要系统批准。点击「请求」或「打开」会跳转到对应系统设置面板，授权完成后回到 Qx 刷新状态即可。

## 插件

打开「设置 → 扩展」可以管理已安装插件、浏览插件市场，或直接导入插件压缩包。支持本地 `.zip` / `.qx-plugin` 文件，也支持 GitHub 仓库链接、Release 资源链接和源码压缩包链接，例如：

```text
https://github.com/<owner>/<repo>/archive/refs/heads/main.zip
```

直接粘贴 `https://github.com/<owner>/<repo>` 时，Qx 会下载该仓库 `main` 分支的源码压缩包。Qx 会在压缩包中定位 `manifest.json`，将对应插件根目录安装到 `~/.qx/plugins/<plugin-id>`。如果 manifest 中包含 `pubkey` 和 `signature`，安装时会进行 ed25519 签名校验。

## 开发

```bash
git clone https://github.com/mcxen/qx.git
cd qx
npm install
npm run tauri dev      # 开发模式
npm run tauri build -- --target aarch64-apple-darwin --bundles app  # 构建
```

## 许可证

源码可用许可证 — 个人/非商业用途可阅读、学习、修改源代码。商业用途需书面授权。

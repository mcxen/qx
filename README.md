---

**Qx** is a background-resident launcher inspired by [Raycast](https://raycast.com).

Press a global hotkey, find anything, run it, hide again.

## Features

|  |  |
| --- | --- |
| **Launcher** | Apps, files, commands, aliases · fuzzy search · calculator |
| **Clipboard** | Text / image / file history · pin · paste at cursor |
| **Capture** | Screenshot & region record (MP4/MOV) · annotate · GIF convert |
| **RSS** | Feeds, folders, OPML, inline reading |
| **QxAI** | Streaming chat · OpenRouter / DeepSeek / custom BYOK |
| **Plugins** | Sandboxed runtime · marketplace · Raycast extension convert |

Also built in: weather · V2EX · macros · OCR · text tools · theme & shortcuts.

**Default hotkey (macOS):** `⌥ Space` — same key toggles show / hide.

Navigate with `↑` `↓` `Enter` · actions with `⌘K` · leave with `Esc`.

## Install

### macOS (Homebrew)

```bash
brew tap mcxen/qx
brew install --cask qx
```

```bash
brew upgrade --cask qx
```

### Releases

| Platform | Package |
| --- | --- |
| **macOS** Apple Silicon | `.app.zip` → unzip to `/Applications` · first open: right-click → Open |
| **Windows** x64 | NSIS installer from [Releases](https://github.com/mcxen/qx/releases) · WebView2 required |

Qx stays in the menu bar / tray after setup until you summon it.

## Develop

Requires **Node ≥ 20**, **Rust**, and **macOS 14+** or **Windows 10/11 + MSVC + WebView2**.

```bash
git clone https://github.com/mcxen/qx.git
cd qx
npm install
npm run tauri dev
```

```bash
# checks
npx tsc --noEmit
cd src-tauri && cargo check

# macOS arm64 app
npm run tauri build -- --target aarch64-apple-darwin --bundles app
```

Architecture, IPC, and UI rules live under `docs/` and `AGENTS.md`.

### Plugins

Install from **Settings → Extensions**, or convert a Raycast tree:

```bash
node scripts/convert-raycast-extension.mjs
```

| Doc | Audience |
| --- | --- |
| [`public/doc/plugin-development-guide.md`](public/doc/plugin-development-guide.md) | **Plugin authors — start here** (ports, manifest, zip Import, patterns) |
| [`public/doc/plugin-cli-protocol.md`](public/doc/plugin-cli-protocol.md) | **`context.cli`** contract (argv tools) |
| [`public/doc/plugin-system.md`](public/doc/plugin-system.md) | Full system / API / permissions reference |
| [`public/doc/plugin-marketplace.md`](public/doc/plugin-marketplace.md) | Pack, Import, marketplace publish |
| [`public/doc/raycast-plugin-conversion.md`](public/doc/raycast-plugin-conversion.md) | Convert Raycast extensions |
| [`public/doc/README.md`](public/doc/README.md) | Index of all `public/doc` guides |

## License

Source-available — see [LICENSE](./LICENSE).

- Personal / non-commercial: view, study, modify, run
- Commercial use, redistribution, or SaaS: **written permission required**

## Credits

[Raycast](https://raycast.com) · [Tauri](https://tauri.app) · [Geist](https://vercel.com/geist) · [Everything](https://www.voidtools.com/) (Windows file index)

---
---

**Qx** is a background-resident launcher inspired by [Raycast](https://raycast.com).

Press a global hotkey, find anything, run it, hide again.

![image.png](./attachments/1784127331011-image.png)

## Features

|  |  |
| --- | --- |
| **Launcher** | Apps, files, commands, aliases · fuzzy search · calculator |
| **Clipboard** | Text / image / file history · pin · paste at cursor |
| **Capture** | Screenshot & region record (MP4/MOV) · annotate · GIF convert |
| **RSS** | Feeds, folders, OPML, inline reading |
| **QxAI** | Streaming chat · OpenRouter / DeepSeek / custom BYOK |
| **Plugins** | Sandboxed runtime · marketplace · Raycast extension convert |

Also built in: weather · V2EX · macros · OCR · text tools · theme & shortcuts.

**Default hotkey (macOS):** `⌥ Space` — same key toggles show / hide.

Navigate with `↑` `↓` `Enter` · actions with `⌘K` · leave with `Esc`.

## Install

### macOS (Homebrew)

```bash
brew tap mcxen/qx
brew install --cask qx
```

```bash
brew upgrade --cask qx
```

### Releases

| Platform | Package |
| --- | --- |
| **macOS** Apple Silicon | `.app.zip` → unzip to `/Applications` · first open: right-click → Open |
| **Windows** x64 | NSIS installer from [Releases](https://github.com/mcxen/qx/releases) · WebView2 required |

Qx stays in the menu bar / tray after setup until you summon it.

## Develop

Requires **Node ≥ 20**, **Rust**, and **macOS 14+** or **Windows 10/11 + MSVC + WebView2**.

```bash
git clone https://github.com/mcxen/qx.git
cd qx
npm install
npm run tauri dev
```

```bash
# checks
npx tsc --noEmit
cd src-tauri && cargo check

# macOS arm64 app
npm run tauri build -- --target aarch64-apple-darwin --bundles app
```

Architecture, IPC, and UI rules live under `docs/` and `AGENTS.md`.

### Plugins

Install from **Settings → Extensions**, or convert a Raycast tree:

```bash
node scripts/convert-raycast-extension.mjs
```

| Doc | Audience |
| --- | --- |
| [`public/doc/plugin-development-guide.md`](public/doc/plugin-development-guide.md) | **Plugin authors — start here** (ports, manifest, zip Import, patterns) |
| [`public/doc/plugin-cli-protocol.md`](public/doc/plugin-cli-protocol.md) | **`context.cli`** contract (argv tools) |
| [`public/doc/plugin-system.md`](public/doc/plugin-system.md) | Full system / API / permissions reference |
| [`public/doc/plugin-marketplace.md`](public/doc/plugin-marketplace.md) | Pack, Import, marketplace publish |
| [`public/doc/raycast-plugin-conversion.md`](public/doc/raycast-plugin-conversion.md) | Convert Raycast extensions |
| [`public/doc/README.md`](public/doc/README.md) | Index of all `public/doc` guides |

## License

Source-available — see [LICENSE](./LICENSE).

- Personal / non-commercial: view, study, modify, run
- Commercial use, redistribution, or SaaS: **written permission required**

## Credits

[Raycast](https://raycast.com) · [Tauri](https://tauri.app) · [Geist](https://vercel.com/geist) · [Everything](https://www.voidtools.com/) (Windows file index)

---

# Qx — 效率启动器

**Qx** 是后台常驻的效率启动器（灵感来自 Raycast）：全局快捷键唤起 → 搜索 → 执行 → 再按同一快捷键收起。

基于 **Tauri 2 · React 19 · Rust**，支持 macOS 与 Windows。

| 能力 | 说明 |
| --- | --- |
| 启动器 | 应用 / 文件 / 命令 / 别名 · 模糊搜索 |
| 剪贴板 | 文本、图片、文件历史 · 置顶 · 粘出 |
| 截图与录屏 | 区域 / 窗口 · 标注 · MP4/MOV · 可转 GIF |
| RSS / QxAI / 插件 | 订阅阅读 · 流式对话 · 沙盒扩展与 Raycast 转换 |

默认快捷键：`⌥ Space`（可改）。模块快捷键**再按一次关闭**。

### 安装

```bash
brew tap mcxen/qx
brew install --cask qx
```

或从 [Releases](https://github.com/mcxen/qx/releases) 下载 macOS / Windows 安装包。

### 开发

```bash
git clone https://github.com/mcxen/qx.git && cd qx
npm install
npm run tauri dev
```

文档：[docs/](./docs/README.md) · 规范：[AGENTS.md](./AGENTS.md) · 协议：[LICENSE](./LICENSE)

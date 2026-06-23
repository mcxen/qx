# Qx — macOS Productivity Launcher

<img src="README.assets/%E5%B7%B2%E7%94%9F%E6%88%90%E5%9B%BE%E5%83%8F%202.png" alt="Qx app icon" width="160" />

**English** | [中文](#qx--macos-效率启动器)

Qx is a Raycast-style desktop launcher for macOS, built with Tauri v2, React, and TypeScript. It lives in your menu bar and pops up with a global hotkey.

## Features

| Module | What it does |
|--------|-------------|
| **Launcher** | Fuzzy-search apps, files, and built-in commands |
| **Clipboard** | History manager — browse and paste recent clippings |
| **Screenshot** | Take and manage screenshots |
| **Screen Recording** | Record screen region to animated GIF |
| **RSS Reader** | Subscribe to feeds, read articles inline, star/bookmark |
| **Macros** | Record and replay keyboard/mouse macros |
| **Settings** | General, appearance (light/dark/system theme), shortcuts, plugins |

## Installation

### Homebrew (recommended)

```bash
brew tap mcxen/qx
brew install --cask qx
```

### Manual

1. Download `qx_<version>_aarch64-apple-darwin.app.zip` from [Releases](https://github.com/mcxen/qx/releases)
2. Unzip and move `qx.app` to `/Applications`
3. Right-click → Open (first launch needs Gatekeeper override)
4. Qx sits in your menu bar — click the icon or press the global hotkey to open

### Update

```bash
brew update
brew upgrade --cask qx
```

## Usage

### Global Hotkey
- **`⌘Space`** — Toggle Qx window (configurable in Settings → Shortcuts)

### Launcher
Type anything into the search bar:
- App names → launch applications
- `settings` / `preferences` → open Settings panel
- `gif` / `screencap` / `录屏` → Screen Recorder
- `rss` / `feed` / `订阅` → RSS Reader
- `macro` / `录制` → Macro Recorder

### Panel Navigation
- **`⌘,`** — Open Settings
- **`Escape`** — Close panel / go back to launcher
- **`↑` `↓`** — Navigate results
- **`Enter`** — Confirm selection

### RSS Reader
- Search `rss` in the launcher to open
- Click **+** to add a feed URL
- Click article title → read full content in the detail pane
- Star articles to bookmark them

### Screen Recording (GIF)
- Search `gif` in the launcher
- Click **Record**, select a screen region
- Press **Stop** when done — GIF saves to history automatically

### Macros
- Search `macro` / `录制`
- **Record** — capture keyboard/mouse actions
- **Play** — replay a recorded macro
- Saved macros appear in the history list

### Clipboard
- Every copy is saved automatically
- Search `clipboard` or press **`⌘⇧V`** to open
- Click any entry to copy it back

### Appearance
Settings → Appearance:
- Light / Dark / System theme toggle
- Geist Design System throughout

## Development

```bash
git clone https://github.com/mcxen/qx.git
cd qx
npm install
npm run tauri dev
```

Build for distribution:

```bash
npm run tauri build -- --target aarch64-apple-darwin --bundles app
```

## License

Source-available. You may read, study, and modify the source code for personal or non-commercial purposes. Commercial use requires written permission from the copyright holder. See [LICENSE](LICENSE) for full terms.

---

# Qx — macOS 效率启动器

Qx 是一款类 Raycast 风格的 macOS 桌面启动器，基于 Tauri v2、React 和 TypeScript 构建。它常驻于菜单栏，通过全局快捷键唤起。

## 功能特性

| 模块 | 功能说明 |
|------|---------|
| **启动器** | 模糊搜索应用、文件和内置命令 |
| **剪贴板** | 历史记录管理器 — 浏览并粘贴最近的剪贴内容 |
| **截图** | 截图与管理 |
| **录屏** | 选择屏幕区域录制为 GIF 动画 |
| **RSS 阅读器** | 订阅源、内联阅读文章、收藏/书签 |
| **宏录制** | 录制和回放键盘/鼠标宏操作 |
| **设置** | 通用设置、外观（亮色/暗色/跟随系统）、快捷键、插件管理 |

## 安装

### Homebrew（推荐）

```bash
brew tap mcxen/qx
brew install --cask qx
```

### 手动安装

1. 从 [Releases](https://github.com/mcxen/qx/releases) 下载 `qx_<version>_aarch64-apple-darwin.app.zip`
2. 解压后将 `qx.app` 移至 `/Applications`
3. 右键 → 打开（首次启动需绕过 Gatekeeper）
4. Qx 常驻菜单栏 — 点击图标或使用全局快捷键打开

### 更新

```bash
brew update
brew upgrade --cask qx
```

## 使用方法

### 全局快捷键
- **`⌘Space`** — 切换 Qx 窗口（可在设置 → 快捷键中修改）

### 启动器
在搜索栏中输入任意内容：
- 应用名称 → 启动应用
- `settings` / `preferences` → 打开设置面板
- `gif` / `screencap` / `录屏` → 屏幕录制
- `rss` / `feed` / `订阅` → RSS 阅读器
- `macro` / `录制` → 宏录制器

### 面板导航
- **`⌘,`** — 打开设置
- **`Escape`** — 关闭面板 / 返回启动器
- **`↑` `↓`** — 上下选择结果
- **`Enter`** — 确认选择

### RSS 阅读器
- 在启动器中搜索 `rss` 打开
- 点击 **+** 添加订阅源 URL
- 点击文章标题 → 在详情面板中阅读完整内容
- 星标文章以收藏

### 屏幕录制（GIF）
- 在启动器中搜索 `gif`
- 点击 **录制**，选择屏幕区域
- 完成后点击 **停止** — GIF 自动保存到历史记录

### 宏录制
- 搜索 `macro` / `录制`
- **录制** — 捕获键盘/鼠标操作
- **回放** — 重放已录制的宏
- 已保存的宏显示在历史列表中

### 剪贴板
- 每次复制自动保存
- 搜索 `clipboard` 或按 **`⌘⇧V`** 打开
- 点击任意条目即可重新复制

### 外观
设置 → 外观：
- 亮色 / 暗色 / 跟随系统 主题切换
- 全局采用 Geist 设计系统

## 开发

```bash
git clone https://github.com/mcxen/qx.git
cd qx
npm install
npm run tauri dev
```

构建发布版本：

```bash
npm run tauri build -- --target aarch64-apple-darwin --bundles app
```

## 许可证

源码可用。你可以阅读、学习和修改源代码用于个人或非商业用途。商业用途需获得著作权人的书面授权。完整条款请参阅 [LICENSE](LICENSE)。

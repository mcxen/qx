# Qx — macOS Productivity Launcher

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

1. Download `qx_<version>_aarch64-apple-darwin.app.zip` from [Releases](https://github.com/mcxen/qx/releases)
2. Unzip and move `qx.app` to `/Applications`
3. Right-click → Open (first launch needs Gatekeeper override)
4. Qx sits in your menu bar — click the icon or press the global hotkey to open

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

Source-available for code review only. See [LICENSE](LICENSE).

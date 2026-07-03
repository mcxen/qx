# Raycast Extension Conversion

Qx does not run Raycast extensions directly. Raycast view commands depend on
`@raycast/api`, React rendering, Node modules, and in some cases Raycast's Swift
bridge. Qx plugins run inside an iframe sandbox and communicate with the app by
`postMessage` RPC, so Raycast extensions need an adapter layer.

`scripts/convert-raycast-extension.mjs` converts a Raycast extension directory
into a Qx plugin directory, and can package it as a `.qx-plugin` archive.

## Usage

```bash
npm run convert:raycast -- /path/to/raycast-extension --out /tmp/qx-plugins --package
```

The command writes:

```text
/tmp/qx-plugins/raycast-<extension-name>/
├── manifest.json
├── index.js
├── README.md
└── copied icon and screenshot assets

/tmp/qx-plugins/raycast-<extension-name>.qx-plugin
```

Inside Qx, open Settings -> Plugins and paste a Raycast extension tree URL into
the Raycast install field. For example:

```text
https://github.com/raycast/extensions/tree/888d04008da11340e0a0fa98b32dde4465a33e72/extensions/system-information
```

## Current Adapter

The first supported adapter targets Raycast's `system-information` extension at
commit `888d04008da11340e0a0fa98b32dde4465a33e72`.

Converted features:

- `View System Information` panel
- `check-system-info`
- `check-storage`
- `check-network`
- `list-processes`
- `kill-process`

The converted plugin calls Qx backend commands instead of Raycast's Node/Swift
runtime:

- `qx_system_information_check_system_info`
- `qx_system_information_check_storage`
- `qx_system_information_check_network`
- `qx_system_information_list_processes`
- `qx_system_information_kill_process`

This keeps the plugin real and testable while preserving the Raycast command and
tool surface.

Converted adapters should prefer Qx capability permissions such as
`system-info`, `processes`, `clipboard`, `http`, and `notifications`. Dangerous
actions still require exact `invoke:<cmd>` permissions; for example the
system-information adapter declares `invoke:qx_system_information_kill_process`
for `kill-process`.

## Generic Raycast Extensions

For extensions without a custom adapter, the CLI converter now builds a generic
compatibility bundle. It uses esbuild to compile the Raycast command source and
replaces common Raycast/Node imports with Qx shims:

- `@raycast/api`: `List`, `Grid`, `Detail`, `ActionPanel`, `Action`, `Toast`,
  `showToast`, `showHUD`, `LocalStorage`, `Cache`, `getPreferenceValues`,
  `open`, `showInFinder`, `Clipboard`, and `useNavigation`.
- `node-fetch`: routed through `context.http.fetch`.
- `run-applescript`: routed through the permissioned
  `plugin_run_applescript` command.
- `file-url`, `fs-extra`, `os`, `path`, and `buffer`: lightweight browser/Qx
  shims. Generic Raycast plugins may access real absolute paths, `~/...`
  paths, and the virtual private path `/qx-plugin-files/<plugin-id>`.
  `/qx-home` is mapped to the real user home directory by the Rust bridge and
  before AppleScript execution.

When a Raycast extension declares regular npm dependencies beyond the shimmed
modules, the converter installs its production dependencies inside the temporary
extension checkout with lifecycle scripts disabled. React and React DOM are
always resolved from Qx's converter dependencies so converted commands do not
load a second React copy and break hooks.

Raycast preferences are mapped into Qx plugin manifest preferences where
possible: dropdowns become `select`, checkboxes become `boolean`, passwords stay
`password`, and text-like preferences become `string`.

For example, Raycast's `bing-wallpaper` extension at commit
`870667fc671801a467deb7c4c7fc72992efe3820` converts into a
`raycast-bing-wallpaper.qx-plugin` with its original commands and bundled
React/Raycast UI. The converted plugin declares `http`, `open-url`,
`clipboard`, `invoke:plugin_run_applescript`, and permissioned file bridge
commands such as `invoke:plugin_file_read_base64` and
`invoke:plugin_file_write_base64`.

Converted Raycast `ActionPanel` entries are rendered as compact item-level
buttons by default so secondary actions such as "Download Wallpaper" remain
discoverable. Users can hide these buttons from Settings -> Extensions ->
Installed -> Display. Converted plugins read the host preference from
`context.display.raycastActionPanel`; the shim also hides ActionPanel buttons
automatically when the plugin panel is narrow, before text or thumbnails are
compressed. `Detail` commands also render their `actions` prop, so converted
detail-style tools can expose navigation, copy, and preference actions.

The converter copies command/plugin icons and records screenshots from common
Raycast metadata locations: `screenshots`, `screenshot`, `media`, `gallery`,
`metadata.screenshots`, plus image files found in `metadata/`, `screenshots/`,
or `media/`. Qx displays those assets in Settings -> Plugins -> Installed.

The converter also writes a Raycast compatibility report into `manifest.json`.
It statically scans the extension source for common Raycast and Node APIs such
as `List` / `Grid`, `fetch`, `Clipboard`, `LocalStorage`, `Cache`, `fs-extra`,
`showInFinder`, `run-applescript`, no-view intervals, and menu bar commands.
Settings -> Plugins -> Installed displays the resulting per-platform report:

- `supported`: expected to work on that platform.
- `partial`: the plugin can run, but one or more actions are degraded or
  unavailable.
- `mac-only`: intentionally limited to macOS.
- `unsupported`: the converted plugin should not be considered usable on that
  platform.

Raycast itself remains macOS-first. Windows compatibility is capability-level:
UI, HTTP, clipboard, storage/cache, open file/URL, and background intervals can
be available, while AppleScript, Finder/System Events, and menu bar behavior are
marked as degraded or unsupported until a Qx automation provider maps them to
PowerShell, Win32, UI Automation, or ShellExecute equivalents.

Raycast `mode: "no-view"` commands with an `interval` are scheduled by Qx as
persistent plugin background timers. Qx records the next run in local storage so
the schedule can resume after plugin reload or app restart.

The Settings UI Raycast URL installer attempts to use the same JS converter for
generic-shim plugins when the converter script is available in the local source
tree. Packaged distributions must ship or embed this converter pipeline for the
same behavior outside development builds. The `fs-extra` shim supports durable
real file writes, async reads, async JSON reads/writes, directory creation,
directory clearing, and runtime directory listing. Synchronous reads can only
return files touched in the current runtime because the browser-side shim cannot
block on Tauri RPC.

Qx does not load Raycast's native Swift bridge, Node runtime, or arbitrary Rust
binaries from converted plugins. Native system access goes through Qx's
permissioned Rust capability bridge.

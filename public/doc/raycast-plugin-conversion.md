# Raycast Extension Conversion

Qx does not run Raycast extensions directly. Raycast view commands depend on
`@raycast/api`, React rendering, Node modules, and in some cases Raycast's Swift
bridge. Qx plugins run inside an iframe sandbox and communicate with the app by
`postMessage` RPC, so Raycast extensions need an adapter layer.

The marketplace lives in **`mcxen/qx-plugins`**. Converted plugins (with icons
and screenshots) are packaged as `.qx-plugin` zips and installed from:

```text
https://raw.githubusercontent.com/mcxen/qx-plugins/main/<plugin-id>.qx-plugin
```

Install does **not** fetch Raycast’s GitHub tree at runtime. Screenshots and
code ship **inside** the archive that was previously converted and published.

## Converter entry points

| Entry | Role |
|-------|------|
| `scripts/convert-raycast-extension.mjs` | Convert a local Raycast extension directory |
| `scripts/convert-raycast-url.mjs` | Sparse-clone a GitHub tree URL, then convert |
| `scripts/raycast-converter/generic.mjs` | esbuild generic Raycast → Qx bundle |
| `scripts/raycast-converter/shims.mjs` | `@raycast/api`, fetch, fs, Buffer, AppleScript |
| `scripts/raycast-converter/adapters.mjs` | Hand-written adapters (e.g. system-information) |
| `mcxen/qx-plugins` packaging | `npm run package:plugins` → `index.json` |

Local usage (from the **qx-plugins** repo, preferred for marketplace publish):

```bash
npm ci
npm run convert:raycast-url -- \
  https://github.com/raycast/extensions/tree/<commit>/extensions/<name> \
  --out dist/raycast-converted \
  --package \
  --publish
```

Or from a local checkout:

```bash
npm run convert:raycast -- /path/to/raycast-extension --out /tmp/qx-plugins --package
```

Output shape:

```text
raycast-<extension-name>/
├── manifest.json
├── index.js          # esbuild bundle + Buffer banner
├── README.md
├── icons / screenshots copied from Raycast metadata
└── …

raycast-<extension-name>.qx-plugin   # zip for marketplace
```

Inside Qx, Settings → Plugins can also accept a Raycast extension tree URL when
the converter is available in the build (dev/source trees). Packaged app builds
must ship or embed the same pipeline for full parity.

## Architecture principle

**Keep Raycast ports as external plugins. Fix missing behavior in the Qx host
and converter shims — do not rewrite each port as a one-off native plugin.**

| Layer | Responsibility |
|-------|----------------|
| Host (`plugin_http_fetch`, runtime `fetch`) | Text + **binary** HTTP (`bodyBase64`, `arrayBuffer`) |
| Host (`plugin_file_*`, `plugin_run_applescript`) | File cache, automation |
| Converter shims | `@raycast/api` UI, `Buffer`, `node-fetch`, `fs-extra`, path aliases |
| Marketplace plugin | Converted bundle + assets + `min_app_version` |

### Binary HTTP (Qx ≥ 0.5.18)

Older hosts returned only UTF-8 `body` strings. Image downloads used by
extensions such as Bing Wallpaper were corrupted and `arrayBuffer()` was
missing. From **0.5.18**:

- Rust `plugin_http_fetch` returns `body`, `bodyBase64`, and `binary`
- Plugin runtime / context expose `arrayBuffer()` and `blob()`
- Default HTTP timeout is 30s (max 120s) for large assets

Set `min_app_version` on plugins that download binary assets (e.g. Bing
Wallpaper → `0.5.18`).

### Buffer polyfill

Many Raycast sources call Node’s global `Buffer.from`. The converter injects a
banner at the top of the bundle and also shims the `buffer` package.

### Paths

- `/qx-plugin-files/<plugin-id>/…` — private plugin data (file bridge)
- `/qx-home` and `~/…` — user home (rewritten for AppleScript)

## Generic Raycast extensions

For extensions without a custom adapter, the CLI builds a generic compatibility
bundle with esbuild and replaces common imports:

- `@raycast/api`: `List`, `Grid`, `Detail`, `ActionPanel`, `Action`, `Toast`,
  `showToast`, `showHUD`, `LocalStorage`, `Cache`, `getPreferenceValues`,
  `open`, `showInFinder`, `Clipboard`, `useNavigation`, preferences, etc.
- `node-fetch`: `context.http.fetch` (+ `arrayBuffer` when host provides it)
- `run-applescript`: permissioned `plugin_run_applescript`
- `file-url`, `fs-extra`, `os`, `path`, `buffer`: browser/Qx shims

npm dependencies beyond the virtual set are installed in a temporary checkout
with lifecycle scripts disabled. React / React DOM always resolve from the
converter’s own dependencies so hooks share one React copy.

Preferences map into Qx manifest preferences (`select`, `boolean`, `password`,
`string`). Screenshots are discovered from Raycast `metadata/`, `screenshots/`,
`media/`, and package fields.

`ActionPanel` actions render as compact item-level buttons (hide via Settings →
Extensions → Installed → Display, or automatically when the panel is narrow).
`mode: "no-view"` + `interval` becomes a Qx background timer with resume state
in local storage.

### Platform compatibility report

The converter writes `manifest.raycast.platformCompatibility` after scanning
source for List/Grid, fetch, Clipboard, fs, AppleScript, intervals, menu bar,
etc. Status values: `supported`, `partial`, `mac-only`, `unsupported`.

Windows is capability-level: UI/HTTP/clipboard/storage/open/interval can work;
AppleScript / Finder / menu bar stay degraded until a Windows automation
provider exists.

## Custom adapters

Some extensions map cleanly onto native Qx commands. Example:
`system-information` (commit `888d04008da11340e0a0fa98b32dde4465a33e72`) uses
`qx_system_information_*` instead of Raycast’s Node/Swift stack. Prefer
capability permissions (`system-info`, `processes`, …) and exact
`invoke:<cmd>` for dangerous actions (e.g. kill process).

## What Qx does not load from Raycast

- Native Swift bridge
- Arbitrary Node native addons
- Untrusted Rust/binaries from the extension tree

All system access goes through permissioned Rust commands.

## Marketplace maintenance checklist

1. Convert or update plugin under `mcxen/qx-plugins` `src/<id>/`
2. Set `version` and `min_app_version` for required host APIs
3. `npm run package:plugins` → verify `index.json` checksums
4. Push `main` (CI may re-package; keep converter/shims in sync with Qx)
5. Users install/update from Qx Marketplace (GitHub raw download)

When something is broken for all Raycast ports (binary fetch, Buffer, actions),
**fix the host or converter first**, then re-convert affected plugins if the
bundle must pick up shim changes.

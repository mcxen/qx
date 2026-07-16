---
name: port-raycast-plugin
description: >
  Port or re-convert a Raycast extension into a Qx marketplace plugin
  (raycast-*.qx-plugin) via the Qx/qx-plugins converter. Use when the user
  asks to convert, re-port, fix, or rebundle a Raycast plugin (Bing Wallpaper,
  Calendar, etc.), mentions Action/List/Grid not working after conversion,
  or runs /port-raycast-plugin.
---

# Port Raycast Plugin → Qx

## Principle (do this first)

**Fix the converter port, not one-off forks of each extension.**

| Broken thing | Fix here |
|---|---|
| Actions not firing, Action wrappers, keyboard on List/Grid | `scripts/raycast-converter/shims.mjs` (`@raycast/api`) |
| Panel mount, prefs, FS hydrate, nav stack | `scripts/raycast-converter/generic.mjs` |
| Binary download / arrayBuffer | Host `plugin_http_fetch` + fetch shim (already ≥ 0.5.18) |
| Save file / set wallpaper / AppleScript | `fs-extra` + `run-applescript` shims + host `plugin_file_*` / `plugin_run_applescript` |
| Permissions / min version | `scripts/convert-raycast-extension.mjs` |

Repos:

- **Qx app converter**: `Qx/scripts/raycast-converter/` + `Qx/scripts/convert-raycast-extension.mjs`
- **Marketplace repo**: `qx-plugins` (`mcxen/qx-plugins`) — keep shims **in sync** with Qx, then package

Docs: `public/doc/raycast-plugin-conversion.md`, `docs/architecture-principles.md`.

## Workflow

### 1. Locate repos

```bash
# Qx host
cd /path/to/Qx

# Marketplace (plugins live here)
cd /path/to/qx-plugins   # or qx-plugins-clone
```

### 2. Sync converter if you edit shims in Qx

```bash
cp Qx/scripts/raycast-converter/shims.mjs   qx-plugins/scripts/raycast-converter/
cp Qx/scripts/raycast-converter/generic.mjs qx-plugins/scripts/raycast-converter/
# if convert entry changed:
cp Qx/scripts/convert-raycast-extension.mjs qx-plugins/scripts/
```

### 3. Convert (preferred: pin a Raycast commit)

```bash
cd qx-plugins
npm ci   # once

npm run convert:raycast-url -- \
  "https://github.com/raycast/extensions/tree/<commit>/extensions/<name>" \
  --out src \
  --package
```

Local directory:

```bash
npm run convert:raycast -- /path/to/raycast-extension --out src --package
```

Output:

```text
src/raycast-<name>/
  manifest.json
  index.js          # esbuild bundle + shims
  icons / screenshots
raycast-<name>.qx-plugin   # may land under src/ depending on --out
```

### 4. Package marketplace index

```bash
# ensure .qx-plugin sits at repo root (package-plugins scans src/*/manifest)
npm run package:plugins
# updates index.json checksums
```

### 5. Install for local test

```bash
# From Qx Settings → Extensions → import the .qx-plugin
# or copy into the app plugins dir used by marketplace install
unzip -t raycast-<name>.qx-plugin
node --check src/raycast-<name>/index.js
```

### 6. Validate checklist (Bing-class plugins)

- [ ] Grid/List shows remote images (HTTP + `arrayBuffer`)
- [ ] **Primary action** on item click (Set Wallpaper) — wrappers like `ActionsOnlineBingWallpaper` must expand
- [ ] **Secondary actions** visible on card: Download, Preview, Open folder
- [ ] **Keyboard**: ↑/↓ or ←/→ select; Enter = primary; Raycast shortcuts (e.g. ⌘D) when declared
- [ ] **Preview** (`Action.Push`) + Back (`useNavigation().pop`)
- [ ] **Save** writes under `~/Downloads` via `plugin_file_write_base64` (path `/qx-home/...`)
- [ ] macOS set wallpaper via `plugin_run_applescript`
- [ ] `manifest.permissions` includes `http`, `open-url`, `invoke:plugin_file_*`, `invoke:plugin_run_applescript` as needed
- [ ] `min_app_version` set when host APIs required (binary fetch → `0.5.18`)

## Known failure modes (and the fix)

### Action “does nothing”

Cause: `actions` is often a **wrapper component** (`ActionsOnlineBingWallpaper`), not bare `ActionPanel`. Old `firstAction` only walked `props.children` and never expanded the wrapper.

Fix in shim: `expandNode` + `collectActions` that call pure function components; `ItemShell` runs primary from collected list; also render first few action buttons on the card + bottom action dock.

### Buttons hidden on narrow panels

Cause: CSS hid `.qx-raycast-actions-inline` under 680px / preference.

Fix: per-item `.qx-raycast-item-actions` + fixed `.qx-raycast-action-dock` always available for selection.

### Preview Back broken

Cause: `useNavigation().pop` was a no-op.

Fix: `navStack` + `currentElement` in runtime; `push`/`pop` re-render.

### Download / list empty

Cause: `readdirSync` only saw in-memory writes; Downloads never listed.

Fix: `hydrateFilesystem` on panel open + `__qxRaycastFsHydrate` / `dirListCache`; `readdirSync` merges cache.

### Images are blank for local paths

Cause: `fileUrl` returned raw path; iframe cannot load `file://`.

Fix: `LocalImage` reads via `plugin_file_read_base64` or session mem → blob URL; markdown `<img src>` handled the same.

### Do NOT

- Hand-edit production `index.js` for one plugin unless emergency; re-convert after shim fix
- Add host Cmd+K bridges for every action unless product requires it — keep actions inside the plugin iframe
- Fork Bing into a native Qx module when the port is missing capability — extend shims/host once

## Minimal shim regression script (optional)

```bash
node --input-type=module -e '
import { raycastApiShimModule, raycastShimStyles, fsExtraShimModule } from "./scripts/raycast-converter/shims.mjs";
import fs from "fs";
const src = raycastApiShimModule({layout:"Grid"}, "/qx-plugin-files/t") + raycastShimStyles() + fsExtraShimModule();
fs.writeFileSync("/tmp/qx-raycast-shim.js", src);
'
node --check /tmp/qx-raycast-shim.js
```

After rebundle:

```bash
rg -n "expandNode|ensureKeyboardNav|__qxRaycastFsHydrate|qx-raycast-action-dock" src/raycast-bing-wallpaper/index.js
```

## Publish

1. Commit converter + `src/raycast-<id>/` + `*.qx-plugin` + `index.json` in **qx-plugins**
2. Push `main` (marketplace fetches GitHub raw)
3. Users update from Qx Extensions marketplace

## Example: Bing Wallpaper

```bash
cd qx-plugins
# after syncing shims from Qx
npm run convert:raycast-url -- \
  "https://github.com/raycast/extensions/tree/870667fc671801a467deb7c4c7fc72992efe3820/extensions/bing-wallpaper" \
  --out src --package
npm run package:plugins
```

Expect: Set Desktop Wallpaper / Download / Preview on each tile; arrows + Enter; save to Downloads; AppleScript set wallpaper on macOS.

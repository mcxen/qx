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
└── copied icon assets

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

For extensions without a custom adapter, the converter still produces a Qx
manifest and a placeholder entry. That output is intentionally explicit: the
extension metadata is preserved, but command behavior needs a custom adapter
before the plugin is considered functional.

Qx does not load Raycast's native Swift bridge, Node runtime, or arbitrary Rust
binaries from converted plugins. Native system access goes through Qx's
permissioned Rust capability bridge.

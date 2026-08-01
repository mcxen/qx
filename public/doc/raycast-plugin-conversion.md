# Raycast Extension Migration

> **Frozen.** The converter is retained for historical research and one-off experiments.
> It is not a supported production path and does not track new Raycast APIs.

Qx does not run Raycast extensions directly. Maintained plugins must read the upstream source,
preserve its business intent, and reimplement it against Qx `context.*`, Workbench, Actions and
Island protocols.

## 1. Why direct loading does not work

Raycast view commands depend on `@raycast/api`, React/Node rendering and sometimes native bridges.
Qx plugins run in a sandbox and communicate through permissioned host ports. Similar names do not
make the lifecycle, UI tree or native APIs interchangeable.

## 2. Supported migration path

1. Read the upstream command and identify its domain service, inputs, outputs and side effects.
2. Replace Raycast storage, network, CLI and system calls with the matching Qx `context.*` port.
3. Return declarative Workbench data instead of translating the React tree.
4. Convert every user operation to a stable Qx Action ID.
5. Publish status and real progress through Island.
6. Create a native Qx Manifest with minimum permissions and supported platforms.
7. Re-map Raycast `List` / `Detail` / `ActionPanel` into the single Qx Workbench state;
   do not carry over a self-drawn toolbar, sidebar, About block or Enter handler.
8. Test cold install, keyboard flow, errors and both desktop platforms.

Canonical targets:

- author workflow: [`plugin-development-guide.md`](./plugin-development-guide.md)
- UI and actions: [`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)
- CLI: [`plugin-cli-protocol.md`](./plugin-cli-protocol.md)
- Manifest and package: [`plugin-marketplace.md`](./plugin-marketplace.md)

## 3. Historical converter

The repository still contains:

| Entry | Historical role |
|---|---|
| `scripts/convert-raycast-extension.mjs` | convert a local extension directory |
| `scripts/convert-raycast-url.mjs` | fetch a GitHub tree and convert |
| `scripts/raycast-converter/generic.mjs` | generic esbuild path |
| `scripts/raycast-converter/shims.mjs` | partial API shims |
| `scripts/raycast-converter/adapters.mjs` | hand-written adapters |

These commands may help inspect an extension, but their output is not a release baseline.
Do not add new production behavior to converter shims.

## 4. Action mapping

Map intent, not components:

| Raycast concept | Qx target |
|---|---|
| primary `Action` | one `actions[]` item with stable `id` and `primary: true` |
| `ActionPanel` | the same Qx `actions[]` set |
| `List` / `Grid` | Workbench List / Grid |
| detail markdown | Workbench Detail |
| form submit | Workbench Form action |
| toast / HUD | toast or short Island feedback |

Bottom Bar and Enter are host projections of the primary action. Never create separate copies.
Esc remains a host navigation protocol.

## 5. Platform rules

- Do not carry AppleScript, fixed Unix paths or macOS-only binaries into a cross-platform package.
- Use host HTTP, storage, CLI and system ports.
- Declare actual `platforms`; do not claim Windows compatibility without testing.
- Keep paths opaque and use host-provided separators and environment information.
- Unsupported capabilities must produce a clear unavailable state.

## 6. Binary data and files

Use host HTTP binary responses and the documented plugin storage/file ports. Do not depend on
browser `file://` access, raw local paths in images, or converter Buffer polyfills as an architecture.

## 7. Migration checklist

- [ ] Business behavior was reimplemented, not just transpiled.
- [ ] No runtime dependency on `@raycast/api`.
- [ ] No new converter shim was added.
- [ ] Manifest permissions and platforms are minimal and accurate.
- [ ] Workbench and Actions follow current Qx contracts.
- [ ] Network, CLI and progress are real.
- [ ] Package passes local cold-install validation.

# Qx plugin workflows

Read only the mode that matches the request. Commands run from the authoritative `qx-plugins` checkout unless marked as Qx host commands.

## Create or rewrite

1. Write the acceptance scenarios first: launcher/panel entry, data source, offline/cache behavior, actions, error recovery, and platforms.
2. Inspect one maintained plugin with the closest surface. Reuse its Qx protocol shape, not its business parser or brand.
3. Create `src/<id>/AGENTS.md`, `README.md`, `manifest.json`, runtime source, and required assets. Keep the Manifest ID, directory, command exports, panel export, localized labels, permissions, and minimum host version consistent.
4. Separate source/service normalization from Workbench projection. Use stable state and generation guards; keep `render()` fast and make `destroy()` exhaustive.
5. Exercise each real HTTP/CLI/invoke path, including at least one plausible failure. For binary HTTP inspect status, final URL, content type/encoding, and leading bytes rather than trusting automatic decoding.

## Update an existing plugin

1. Inspect the complete plugin diff and current release notes before editing.
2. Preserve item/action/storage IDs and cached schema when possible. If a migration is required, make it explicit and bounded.
3. Rebuild generated `index.js` only when the plugin uses build-only source and has a matching package script. Ordinary relative package ESM can ship directly.
4. Bump the plugin version and add the matching localized entry to the repository release-note source when the change is intended for distribution.

## Add or change a host port

1. Prove the capability is shared or foundational; otherwise keep it in the plugin.
2. Define one narrow platform-neutral contract. Keep OS differences behind cfg-gated Rust adapters.
3. Update the TypeScript contract, direct context, unavailable context, iframe SDK/runtime, RPC permission mapping, Rust command registration, documentation, and every first-party consumer.
4. Run Qx `npm run check`; for Rust changes also run `cargo fmt --check` and `cargo check` in `src-tauri/`. Windows-sensitive work additionally follows the repository's single-snapshot Windows workflow rule.

### Card and editing ablation

For changes to the shared card/editor/settings ports, verify the old consumer first, then each new capability in isolation, then the combination. Use the actual host normalizer and serialized SDK in behavioral tests, not a duplicate test-only implementation.

- With new declarations absent, List/Gallery navigation, `onInput`, and preference autosave retain their behavior.
- Cards without an editor remain read-only. Missing images/titles, long content, narrow widths and stable source order are layout cases, not reasons to invent data.
- Editing covers IME, native editing shortcuts, dirty navigation, save failure/conflict, over-limit original text, and late acknowledgements after session replacement or teardown. Assert upstream write counts and exact payloads, not just button labels.
- Manual preference groups retain unsaved input on failure. Connection checks must reflect actual completion or error and never log credentials.
- Finish with the combined reference consumer and installed desktop interaction. Record untested real-service paths as pending; mocked regressions do not satisfy the publication gate.

The Qx repository includes development-only fixtures in `scripts/fixtures/`: serve
`workbench-cards.html` with Vite for responsive typography checks; temporarily install
`native-cards/` as `qx-cards-fixture` for real Shell/Esc/editor behavior with synthetic
notes and explicit save/error/conflict/read-only modes. Neither fixture is a marketplace
package or evidence of a working upstream API. Remove the temporary installed fixture
after verification and preserve any pre-existing installed directory.

## Local package and runtime validation

Use the smallest affected package:

```bash
npm run package:one -- --only=<id>
unzip -t <id>.qx-plugin
```

Run `npm run smoke:<id>` when that script exists. Otherwise run the plugin's documented parser/service check; do not invent a passing generic smoke.

Import the archive through Settings → Extensions → Import, or extract it to `~/.qx/plugins/<id>/` and Rescan/Reload. Verify:

- first open and cached reopen;
- empty/loading/error/retry;
- query, selection, Enter, Actions, Esc, and narrow layout;
- light/dark/low-transparency readability;
- command completion and background state when applicable;
- destroy/reload leaves no timer, request, listener, Island, Tray, or shortcut behind.

## Marketplace validation

Run `npm run store:build` only when catalog/store output is in scope. Confirm the generated index and archive agree on version, permissions, compatibility, checksum, icon, screenshots, and release notes. Generated `store/dist`, cache folders, installed plugin copies, and temporary API responses are not source.

Before committing or publishing, inspect both Qx and qx-plugins status/diff. Do not mix unrelated host changes into a plugin release. A successful local package or store build is not evidence that GitHub/CNB/Cloudflare publication completed.

## Evidence matrix

| Claim | Minimum evidence |
|---|---|
| Contract valid | Qx `npm run check` or the relevant structural gate |
| Plugin packaged | `package:one`/`package:plugins` success plus `unzip -t` |
| Parser works | plugin smoke plus real upstream response |
| Desktop works | imported current archive and exercised the user path |
| Cross-platform works | platform-specific build/runtime evidence, not a macOS-only check |
| Published | remote tag/catalog/archive/store state is complete and externally reachable |

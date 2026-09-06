---
name: qx-plugin-development
description: Build, port, update, review, package, or validate native Qx marketplace plugins against Qx Workbench, Actions, Island, Manifest, permissions, and context ports. Use for work in qx-plugins or when a plugin needs a shared Qx host capability. Do not use for built-in React modules or maintained Raycast-converter work.
---

# Qx plugin development

Build a native Qx plugin whose business intent is isolated from host chrome and platform details. Treat Qx public plugin documents as the protocol source of truth; this skill routes the work and does not duplicate their field catalogues.

## Locate the authoritative worktree

1. Locate the Qx host and the independent `qx-plugins` repository with `git rev-parse --show-toplevel`.
2. Read Qx `AGENTS.md`, `UI_SPEC.md`, `TASK.md`, `docs/architecture-principles.md`, `docs/module-port-inventory.md`, and `public/doc/plugin-development-guide.md` before edits.
3. In `qx-plugins`, read its root `AGENTS.md` and the target `src/<plugin-id>/AGENTS.md`. If the plugin guide is missing, create one that records surfaces, files, invariants, permission reasons, verification, and forbidden shortcuts.
4. When multiple `qx-plugins` checkouts exist, compare remote and commit, choose one authoritative checkout, and edit only that checkout.

## Choose the work mode

- **Create:** define the user-visible capability and data source, then create one `src/<plugin-id>/` package.
- **Port or rewrite:** read the upstream source and preserve its business intent while replacing its runtime/UI with Qx ports. The Raycast converter is frozen and is not a maintained production path.
- **Update:** preserve stable IDs, storage compatibility, and public behavior unless the request explicitly changes them.
- **Host capability:** when multiple plugins need a missing capability, change the Qx port once, update every direct/unavailable/iframe implementation and first-party consumer, and document the contract in the same change.
- **Review:** inspect manifest/runtime parity, permission scope, lifecycle cleanup, Workbench ownership, real upstream evidence, packaging, and user-visible failure recovery without mutating unless asked.
- **Package or publish:** read [the workflow reference](references/workflows.md). Packaging is local; pushing, tagging, marketplace publication, or deployment needs the user's request or an active repository release rule.

## Route to canonical documents

Always read the author handbook. Then read only the protocol documents needed by the task:

- Workbench, Actions, Esc, themes, focus: `public/doc/plugin-ui-guidelines.md`
- Manifest, package, permissions, sources, marketplace: `public/doc/plugin-marketplace.md`
- CLI execution, PATH, jobs, cancellation: `public/doc/plugin-cli-protocol.md`
- CLI-to-Workbench product patterns: `public/doc/plugin-cli-gui.md`
- Tray: `public/doc/plugin-tray.md`
- Runtime and permission boundaries: `public/doc/plugin-system.md`
- Host-side changes: `docs/plugin-architecture.md`, `docs/interface-protocols.md`, and the relevant Rust/IPC documentation
- Bitmap icon work: load the separate `skills/imagegen` skill

Use code to verify drift-prone details. Start with `src/plugin/qxPluginContract.ts`, `workbenchTypes.ts`, `pluginSdkFactory.ts`, `rpcMethods.ts`, the Rust plugin modules, and `qx-plugins/scripts/package-plugins.mjs` as applicable.

## Implementation invariants

- Prefer declarative Workbench List/Cards/Gallery/Detail/Form/Chart. Content-first notes use Cards; image-first collections use Gallery. Use a Custom Panel only when the content cannot be expressed by host structures; it still publishes host Actions and consumes host theme tokens.
- Keep business source normalization, cache, pagination, authentication state, and action side effects inside the plugin. Publish only serializable presentation data; never depend on item DOM residency or host cache files.
- Use stable unique item/action/tab/filter IDs. Let the host own selection chrome, navigation, Enter, Esc, Top/Bottom Bars, About, and responsive layout.
- Paint cached/basic content promptly, refresh in the background, cancel obsolete work, and reject stale generations. `panel.destroy` clears requests, timers, listeners, media caches, and Island/Tray sessions.
- Request the narrowest permissions. Use `context.*`, not direct Tauri APIs, `file://`, platform shell commands, or `navigator.language`.
- Keep visible copy localized through Manifest mappings and `context.locale`; never store credentials, tokens, raw login responses, caches, or logs in the package.
- For HTTP, CLI, invoke, downloads, or third-party services, call every promised upstream path with the final implementation before marketplace publication. Mocks and fixtures are regression evidence only.
- If a public port or permission changes, update its canonical document and all first-party consumers in the same change. Do not patch consumers one by one around a broken port.
- For editable cards, read the editing contract in `public/doc/plugin-ui-guidelines.md`. The host owns draft interaction and correlated acknowledgements; the plugin owns full source text, write authorization, conflict detection and idempotency. Never initialize a write from a truncated preview. Use BluePrint as the first reference consumer, not as a service-specific branch in Qx; a future memos adapter must verify its own upstream contract.
- Connection preferences should use host-declared grouping and explicit save where supported, following `public/doc/plugin-marketplace.md`. A command being dispatched is not proof that authentication succeeded.

## Completion

Follow the mode-specific checks in [references/workflows.md](references/workflows.md). Report separately:

- code/static checks;
- packaged archive integrity;
- local installed runtime behavior;
- real upstream-interface evidence;
- marketplace/store build or public deployment state.

Do not describe an untested package, pending workflow, or local build as published or cross-platform verified.

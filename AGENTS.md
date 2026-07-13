# Qx Project — Agent Guidelines

## Read First

Before any code or documentation edit, read:

1. `UI_SPEC.md` — current UI, theme, layout, interaction, and validation rules.
2. `TASK.md` — current project tasks and known verification status.
3. `AGENTS.md` — this operating guide.

If the request is UI-related, treat `UI_SPEC.md` as the source of truth. Do not invent alternate layout systems or component conventions.

## Working Rules

- Preserve user or concurrent changes. Never revert unrelated dirty files.
- Prefer existing patterns and local helper APIs over new abstractions.
- Keep edits scoped to the request.
- Use `rg` / `rg --files` for search.
- Use `apply_patch` for manual edits.
- Do not introduce generated build artifacts, secrets, temp files, or unrelated formatting churn.

## Architecture

Qx is a Tauri desktop application with a React/TypeScript presentation layer and
a Rust native core. Keep platform differences behind the Rust boundary so that
features, state transitions, and frontend behavior remain identical on macOS and
Windows.

```text
React views / QxShell
        |
typed Tauri invoke commands and events
        |
shared Rust services and domain models
        |
macOS adapter | Windows adapter | portable fallback
```

### Layer Responsibilities

- `src/components/QxShell.tsx` owns the common window frame, keyboard navigation,
  visible actions, action menu, and final keyboard fallback.
- Feature views own feature state and content. They must pass navigation and
  actions into `QxShell`; they must not create competing global key handlers.
- `src/utils/keyboard.ts` owns shortcut parsing, editable-target detection, and
  native editing shortcut protection.
- `src/hooks/useEscBack.ts` owns the cascading Esc protocol.
- `src-tauri/src/lib.rs` is the Tauri composition root. Keep command registration,
  app lifecycle, startup policy, and plugin wiring there; move feature work into
  focused modules.
- Rust feature modules own shared domain behavior, serialization models, storage,
  task orchestration, and public Tauri command semantics.
- Native APIs belong in private `platform` modules or cfg-gated functions. Expose
  the same Rust function signature on every supported platform.

Do not scatter `cfg!(...)` runtime branches through business logic: both branches
are still type-checked. Use `#[cfg(target_os = "macos")]` and
`#[cfg(target_os = "windows")]` on imports, modules, functions, and target-specific
dependencies. Provide a deliberate fallback for other targets when practical.

### Cross-Platform Rust Policy

- Prefer portable Rust APIs and crates for domain work: `std::fs`, `PathBuf`,
  `tokio`, `serde`, `rusqlite`, `image`, and shared HTTP/storage infrastructure.
- Use native APIs only where the portable abstraction loses required semantics.
  Current examples are macOS `NSPasteboard`/Mach/AppKit and Windows
  `CF_HDROP`/Win32 system APIs.
- Put platform-only crates under target dependency sections in
  `src-tauri/Cargo.toml`. A macOS dependency must never be resolved by the Windows
  target, and vice versa.
- Frontend code must not choose native implementations. It invokes one stable
  command and renders one stable response model.
- Commands and filesystem paths must not assume `/usr/bin`, `/System`, drive
  letters, path separators, or one platform's shell. Gate native commands and use
  `Path`/`PathBuf` for path construction.
- Blocking filesystem, media, PowerShell, and native operations must not run on
  the async runtime's core thread. Use async APIs or a blocking task boundary.

### Application Lifecycle

- A newly installed version may show the main interface once for onboarding.
- Normal helper startup, login-item activation, screen wake, and application
  activation must keep Qx in the background.
- Only the configured global summon shortcut (default `Option+Space` on macOS;
  use the corresponding configurable Windows shortcut) may summon the main UI
  after onboarding.
- Treat lifecycle activation and an explicit summon as different events. Do not
  fix focus behavior by showing the main window on every activation or reopen.

## UI Rules

- Qx must feel like a native desktop utility, not a web page inside a window.
  Follow macOS and Windows conventions for density, focus, selection, keyboard
  access, context menus, window behavior, typography, and feedback.
- Prefer compact toolbars, lists, inspectors, split views, dialogs, menus, and
  system-like controls. Avoid website patterns such as hero sections, oversized
  cards, marketing gradients, page-like vertical stacking, decorative banners,
  excessive rounded containers, and hover-only actions.
- Every operation must have an immediate visible response. Preserve selection,
  scroll position, focus, and keyboard continuity while background work runs.
- Main shell is always Top Bar / Main Area / Bottom Bar.
- Bottom Bar uses `grid-template-columns: auto 1fr auto`.
- Bottom Island must be centered relative to the window using `position: absolute; left: 50%; transform: translateX(-50%)`.
- `.qx-shell-bottombar` must be `position: relative`.
- Search is the primary entry point.
- Context Panel is auxiliary; do not put a second main layout inside it.
- Shell, panels, popovers, controls, text colors, borders, radius, and transparency must use CSS variables.
- Do not hardcode component colors in business code.

## shadcn / Theme Rules

- Product controls must use Qx shadcn/Radix components through `src/components/ui.tsx`.
- shadcn source components live in `src/components/shadcn/`.
- ThemeProvider must keep both `data-theme` and `.dark` synchronized.
- Tailwind/shadcn semantic tokens are wired in `src/App.css`; Qx token values are defined in `src/styles/base.css`.
- Keep Qx transparency by mapping shadcn tokens to Qx rgba/surface variables.
- Dark mode must preserve text contrast even at low transparency.
- Do not expose visible native `<select>`, `<input type="range">`, checkbox, or radio appearance.
- Text, number, password, file, and hidden inputs may use native capabilities when visually styled or non-visible.

## Esc Protocol

Every openable module must use `useEscBack` for cascading Esc:

1. `inner`: close detail, preview, popover, output view, or other internal state.
2. `query`: clear module-local search text.
3. `launcher`: close current module and return to launcher.

Example:

```ts
const { onKeyDown } = useEscBack({
  inner: { active: showDetail, close: () => setShowDetail(false) },
  query: { active: !!localQuery, clear: () => setLocalQuery("") },
  launcher: props.onBack,
});
```

Do not copy Esc listeners into modules. Add new sub-states to the `inner` layer.

## QxShell Keyboard Protocol

QxShell is the keyboard foundation for content browsing and clipboard navigation.
Keyboard events flow from the most specific state to the broadest fallback:

1. Native focused controls and text editing retain standard copy, paste, cut,
   select-all, undo, IME, and composition behavior.
2. Open dialogs, previews, popovers, and action menus handle their own keys.
3. The feature view handles its Esc cascade and feature-only commands.
4. `QxShell.navigation` handles list movement and disclosure.
5. QxShell runs visible action shortcuts and its final Esc action.

Use the standard navigation mapping:

- `ArrowUp` / `ArrowDown`: previous or next item.
- `PageUp` / `PageDown`: move by the configured page size.
- `Home` / `End`: first or last item when focus is not editing text.
- `ArrowRight`: open details or preview.
- `ArrowLeft`: close details or preview.
- `Enter`: execute the primary/open action supplied by the feature.
- `Cmd+K` on macOS or `Ctrl+K` on Windows: open the shell action menu.

Never add a process-wide Esc monitor to compensate for a missing feature handler.
A global monitor can steal Esc from system dialogs, editors, IME, menus, and other
applications. Fix the responder/focus chain and QxShell composition instead.

Shortcut labels must reflect the current platform. Do not hardcode macOS glyphs
as the only discoverable Windows instructions. Preserve native editing shortcuts
through `isNativeEditingShortcut` and bare-key guards in `src/utils/keyboard.ts`.

## Clipboard Architecture

Clipboard history is a shared Rust feature, not a text-only frontend cache.

- Preserve clipboard item kinds explicitly: text, image, file list, and supported
  rich content. Do not coerce file clipboard contents into plain path text.
- File items must retain normalized real paths and be written back with native
  file clipboard semantics: `NSPasteboard` file URLs on macOS and `CF_HDROP` on
  Windows. Copying an item must allow Explorer/Finder and other apps to receive
  the actual file.
- Validate file existence at use time. Historical entries may point to moved or
  deleted files; surface that state without deleting unrelated history.
- Metadata extraction belongs in Rust and is asynchronous. Return a stable model
  containing available basics such as name, extension/type, byte size, modified
  time, image dimensions, and media duration. Missing metadata is not a failure
  for the whole clipboard item.
- Preview uses the selected file's real local URL converted by
  `convertFileSrc()`. Never concatenate or render a raw `file://` URL.
- Windows paths may contain drive prefixes, UNC prefixes, spaces, and non-ASCII
  characters. Keep them as `PathBuf`/UTF-16 at the Win32 boundary; do not parse
  them by splitting on `/` or `:`.
- Clipboard change detection is platform-specific (`NSPasteboard.changeCount` or
  `GetClipboardSequenceNumber`) but feeds the same capture/deduplication pipeline.
- Clipboard polling/capture must ignore Qx's own write-back when appropriate and
  must not block the UI thread.

### File Processing Tasks

Image compression, video-to-GIF conversion, and future file operations use one
shared asynchronous Rust task contract:

```text
queued -> running(progress) -> succeeded(output item) | failed(error) | cancelled
```

- Generate outputs without overwriting the source unless the user explicitly
  requests replacement.
- Emit task id, operation, progress, status, and output/error updates to the
  frontend. Progress must be real or explicitly indeterminate, never simulated.
- On success, collect output metadata, persist it, and insert the new file item
  into clipboard history/copy queue immediately.
- Cancellation and failures must leave the source and clipboard database valid.
- Keep codec/process discovery platform-aware. A shared task API may call a
  bundled or discovered FFmpeg executable, but must not assume a Unix binary path.

## Tauri And Backend Rules

- Frontend/backend calls use `@tauri-apps/api/core` `invoke`.
- Convert local file paths with `convertFileSrc()` before rendering.
- Do not use direct `file://` URLs.
- System monitoring exposes one shared response model. macOS may use Mach APIs
  (`host_processor_info`, `host_statistics64`); Windows uses Win32 equivalents
  such as `GetSystemTimes` and `GlobalMemoryStatusEx`. A portable crate is allowed
  when it preserves the required accuracy and packaging behavior.
- RSS parsing, storage, refresh state, and frontend models are cross-platform.
  Do not launch a platform shell or browser merely to fetch or parse a feed.
- Basic system information must use a shared model with cfg-gated collectors.
  Platform-only fields are optional rather than reasons to fork frontend views.
- Network, downloads, plugin installs, model fetches, and API calls must be real. Do not simulate success.

## Responsiveness And Concurrency

Core features must never block window rendering, input handling, navigation, or
clipboard capture. Treat responsiveness as a correctness requirement.

- Do not run network requests, database migrations or large queries, directory
  walks, metadata probing, hashing, archive work, media encoding, model loading,
  PowerShell, or child-process waits on the UI thread.
- Tauri async commands may coordinate async I/O. CPU-heavy or blocking work must
  use `spawn_blocking`, a worker thread, or a managed task queue with bounded
  concurrency.
- Return quickly with cached/basic content or a task id, then deliver incremental
  state through events or explicit polling. Loading must not replace usable cached
  content unless stale content would be unsafe.
- Debounce high-frequency search and clipboard signals, cancel obsolete work, and
  prevent slow older results from replacing newer selections or queries.
- Keep locks short and never hold a mutex across `.await`, native callbacks,
  frontend event emission, filesystem traversal, or child-process execution.
- Use bounded queues and backpressure for clipboard capture, thumbnails, metadata,
  RSS refresh, and file processing. Avoid spawning an unbounded task per item.
- Progress indicators must not cause Shell layout shifts. Errors and cancellation
  remain local to the operation; launcher and clipboard navigation stay usable.
- Validate perceived behavior as well as compilation: summon Qx, type immediately,
  navigate a populated list, open/close preview, copy a real file, and start a
  background task while continuing to use the interface.

## Validation

Run the smallest useful verification set for the change:

- TypeScript/UI: `npx tsc --noEmit`.
- Frontend build/theme/bundling: `npm run build`.
- Rust formatting: `cargo fmt --check` in `src-tauri/`.
- Rust compile: `cargo check` in `src-tauri/`.
- Windows-sensitive Rust changes: confirm the `Windows Compatibility` Action
  passes both `cargo check --target x86_64-pc-windows-msvc` and the real Tauri
  NSIS bundle build. A local macOS `cargo check` is not Windows verification.
- Native control scan when UI controls change: `rg '<select|type="range"|type="checkbox"|type="radio"' src`.

Record any skipped validation and why.

When a push touches Rust, Tauri configuration, dependencies, clipboard behavior,
system information, RSS, filesystem handling, or workflows, inspect the Windows
Action through completion. If it fails, read the failing job logs, fix the first
root compiler/packager error, push, and monitor the replacement run. Do not report
Windows compatibility based only on workflow dispatch or an in-progress job.

## Release Checklist

Only run this when the user asks to release, tag, or publish.
For the full operational flow, credential fallbacks, remote confirmation, and
post-push dirty-worktree handling, follow `public/doc/release-workflow.md`.

1. Review all changes:
   - `git status --short`
   - `git diff --stat`
   - inspect tracked and untracked files.
2. Choose the next unused version:
   - `git tag --list 'v*' --sort=-version:refname | head`
   - `git ls-remote --tags origin 'v*'`
3. Sync version files:
   - `package.json`
   - `package-lock.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
   - `README.md`
4. Validate:
   - `npx tsc --noEmit`
   - `npm run build`
   - `cargo fmt --check` in `src-tauri/`
   - `cargo check` in `src-tauri/`
5. Commit and tag:
   - `git add ...`
   - `git diff --cached --check`
   - `git commit -m "vX.Y.Z: <summary>"`
   - `git tag vX.Y.Z`
6. Push:
   - `git push origin main`
   - `git push origin vX.Y.Z`
7. Confirm GitHub Actions release workflow and GitHub Release artifact.

Do not move an already-pushed release tag unless the user explicitly asks to rewrite release history.

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

## UI Rules

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

## Tauri And Backend Rules

- Frontend/backend calls use `@tauri-apps/api/core` `invoke`.
- Convert local file paths with `convertFileSrc()` before rendering.
- Do not use direct `file://` URLs.
- System monitor data uses Mach APIs (`host_processor_info`, `host_statistics64`), not `sysinfo`.
- Network, downloads, plugin installs, model fetches, and API calls must be real. Do not simulate success.

## Validation

Run the smallest useful verification set for the change:

- TypeScript/UI: `npx tsc --noEmit`.
- Frontend build/theme/bundling: `npm run build`.
- Rust formatting: `cargo fmt --check` in `src-tauri/`.
- Rust compile: `cargo check` in `src-tauri/`.
- Native control scan when UI controls change: `rg '<select|type="range"|type="checkbox"|type="radio"' src`.

Record any skipped validation and why.

## Release Checklist

Only run this when the user asks to release, tag, or publish.

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

# Home Island

Idle launcher bottom HUD modes. Modes are **registered**, not hard-wired into Launcher or Settings.

Docked chrome and session priority live in **`src/island/`** (see `docs/qx-island-architecture.md`). Home modes are **content-only** — no absolute positioning or outer width/height.

## Layout

```text
home-island/
  index.ts              public API
  types.ts              definition + appearance contracts
  registry.ts           register / list / normalize
  catalog.ts            built-in mode registration
  resolve.ts            idle → shell content | custom node (+ modeId)
  HomeIslandSettings.tsx settings grid driven by registry
  shared.ts             sampling helpers
  modes/
    *Mode.tsx           definition (+ optional Settings)
    *Island.tsx         content-only UI (no chrome size)
```

Runtime dock path:

```text
Launcher useHomeIslandContribution
  → islandHost.show({ id: "home", priority: "home", componentId? })
  → QxIslandDockHost → QxIslandSurface + registered component | ShellContent
```

Settings appearance preview wraps `customNode` in a **local** `QxIslandSurface` and does **not** write the global `home` session.

## Add a mode

1. Implement content UI: `modes/FooIsland.tsx`  
   Root class may use content helpers (`qx-island-content`); **do not** set `position: absolute`, outer width, or height.
2. Define:

```ts
// modes/fooMode.tsx
import type { HomeIslandDefinition } from "../types";
import FooIsland from "./FooIsland";

export const fooHomeIsland: HomeIslandDefinition = {
  id: "foo",
  order: 70,
  titleKey: "appearance.homeIsland.foo",
  titleFallback: "Foo",
  hintKey: "appearance.homeIsland.foo.hint",
  hintFallback: "Short description",
  preview: "FOO",
  kind: "custom", // or "shell" + resolveShellContent
  Component: FooIsland,
};
```

3. Register in `catalog.ts` and, for custom modes, `src/island/home/registerHomeComponents.tsx` as `home.foo`.
4. Add zh strings in `src/i18n.ts`.

**Do not** edit `Launcher.tsx` or `AppearanceSettings.tsx` for new modes.

## Consumers

| Consumer | API |
|---|---|
| Launcher | `useResolvedHomeIsland` + `useHomeIslandContribution` (idle only) |
| Appearance settings | `<HomeIslandSettings />` + local Surface preview on settings shell |

- `home_island_mode` — primary / last-focused mode (compat)
- `home_island_modes` — multi-select list; length > 1 auto-rotates
- `home_island_rotate_secs` — interval (0 = pin first only, default 8)

Unknown mode ids fall back to the default registered mode.

## Async data (non-blocking)

Metrics never block paint or search. Bus remains in `home-island/data/`.

```text
modes/*  ──subscribe──►  data/bus  ──idle/timer──►  Tauri invoke (spawn_blocking)
   ▲                         │
   └── useSyncExternalStore ─┘  (read cache only)
```

Hooks: `useIslandStats` · `useIslandPower` · `useIslandNet` · `useIslandData([...])`.

# Home Island

Idle launcher bottom HUD. Modes are **registered**, not hard-wired into Launcher or Settings.

## Layout

```text
home-island/
  index.ts              public API
  types.ts              definition + appearance contracts
  registry.ts           register / list / normalize
  catalog.ts            built-in mode registration
  resolve.ts            idle → shell content | custom node
  HomeIslandSettings.tsx settings grid driven by registry
  shared.ts             sampling helpers
  modes/
    *Mode.tsx           definition (+ optional Settings)
    *Island.tsx         UI implementation
```

## Add a mode

1. Implement UI: `modes/FooIsland.tsx`
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
  // Settings?: optional extra toggles when selected
};
```

3. Register in `catalog.ts`:

```ts
registerHomeIsland(fooHomeIsland);
```

4. Add zh strings in `src/i18n.ts` for the title/hint keys.

**Do not** edit `Launcher.tsx` or `AppearanceSettings.tsx` for new modes.

## Consumers

| Consumer | API |
|---|---|
| Launcher | `useResolvedHomeIsland(appearance, t)` when idle (supports multi-mode rotate) |
| Appearance settings | `<HomeIslandSettings />` multi-select + live preview on settings shell island |

- `home_island_mode` — primary / last-focused mode (compat)
- `home_island_modes` — multi-select list; length > 1 auto-rotates
- `home_island_rotate_secs` — interval (0 = pin first only, default 8)

Unknown mode ids fall back to the default registered mode.

## Async data (non-blocking)

Metrics never block paint or search.

```text
modes/*  ──subscribe──►  data/bus  ──idle/timer──►  Tauri invoke (spawn_blocking)
   ▲                         │
   └── useSyncExternalStore ─┘  (read cache only)
```

- First sample is scheduled with `requestIdleCallback` (fallback `setTimeout(0)`).
- Channels are interest-counted; only mounted modes poll.
- Document hidden → timers pause.
- In-flight guard skips overlapping samples.
- UI always renders placeholders (`--`) until the first successful sample.

Hooks: `useIslandStats` · `useIslandPower` · `useIslandNet` · `useIslandData([...])`.

# Tray Surface Design

Qx has two Tray surfaces with different jobs:

- The right-click native menu is for conventional commands, keyboard equivalents, and short live status rows.
- The left-click Tray Surface is a transient host-rendered panel for sliders, grids, richer status, and short descriptions.

The two surfaces consume the same ordered `settings.tray_actions` list. Enabled
built-in status entries become status rows in the left-click surface, while each
contiguous run of ordinary actions becomes a shortcut grid in that exact list
position. Provider controls are appended as standard host-rendered cards. The
settings page is therefore the single source of truth for visibility and order;
there is no second left-click menu configuration.

The Tray Surface is transient: its close button only hides the Tray window and never
summons the main launcher. The host starts a 2.4 second grace period when the pointer
leaves the surface (or the surface loses focus); re-entering the panel cancels that
timer. This keeps slider interaction uninterrupted while allowing a panel opened
under the menu bar to dismiss itself when the pointer moves away.

Plugins contribute declarative `surfaceProviders`. Qx resolves a registered lightweight adapter, reads the native/core service directly, and renders standard components. Merely showing Tray or Home must not create the plugin iframe/runtime.

## Open-source references

- [MonitorControl](https://github.com/MonitorControl/MonitorControl) uses one block per display, a 180 pt slider, roughly 13 pt block margins, and a compact icon footer. It supports combined, separate, and relevant-display modes instead of showing every control unconditionally.
- [Stats](https://github.com/exelban/stats) separates each monitored module and lets users disable expensive modules, reinforcing Qx's provider-level lifecycle and polling policy.
- [SwiftBar](https://github.com/swiftbar/SwiftBar) treats menu content as declarative output, which maps to Qx's manifest/provider/host-renderer boundary.
- Apple's [Popover guidance](https://developer.apple.com/design/human-interface-guidelines/popovers) treats popovers as transient views and recommends direct access without unnecessary extra gestures.

These projects are references for behavior and density, not component dependencies or visual assets.

## Size presets

All values are logical points. The host chooses the widest enabled provider preference and measures height from visible rows.

| Preset | Width | Intended content | Shortcut columns |
|---|---:|---|---:|
| `compact` | 288 | actions, status, one small control | 2 |
| `standard` | 360 | sliders, two or three control cards | 3 |
| `wide` | 440 | mixed controls, grids, longer descriptions | 4 |

Panel chrome is 40 pt header, 38 pt footer, 8 pt content padding, and 6 pt inter-group gap. Height is clamped to 150–520 pt; overflow scrolls inside the content region.

## Standard rows

| Row | Height | Layout |
|---|---:|---|
| Action | 34 | 28 pt leading icon, flexible title, 56–112 pt trailing value/shortcut |
| Action with description | 46 | same columns; secondary text is 11 pt and no more than two lines |
| Status | 32 | non-clickable action geometry with tabular trailing value |
| Control card | 68 | title/value header plus control body; suited to sliders |
| Shortcut tile | 64 | minimum 88 pt width; icon, title, optional two-line description |
| Section label | 22 | quiet secondary label above a related group |

The reusable implementation is `src/tray/surface.ts`, `src/tray/TraySurface.tsx`, and `src/styles/tray-panel.css`. Feature code supplies data and callbacks; it must not define alternate panel geometry.

## Provider contract

`surfaceProviders[].presentation` is `compact`, `standard`, or `wide`. A provider source is accepted only when Qx registers a matching adapter in `src/plugin/surfaceProviders.ts` and validates it in the Rust manifest boundary. The adapter owns reads and mutations against a core service; the Tray renderer owns polling cadence, optimistic state, keyboard/accessibility behavior, and visual composition.

Home may consume the same adapter snapshot, but it renders Home cards rather than embedding Tray DOM. Opening the full plugin panel remains an explicit user action and is the point where Qx may lazily start the plugin runtime.

Brightness mutations are optimistic in the control surface but are written to
the native display service through a latest-target ramp: each hardware write
moves only 1–3 percentage points, with roughly 28 ms between steps. New drag
positions replace the queued target, so stale intermediate pointer values never
accumulate and the display reaches the final value without a visible flash.

## Display focus

When the left-click Tray panel opens, the host resolves the click position to the
corresponding native display and publishes that display id to the panel. The
brightness provider orders that display first, so the control nearest to the
user's click is immediately available while the remaining supported displays
stay available below it. The host keeps this focus in a small process-local
value and exposes `tray_panel_get_focus_display` for a panel that is already
mounted; the `tray-focus-display` event updates it on subsequent Tray opens. On
macOS, placement uses Tauri's canonical physical cursor position rather than
the status-item event's scaled coordinate, so a menu-bar click on an external
display is resolved and clamped within that display's work area.

Fix 3 Rust and 5 TS build errors in Qx project at /Users/mcx/Documents/OpenSpring/Qx.

RUST ERRORS (src-tauri/src/):
1. screenshot.rs line 66: crop_imm() not on xcap image. Fix: use `image::imageops::crop(&mut image, x, y, width, height).to_image()` instead of `image.crop_imm(x, y, w, h)`. The xcap::image crate is the `image` crate internally.

2. lib.rs line 27: global_shortcut() method not found. Fix: add `use tauri_plugin_global_shortcut::GlobalShortcutExt;` at the top, then change `app.global_shortcut().register(...)` to use `handle.global_shortcut().register(...)` inside the setup closure since `app` is `&mut tauri::App` and doesn't have the method directly.

3. lib.rs line 31: on_shortcut_event() method not found. Fix: `on_shortcut_event` is on the GlobalShortcutHandle (returned by `global_shortcut()`), not on App directly. Use `handle.global_shortcut().on_shortcut_event(...)`.

TS ERRORS:
1. src/App.tsx line 10: remove `visible` from destructuring, or prefix with underscore
2. src/App.tsx line 15: onVisibilityChanged does not exist on Window type - use onFocusChanged instead
3. src/App.tsx line 23: add type for unlisten parameter: `(f: () => void)`
4. src/ScreenshotPanel.tsx: remove unused copyToClipboard function and img variable entirely

Do NOT read files outside ~/Documents/OpenSpring/Qx/. Work only in this directory.

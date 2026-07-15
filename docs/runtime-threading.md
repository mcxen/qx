# Runtime 线程模型（主线程 UI + 多线程算力）

> 状态：Current · 适用版本：v0.5.25+ · Owner：Core  
> 实现：`src-tauri/src/runtime/` · 兼容别名：`main_thread::run_on_main`

## 1. 问题

| 线程 | 谁在跑 | 可以做什么 |
|---|---|---|
| **Main / UI** | Tauri event loop · AppKit / Win32 消息泵 | 窗口 show/hide/orderFront/setLevel、NSPasteboard、焦点 |
| **Tokio worker** | 多数 `async fn` `#[command]` | 编排、await、轻量逻辑 |
| **Blocking pool** | `spawn_blocking` / `runtime::blocking` | 编码、磁盘、同步 HTTP、大图处理 |

**禁止**：在 worker 上直接调 AppKit → macOS `SIGTRAP`（日志：`Must only be used from the main thread`）。

历史崩溃栈：

- 截图恢复：`show_and_navigate` → `show_floating` → `orderFront`
- 开始录制：`controls::show` → `promote` → `setWindowLevel`

## 2. 系统能力 API

```text
crate::runtime
├── install(app)           // setup 时钉死主线程 id（跨平台）
├── is_main()
├── run_ui(app, f)         // 同步 hop（兼容旧 run_on_main）
├── ui(app, f).await       // 异步 hop（async command 优先）
├── spawn_ui(app, f)       // fire-and-forget
├── run_ui_timeout(...)
└── blocking(f).await      // 算力 / IO，禁止 UI
```

`install` 在 `lib.rs` `setup` 最早调用，用 Tauri `run_on_main_thread` 记录 `ThreadId`，**不依赖** macOS 专用 `NSThread`。

## 3. 模块命令标准写法

```rust
#[command]
pub async fn feature_do_thing(app: AppHandle, input: In) -> Result<Out, String> {
    // A. 纯逻辑 / 校验 — 当前 async worker，OK
    let plan = validate(input)?;

    // B. 重活 — blocking pool，OK；禁止碰窗口
    let artifact = runtime::blocking(move || encode_or_read(plan))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e)?; // if inner Result

    // C. 一次 UI 事务 — 主线程；合并 show/hide/navigate/clipboard
    let app2 = app.clone();
    runtime::ui(&app, move || {
        floating_panel::show_and_navigate_now(&app2, "screencap");
        // …其它 surface 变更…
        Ok(artifact)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

### 规则

1. **UI 变更合并**：一次用户可见切换 = **一次** `ui` / `run_ui`，不要 `hide`  hop + `show` hop + `promote` hop。
2. **blocking 里禁止**：`WebviewWindow::show/hide`、`ns_window`、剪贴板写图、`set_focus`。
3. **已在主线程**（快捷键回调）：`run_ui` / `ui` 直接 inline，不二次排队。
4. **模块边界**：surface 的 `*_now`（如 `show_floating_now`）只给「已在 UI 事务内」调用；对外仍走会 hop 的包装。

## 4. 与 SOLID 对齐

| 原则 | 落点 |
|---|---|
| **S** | `runtime` 只做调度；screencap 只做捕获工作流 |
| **O** | 新模块只依赖 `runtime::{ui,blocking}`，不改 event loop |
| **D** | Feature 依赖调度抽象，不直接 `NSThread` / `dispatch_async` |
| **I** | 窄 API：UI vs blocking 分开，没有「万能 spawn」 |

## 5. 迁移清单

| 区域 | 状态 |
|---|---|
| `floating_panel` show/hide/navigate | 已 hop |
| `screencap` controls / picker / selection / start_recording | 已 hop |
| `island_window` show/hide | 已 hop |
| 新 async command 默认模板 | 用 `runtime::ui` + `runtime::blocking` |
| 旧 `main_thread::run_on_main` | 兼容 shim → `runtime::run_ui` |

## 6. 验证

- 截图 / 开始录制 / 停止录制后进程不退出（无新 `qx-*.ips` SIGTRAP）。
- `cargo check` + `cargo test --lib screencap`。
- 需要主线程断言时：在 UI 闭包内 `debug_assert!(runtime::is_main())`（可选）。

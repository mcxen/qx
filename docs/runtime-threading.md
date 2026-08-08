# Runtime 线程模型（主线程 UI + 多线程算力）

> 状态：Current · 适用版本：v0.5.25+ · Owner：Core  
> 实现：`src-tauri/src/runtime/` · 兼容别名：`main_thread::run_on_main`

## 1. 问题

| 线程 | 谁在跑 | 可以做什么 |
|---|---|---|
| **Main / UI** | Tauri event loop · AppKit / Win32 消息泵 | 窗口 show/hide/orderFront/setLevel、NSPasteboard、焦点 |
| **Tokio worker** | 多数 `async fn` `#[command]` | 编排、await、轻量逻辑 |
| **Blocking pool** | `spawn_blocking` / `runtime::blocking` | 编码、磁盘、同步 HTTP、大图处理 |

宏录制的原生 hook / event tap 不属于截图的永久指针监听器。`MacroCaptureSession`
为每次录制创建独立 native capture thread 和一个容量为 4096 的有界原始事件队列；
OS 回调只读取必要的 raw key code / 坐标并 `try_send`，不做键盘布局转换、数据库操作
或业务锁。worker 线程负责事件解释和录制状态，stop 路径先禁用并卸载原生源，再 join
capture thread 和 worker；macOS 的 event tap、run-loop source、Mach port 由创建线程
完整移除和 `CFRelease`。

**禁止**：在 worker 上直接调 AppKit → macOS `SIGTRAP`（日志：`Must only be used from the main thread`）。

历史崩溃栈：

- 截图恢复：`show_and_navigate` → `show_floating` → `orderFront`
- 开始录制：`controls::show` → `promote` → `setWindowLevel`

## 2. 系统能力 API

```text
crate::runtime
├── install_async_runtime() // Builder 前：cap Tokio worker/blocking + keep-alive
├── install(app)            // setup 时钉死主线程 id（跨平台）
├── is_main()
├── run_ui(app, f)          // 同步 hop（兼容旧 run_on_main）
├── ui(app, f).await        // 异步 hop（async command 优先）
├── spawn_ui(app, f)        // fire-and-forget UI
├── run_ui_timeout(...)
├── blocking(f).await       // Tokio blocking pool（禁止 UI）
└── pool::                   // 有界后台池（空闲自动退出 OS 线程）
    ├── spawn / try_spawn
    ├── spawn_after(delay)  // 单 timer 线程 + pool 执行
    └── spawn_media         // 并发 cap=2（压缩/ffmpeg）
```

### 线程预算（防 macOS 卡顿）

| 池 | 上限 | 空闲退出 |
|---|---|---|
| Tokio workers | `clamp(2, 8)` × CPU | 否（固定） |
| Tokio blocking | `clamp(8, 32)` | **是**（keep-alive 10s） |
| `runtime::pool` | `clamp(2, 8)` 动态 | **是**（idle 12s） |
| 守护线程 | 每种一个（clipboard / OCR / monitor…） | 进程级 |

**禁止**对短任务 `std::thread::spawn`：每次新建 OS 线程且不回收，剪贴板/OCR debounce/
媒体编码会把线程数打爆。对齐 Tokio / 开源实践：有界池 + idle keep-alive。

`install_async_runtime` 在 `lib.rs` `run()`、**Tauri Builder 之前**调用。  
`install` 在 `setup` 最早调用，用 Tauri `run_on_main_thread` 记录 `ThreadId`。

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

# 运行时接口与通信协议

> 状态：Current · Owner：Core · 最后复核：2026-08-31

本文是 Qx 进程内依赖、Tauri IPC、事件流与跨平台生命周期的底层协议总图。
命令逐项清单仍以 [`ipc-catalogue.md`](./ipc-catalogue.md) 为准。

## 1. 单向依赖

```text
React / feature / plugin projection
              ↓
domain contracts + narrow frontend ports
              ↓
Tauri invoke / correlated events / iframe RPC
              ↓
shared Rust domain services
              ↓
#[cfg] macOS adapter | #[cfg] Windows adapter | portable fallback
```

- Type/数据契约放在中立文件，不得从 cache、adapter 或 renderer 反向引用 store。
- catalogue 只构造描述数据；registry 负责状态写入。catalogue 不得导入 registry。
- iframe RPC 通过 `PluginRuntimeOptions` 注入命令调度器，不得读取全局 registry。
- Island 等跨域能力依赖 `session/hostApi`，不从包含 React surface 的 barrel 反向导入。
- `npm run check` 会扫描运行时 import 图；任何强连通环都直接失败。

## 2. IPC 请求协议

- 前端只通过 `@tauri-apps/api/core` 的 `invoke` 调用稳定命令名。
- Rust 命令必须出现在 `tauri::generate_handler!`；字面量 `invoke("...")` 会由
  `scripts/check-interface-protocols.mjs` 自动与注册表核对。
- 前端参数用 camelCase，Rust 参数用 snake_case，由 Tauri 做边界转换；路径始终作为
  字符串传给 Rust 后立即进入 `Path` / `PathBuf`，不得按 `/`、`:` 或盘符手工拆分。
- 可即时完成的查询返回 `Result<T, String>`。长任务返回 task/request id，再通过带同一 id
  的事件或显式 poll 收敛到 succeeded / failed / cancelled / timeout。
- listener、timer、in-flight 标记必须在所有终态清理；旧 request id 的迟到事件不得覆盖新状态。

## 3. 启动、隐藏与重启协议

| 输入 | 行为 |
|---|---|
| 显式启动 / 更新器重启 | 前端通过 `claim_initial_window_show` 原子认领一次初始展示 |
| `--autostart` 登录启动 | 保持后台，不消费初始展示 claim |
| 同进程 WebView 重挂载 / HMR | claim 已消费，不再次 `floating_show` 或抢焦点 |
| 第二进程 / deep link | single-instance 转发给现有进程；仅非 autostart 输入显示窗口 |
| 关闭主窗口 | 隐藏可复用 WebView，不销毁 Rust helper |
| 更新应用 | helper 成功接管后才 `force_quit`；旧 watchdog 参数只退出兼容进程，不重启主程序 |

窗口显示、隐藏、toggle、焦点恢复只走 `floating_panel` 状态机。业务模块不得直接创建
第二套主窗口生命周期，也不得以固定 sleep 猜测系统焦点或重启完成。

## 4. macOS / Windows 边界

- AppKit、TIS、窗口材质与 UI 对象只能通过 `runtime::ui` / `run_ui` 进入主线程。
- Win32、PowerShell、文件系统、数据库、媒体与子进程等待进入 bounded blocking pool；
  子进程必须有硬超时并终止进程树。
- 平台差异使用编译期 `#[cfg(target_os = ...)]`，对前端暴露同名命令和同形响应；
  禁止在业务层用 `cfg!(...)` 让两个平台实现同时参与类型检查。
- Windows 路径保留 UTF-16 / `PathBuf` 语义；macOS 权限、NSPanel 和剪贴板细节停留在 adapter。
- 窗口 capability 必须覆盖静态和动态 label；前端无法用未授权窗口绕过 IPC 边界。

## 5. 故障判定与验证

协议故障按边界定位：import-cycle（求值顺序/TDZ/HMR）、invoke drift（命令未注册）、
event drift（request id/终态/cleanup）、lifecycle drift（autostart/single-instance/显式启动
混用），以及 platform drift（线程、路径、窗口 capability 或 `#[cfg]` 不对称）。

最小验证为 `node scripts/check-interface-protocols.mjs`、`npx tsc --noEmit`、
`cargo test startup::tests`。跨多文件修改最终运行 `npm run check`、`npm run build`、
`cargo fmt --check`、`cargo check`；Windows 原生行为仍以 Windows Compatibility Action
或真实 Windows bundle 为准，macOS 本机编译不能替代该证据。

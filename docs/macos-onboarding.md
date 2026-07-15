# macOS 首次启动引导（权限）

> 状态：Current · 适用版本：v0.5.24+ · Owner：Core

## 目标

第一次打开 Qx 时，用最短路径让核心能力可用：

1. **完全磁盘访问权限（Full Disk Access）** — 一次性授予，覆盖完整文件搜索。
2. **可选权限** — 辅助功能（剪贴板自动粘贴）、屏幕录制、输入监听；可跳过或批量启用。

设计参考开源 [inket/FullDiskAccess](https://github.com/inket/FullDiskAccess)：探测受保护路径判断 FDA，再打开「系统设置 → 隐私与安全性」对应页，由用户手动开关。

## 流程

```
Welcome → Full Disk Access → Optional features → Done
                │                    │
                │ skip               │ skip / enable selected
                └────────────────────┴─→ 写入 has_completed_onboarding
```

| 步骤 | 内容 | 可跳过 |
|---|---|---|
| Welcome | 说明引导目的 | 可「跳过设置」直接结束 |
| Files | FDA 检测 + 打开 System Settings + 轮询状态 | 是 |
| Optional | Accessibility / Screen Recording / Input Monitoring 多选 | 是 |
| Done | 状态摘要 + 默认快捷键提示 | — |

## 实现落点

| 层 | 文件 | 职责 |
|---|---|---|
| Rust 权限 | `src-tauri/src/permissions.rs` | FDA 探测、TCC 状态、request / request_all / open_settings |
| Rust 窗口 | `src-tauri/src/floating_panel.rs` | `ONBOARDING_ACTIVE` 抑制 blur 自动隐藏 |
| 设置 | `general.has_completed_onboarding` | 完成后持久化；旧安装若已有 `has_shown_launcher` 则软迁移为已完成 |
| UI | `src/modules/onboarding/OnboardingWizard.tsx` | 分步向导 |
| 设置页 | `src/modules/settings/PermissionSettings.tsx` | 后续可再次申请（含 FDA + 全部请求） |
| 启动 | `src/App.tsx` | 首次 macOS 启动展示向导 |

## 权限与功能映射

| Permission id | 功能 |
|---|---|
| `full-disk-access` | 文件搜索覆盖 Mail / Messages / Safari 等受保护路径 |
| `accessibility` | 剪贴板历史 ⌘V 自动粘贴、宏回放 |
| `screen-recording` | 截图 / MP4·MOV 录屏 |
| `input-monitoring` | 宏事件录制 |

## 不变量

- FDA **不能**由应用代开开关；只能 `open` 到 Privacy 面板并轮询。
- 引导期间主窗口不得因失焦自动隐藏（用户正在系统设置里操作）。
- 非 macOS：自动把 `has_completed_onboarding` 标为 true，不展示向导。
- 跳过不等于失败；启动器仍可用，仅能力降级。

## 手动验证

1. 清空或新建 `has_completed_onboarding: false`（且为 macOS）→ 启动应出现向导。
2. FDA 步骤：打开系统设置后打开 Qx 开关，向导状态应变为已授权。
3. 可选步骤：仅勾选辅助功能 →「启用所选」打开对应面板。
4. 跳过全部 → 可进入 Launcher；设置 → 权限 仍可补授。
5. 完成后重启 → 不再出现向导；blur 自动隐藏恢复正常。

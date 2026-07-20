# macOS 首次启动引导（权限）

> 状态：Current · 适用版本：v0.6.0+ · Owner：Core

## 目标

第一次打开 Qx 时，用最短路径让核心能力可用：

1. **完全磁盘访问权限（Full Disk Access）** — 由用户在系统设置中授予，使 Qx
   能搜索当前系统允许应用访问的受保护目录。
2. **可选权限** — 辅助功能（剪贴板自动粘贴）、屏幕录制、输入监听；可跳过或批量启用。

设计参考开源 [inket/FullDiskAccess](https://github.com/inket/FullDiskAccess)：探测受保护路径判断 FDA，再打开「系统设置 → 隐私与安全性」对应页，由用户手动开关。

## 流程

```
Welcome → Full Disk Access → Optional features → Done
                │                    │
                │ skip               │ skip / enable selected
                └────────────────────┴─→ 写入完成状态 + 引导协议版本
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
| Rust 窗口 | `src-tauri/src/floating_panel.rs` | `ONBOARDING_ACTIVE` 与 `EXTERNAL_INTERACTION_ACTIVE` 抑制 blur 自动隐藏 |
| 文件搜索 | `src-tauri/src/file_search/platform_macos.rs` | 未获 FDA 时只用 Spotlight；检测到 FDA 后一次性启动完整索引 |
| 设置 | `general.has_completed_onboarding` + `permission_onboarding_version` | 持久化完成状态与当前引导协议版本 |
| UI | `src/modules/onboarding/OnboardingWizard.tsx` | 分步向导 |
| 设置页 | `src/modules/settings/PermissionSettings.tsx` | 后续可再次申请（含 FDA + 全部请求） |
| 启动 | `src/App.tsx` | 首次 macOS 启动或引导协议升级后展示一次向导 |

## 权限与功能映射

| Permission id | 功能 |
|---|---|
| `full-disk-access` | 文件搜索覆盖 Mail / Messages / Safari 等受保护路径 |
| `accessibility` | 剪贴板历史 ⌘V 自动粘贴、宏回放 |
| `screen-recording` | 截图 / MP4·MOV 录屏 |
| `input-monitoring` | 宏事件录制 |

## 不变量

- FDA **不能**由应用自动授予；只能打开 Privacy 面板并轮询。FDA 也不绕过 SIP、
  系统只读卷或其他 macOS 安全边界，不能宣传为“不受限制地访问每个磁盘字节”。
- 未获 FDA 时后台文件搜索不得主动遍历 Documents、Desktop 等目录触发零散 TCC
  弹窗；只使用 Spotlight。轮询首次确认 FDA 后，在不重启 Qx 的情况下启动完整索引。
- 引导、系统权限面板和系统文件/文件夹选择器期间，主窗口不得因失焦自动隐藏。外部
  操作完成且 Qx 重新获得焦点后，恢复正常 Esc 阶梯与点击窗口外隐藏。
- `permission_onboarding_version` 是权限引导的协议版本。新增重要权限说明或修复授权
  流程时递增它，已完成旧版本的安装会在更新后再显示一次；同一版本不重复打扰用户。
- 非 macOS：自动把 `has_completed_onboarding` 标为 true，不展示向导。
- 跳过不等于失败；启动器仍可用，仅能力降级。

## 手动验证

1. 清空或新建 `has_completed_onboarding: false`（且为 macOS）→ 启动应出现向导。
2. FDA 步骤：打开系统设置后打开 Qx 开关，向导状态应变为已授权。
3. 可选步骤：仅勾选辅助功能 →「启用所选」打开对应面板。
4. 跳过全部 → 可进入 Launcher；设置 → 权限 仍可补授。
5. 完成后重启 → 不再出现向导；blur 自动隐藏恢复正常。
6. 未授予 FDA 时启动文件搜索 → 不弹出 Documents/Desktop 单独授权框；授予 FDA 后，
   向导状态更新且完整索引无需重启即可启动。
7. 将本地 `permission_onboarding_version` 降为旧值 → 更新后只重放一次引导；完成后
   再次重启不重放。
8. 从权限页打开系统设置，或从 RSS 导入打开系统文件选择器 → Qx 保持显示；选择或取消
   后回到 Qx，Esc 与点击窗口外隐藏恢复。

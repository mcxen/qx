# 跨平台首次启动引导与 macOS 权限

> 状态：Current · 适用版本：v0.6.97+ · Owner：Core · 最后复核：2026-08-19

## 目标

第一次打开 Qx 时，用最短路径让核心能力可用：

1. **完全磁盘访问权限（Full Disk Access）** — 由用户在系统设置中授予，使 Qx
   能搜索当前系统允许应用访问的受保护目录。
2. **可选权限** — 辅助功能（剪贴板自动粘贴）、屏幕录制、输入监听；可跳过或批量启用。

设计参考开源 [inket/FullDiskAccess](https://github.com/inket/FullDiskAccess)：探测受保护路径判断 FDA，再打开「系统设置 → 隐私与安全性」对应页，由用户手动开关。

## 流程

```
Welcome → Personalize → Full Disk Access → Optional features → Done
                            │                    │
                            │ skip               │ skip / enable selected
                            └────────────────────┴─→ 写入完成状态 + 引导协议版本
```

| 步骤 | 内容 | 可跳过 |
|---|---|---|
| Welcome | 能力介绍；免费开源与反付费下载提醒；官网入口 | 可「跳过设置」直接结束 |
| Personalize | 主题、窗口标题栏与主搜索全局快捷键 | 可保留当前设置 |
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
| UI | `src/modules/onboarding/OnboardingWizard.tsx` | 跨平台首装能力介绍；macOS 继续进入分步权限向导 |
| 设置页 | `src/modules/settings/PermissionSettings.tsx` | 后续可再次申请（含 FDA + 全部请求） |
| 启动 | `src/App.tsx` | 两个平台首次安装展示；macOS 引导协议升级后可重放权限向导 |

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
- 引导覆盖层会遮住普通 QxShell Top Bar，因此卡片顶部必须保留独立
  `data-tauri-drag-region` 握区；卡片外背景也可拖动窗口，表单、按钮和权限行不得被
  拖拽命中区覆盖。
- `permission_onboarding_version` 是权限引导的协议版本。新增重要权限说明或修复授权
  流程时递增它，已完成旧版本的安装会在更新后再显示一次；同一版本不重复打扰用户。
- Windows 首次安装也展示能力与默认快捷键介绍，但不展示 macOS 权限步骤；完成或跳过后写入 `has_completed_onboarding`。
- 跳过不等于失败；启动器仍可用，仅能力降级。
- Settings → General 的“再次显示欢迎引导”只重新挂载 UI 流程并恢复引导失焦保护；不重置完成标记、权限探测结果或用户设置，适合人工回归测试。

## 手动验证

1. 清空或新建 `has_completed_onboarding: false` → macOS 与 Windows 启动均应出现能力介绍与个性化步骤；macOS 继续显示权限步骤，Windows 直接进入快捷键完成页。
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
9. 在 Welcome、Files、Optional、Done 每一步，从卡片顶部握区或卡片外背景拖动窗口，
   窗口应立即移动；按钮、开关和正文选择仍正常。
10. Welcome 官网按钮必须通过系统浏览器打开 `https://qx.xpai.uk`；Personalize 的主题、标题栏和主搜索快捷键变更立即生效并持久化，冲突快捷键不能继续保存。

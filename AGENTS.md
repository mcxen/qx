# Qx Project — Agent Guidelines

## 前置规范

在进行任何代码修改前，必须先读取以下文件：

1. **`UI_SPEC.md`** — UI 设计规范（布局、间距、色彩、交互等全量规则）。所有 UI 修改必须遵循此规范，不得自行发明替代方案。
2. **`TASK.md`** — 当前开发任务与进度。

## 核心 UI 规则（来自 UI_SPEC.md）

- 主壳采用三层结构：Top Bar / Main Area (内容+Context Panel) / Bottom Bar。
- Bottom Bar 使用 `grid-template-columns: auto 1fr auto` 布局。
- **Dynamic Island 必须始终相对窗口居中**，用 `position: absolute; left: 50%; transform: translateX(-50%)` 实现。禁止用 `justify-self: center` 或 `margin: 0 auto` 在 grid 列内居中，左右列宽度变化会导致视觉偏移。
- Bottom Bar 父容器必须设 `position: relative`。
- 控件圆角 6px，主壳圆角 8px，边框 1px solid `var(--qx-border-1)`。
- 系统监控岛最大高度 36px，默认岛高度 32px。
- 搜索是第一入口；右侧 Context Panel 展示辅助信息。
- 所有状态用 CSS 变量，不硬编码色值。
- Esc 三级导航协议：inner state → search query → launcher（通过 `useEscBack` hook 统一）。

## 技术约束

- Tauri v2 + React + TypeScript。
- Rust 后端，前端通过 `@tauri-apps/api/core` 的 `invoke` 通信。
- 文件路径必须用 `convertFileSrc()` 转换，禁止 `file://`。
- 滑动条用自定义实现（`src/ui/ui.tsx` 中的 Slider 组件），不用原生 `<input type="range">`。
- 系统监控用 Mach 内核 API（`host_processor_info` / `host_statistics64`），不用 `sysinfo` crate。
- 任何情况不允许模拟 —— 使用真实 HTTP 下载、真实 API 调用。

## 工作流程

- 编码任务优先通过 OpenCode CLI 或 Codex CLI 执行。
- 提交前运行 `cargo check`（在 `src-tauri/` 目录）和 `npx tsc --noEmit` 确保零错误。
- 每次提交打 tag 并发布 GitHub Release。

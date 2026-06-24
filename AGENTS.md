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

### Esc 级联协议 (Cascading Esc)

每个可打开的模块（Clipboard、Screenshot、RSS、DevTxtTool、ScreenRecorder 等）必须通过 `useEscBack` hook 统一实现多级 Esc 级联行为：

1. **inner state**（模块内部子状态：详情面板、预览、输出视图等）→ 关闭子面板
2. **local query**（模块自己管理的搜索框文本）→ 清空
3. **launcher**（关闭当前模块，回到主搜索页）→ 执行

如果模块没有某个层级，自动跳过，递进到下一级。

实现方式：

```ts
// src/hooks/useEscBack.ts
const { onKeyDown } = useEscBack({
  inner: { active: showDetail, close: () => setShowDetail(false) },
  query: { active: !!localQuery, clear: () => setLocalQuery("") },
  launcher: props.onBack,
})
```

规则：
- 每个层级按顺序检查，命中即消费、阻止冒泡、不再递进。
- `inner` 和 `query` 是可选的（`?`），无对应状态时跳过。
- 禁止各模块自己复制这段逻辑，必须统一引用 `useEscBack`。
- 模块新增内部子状态时，将其纳入 `inner` 层级，不要自己写额外的 Esc 监听。

## 工作流程

- 编码任务优先通过 OpenCode CLI 或 Codex CLI 执行。
- 提交前运行 `cargo check`（在 `src-tauri/` 目录）和 `npx tsc --noEmit` 确保零错误；发布前还要运行 `npm run build` 和 `cargo fmt --check`。
- 发布通过 GitHub Actions 执行：推送 `v*` tag 会触发 `.github/workflows/release-desktop.yml`，构建 macOS Apple Silicon app.zip，创建 GitHub Release，并在配置了 `HOMEBREW_TAP_PAT` 时通知 `mcxen/homebrew-qx` 更新 cask。

### 发布流程

1. **审核当前 diff**
   - `git status --short`
   - `git diff --stat`
   - 对所有代码 diff 做 review；确认没有无关文件、构建产物、密钥、临时文件。
   - 新增文件必须显式纳入审核，不能只看 tracked diff。

2. **同步版本号**
   - 选择下一个未使用版本，例如当前最新 tag 是 `v0.4.14`，下一版用 `0.4.15` / `v0.4.15`。
   - 同步更新：
     - `package.json`
     - `package-lock.json`
     - `src-tauri/Cargo.toml`
     - `src-tauri/Cargo.lock` 中 `name = "qx"` 的 package version
     - `src-tauri/tauri.conf.json`
     - `README.md` 状态版本
   - 用 `git tag --list 'v*' --sort=-version:refname | head` 和 `git ls-remote --tags origin 'v*'` 确认 tag 未被占用。

3. **本地验证**
   - `npx tsc --noEmit`
   - `npm run build`
   - `cargo fmt --check`（在 `src-tauri/` 目录；失败时先运行 `cargo fmt` 再复查）
   - `cargo check`（在 `src-tauri/` 目录）
   - 已知 warning 可以记录，但不能忽略新增 error。

4. **提交和打 tag**
   - `git add ...`
   - `git diff --cached --check`
   - `git commit -m "vX.Y.Z: <summary>"`
   - `git tag vX.Y.Z`
   - 提交后确认 `git status --short` 干净。

5. **推送并触发发布**
   - `git push origin main`
   - `git push origin vX.Y.Z`
   - 推送 tag 后确认 GitHub Action 已触发：
     - `gh run list --repo mcxen/qx --workflow release-desktop.yml --limit 5`
     - `gh run watch <run-id> --repo mcxen/qx --exit-status`
   - 如果 Action 失败，先查看失败 step 日志，修复后重新提交并使用新的 patch 版本 tag；不要移动已推送的发布 tag，除非明确确认需要重写发布历史。

6. **发布后确认**
   - 确认 GitHub Release 存在且包含 `qx_vX.Y.Z_aarch64-apple-darwin.app.zip`。
   - 确认 workflow 的 Homebrew dispatch 步骤成功；如果缺少 `HOMEBREW_TAP_PAT`，需要手动更新 `github.com/mcxen/homebrew-qx` 的 cask version 和 sha256。
   - 必要时本地验证安装/升级：
     - `brew tap mcxen/qx`
     - `brew install --cask qx`
     - `brew upgrade --cask qx`

- Release 发布后，brew tap `mcxen/qx` 的 cask 配置（位于 `github.com/mcxen/homebrew-qx`）需要同步更新 version 和 sha256。安装方式：

  ```
  brew tap mcxen/qx
  brew install --cask qx
  brew upgrade --cask qx  # 升级
  ```

  **国内网络注意**：`brew tap` 默认走 HTTPS，GitHub 可能被阻断。改用 SSH 克隆：

  ```
  git clone git@github.com:mcxen/homebrew-qx.git /opt/homebrew/Library/Taps/mcxen/homebrew-qx
  brew trust mcxen/qx
  brew install --cask qx
  ```

  下载 .app.zip 同样需要 GitHub 可达，如有必要请配置代理。

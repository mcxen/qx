> Settings/About 面板的结构、设计令牌、Row/Card 规范与响应式断点见 [docs/settings-panel.md](docs/settings-panel.md)。

## Feature — 应用搜索中文名与拼音匹配

**状态**：已实现，等待手动验证。

### 新增内容

- `apps::AppEntry` 新增 `display_name` 字段并下发前端，优先取 `zh-Hans.lproj` / `zh_CN.lproj` / `Chinese.lproj` 中的 `CFBundleDisplayName`。
- 新增 `apps_zh_dict.rs`，内置 Apple 系统应用（访达、应用商店、系统设置、邮件、终端、活动监视器等约 60 项）的中文展示名与别名，按 `CFBundleIdentifier` 索引。
- `localized_bundle_aliases` 改为 `resolve_localized_names`，同时返回 `(display_name, aliases)`；扫描时把所有中文别名（含字典）转成全拼与首字母写入 `aliases`，让用户用 `weixin` / `wx` 也能命中。
- `search_apps` 评分新增 `display_name` 的 exact / starts_with / contains 三档，与 `name` 等权重；`aliases` 仍按原顺序兜底，命中拼音和 Apple 系统 app 中文名。
- 引入 Rust `pinyin = "0.10"` crate（轻量、纯 Rust，无 native 依赖）。
- 前端 `AppEntry` 类型新增可选 `display_name`，新增 `src/search/appDisplay.ts` 暴露 `useDisplayName()`；`ResultsList` 与 `LauncherContext` 在 `general.language === "zh-CN"` 时优先渲染中文名。
- `apps` 表 schema 新增 `display_name` 列并通过 `ALTER TABLE` 安全升级旧 DB。
- `UI_SPEC.md` 新增 "Application Naming" 节，明确 `name` / `display_name` / `aliases` 的语义与优先级。

### 验证

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `cargo fmt --check`（`src-tauri/`）
- [ ] `cargo check`（`src-tauri/`）
- [ ] 手动验证：在 Launcher 输入"微信"命中 WeChat.app；输入"应用商店"命中 App Store；输入"访达"命中 Finder；输入 `weixin` / `wx` 命中微信；切换语言为英文时列表显示英文名。

---

## Feature — Launcher 搜索别名与标签

**状态**：已实现，等待验证。

### 新增内容

- Settings 持久化新增 `search_metadata`，按 `app:<path>`、`plugin:<id>`、`module:<id>` 保存用户自定义 aliases 和 tags。
- Launcher 右侧 Context Panel 在选中应用或模块时可直接编辑别名/标签，使用 Qx shadcn `Input` / `Button` / `Badge`。
- Extensions → Installed 详情页新增 Search Aliases & Tags，可为内置模块和外部插件配置搜索别名/标签。
- Launcher 搜索现在会匹配应用别名/标签、插件/模块别名/标签；别名命中应用时会补入真实应用结果。
- Installed 插件列表搜索会匹配别名/标签，便于按用户自定义分类查找插件。

### 验证

- [x] `npx tsc --noEmit`
- [x] `rg '<select|type="range"|type="checkbox"|type="radio"' src`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证给应用、内置模块和外部插件添加 aliases/tags 后，Launcher 和 Installed 搜索均可命中。

---

## Feature — 灵动岛 LED 点阵时间显示

**状态**：已实现，已通过静态验证。

### 新增内容

- 新增 `src/components/Matrix.tsx`，移植 unlumen UI 的 LED 点阵 Matrix 组件（SVG 像素 + 辉光 + 帧动画 + VU 表），渐变/滤镜 id 用 `React.useId()` 做唯一前缀避免多实例冲突。
- `HomeDateIsland.tsx` 改用 Matrix 渲染 `HH:MM` 时间点阵：通过 `digits` 字模拼接 H H : M M 为 24×7 单 Frame，冒号按秒奇偶闪烁；公历/农历日期继续保留为右侧滚动副本。
- 灵动岛调色板使用 Qx 既有变量（`--qx-system-island-text` / `--qx-system-island-muted`），不引入新色值。
- 新增 `.qx-date-matrix` 样式收缩点阵与日期副本间距。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [ ] 手动验证设置 → 日期显示模式下灵动岛显示点阵时间，冒号秒级闪烁，公历/农历滚动正常。

---

## Feature — AI Agent 设置模块与工具门控

**状态**：已实现，等待验证。

### 新增内容

- Settings 新增独立 `AI Agent` 模块，支持开启 Agent 模式。
- Agent 设置可配置默认 provider/model，并同步 QxAI 当前模型选择。
- Agent 设置可配置模型工具调用标记、工具总开关、memory/app search/file search/http/notification/MCP/background task 等工具组。
- Agent 设置可配置 bash 工具开关、默认 cwd 和超时上限。
- Agent 设置可配置真实 `rg` / `grep` 文本搜索接入、默认搜索根目录和结果数量上限。
- Rust settings schema 新增 `agent` 持久化分支，支持设置导入/导出。
- 插件 AI runtime 新增 `context.ai.agentSettings()` 和 `context.ai.search.grep()`。
- `plugin_ai_run_bash` 与新增 `plugin_ai_grep_search` 会读取 Settings -> AI Agent 的全局开关进行门控。
- 更新 `docs/ai-agent-runtime.md`、`public/doc/plugin-system.md`、`public/doc/plugin-marketplace.md` 和 `docs/technical-architecture.md`。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证 Settings -> AI Agent 中开关、provider/model、bash、grep 配置能保存并在插件调用时生效。

---

## Bugfix — 界面透明度一致性

**状态**：已实现，已通过本地验证。

### 修复内容

- 透明度设置从单一 `--qx-canvas-opacity` 扩展为语义变量：窗口底色、Shell 区域叠层、Elevated/Glass 区域、Overlay Bottom、Popover/Bottom Island。
- 组件表面色 `--qx-bg-component-1/2/3` 改为 RGB + 透明度派生变量，列表、按钮、卡片、选择器等控件跟随同一个透明度设置。
- QxShell 根背景改为透明，由外层画布承载统一透明度，Top Bar / Context Panel / Bottom Bar / 灵动岛使用同一组透明度派生变量。
- 移除 Clipboard 模块对 QxShell 根背景的私有不透明覆盖，遵循 Shell 背景语义由统一样式控制。
- 外观设置文案从“画布透明度”调整为“界面透明度”，明确统一控制主壳、面板和灵动岛。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] 运行态 computed style 验证：`.qx-canvas` 使用 `--qx-window-opacity`，`.qx-shell-topbar` / `.qx-shell-context` / `.qx-shell-bottombar` 使用同一 `--qx-shell-region-opacity`，`.qx-bottom-island` 使用 `--qx-shell-popover-opacity`，`.qx-shell-action` 跟随 `--qx-bg-component-3` 的 surface opacity。

---

## Feature — AI 插件底层能力与多模态模型目录

**状态**：已实现，等待验证。

### 新增内容

- 新增插件 `context.ai` SDK：`providers()`、`models(provider?)`、`defaultModel()`、`chat(input, options?)`。
- 新增 `ai` 插件权限，插件声明后可调用 QxAI 文本和图片多模态能力。
- 自定义 OpenAI-compatible provider 的模型目录优先通过真实 API `GET /models` 获取，失败时回退到本地缓存/手填模型。
- QxAI 设置页自定义 provider 支持 `Fetch Models`，可从 API 拉取模型列表。
- 插件 AI 调用支持字符串 prompt、messages 数组、OpenAI-compatible content parts，以及 `images` 便捷参数。
- 插件 AI 新增 `context.ai.stream()`，以 chunk 回调方式支持流式文字输出。
- 后端多模态消息以 JSON content 透传给自定义 provider；DuckDuckGo 文本 provider 遇到图片输入时返回明确错误。
- 插件 AI 新增真实 bash 子进程工具 `context.ai.runBash()`，使用 `ai-bash` 独立权限和超时保护。
- 插件 AI 新增用户记忆接口 `context.ai.memory.*`，使用 `ai-memory` 独立权限，当前持久化到 `~/.qx/qxai-memory.json`。
- QxAI Settings 新增 Memory 管理区，用户可直接新增、刷新、删除持久记忆。
- 插件 AI 新增进程内后台任务接口 `context.ai.tasks.*`，使用 `ai-background` 独立权限，任务可在 Qx 隐藏到托盘后继续运行并在完成/失败时通知。
- 新增 `docs/ai-agent-runtime.md`，定义 ReAct、tool calling、MCP、memory、soul 和更持久后台任务的后续 runtime 边界。
- 更新 `public/doc/plugin-system.md`、`public/doc/plugin-marketplace.md` 和 `docs/technical-architecture.md`。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证插件声明 `ai` 权限后列模型、选择模型、文本调用、图片调用、stream chunk、后台任务、bash、memory 和缺权限报错。

---

## Bugfix — QxAI 输出与模型选择修复

**状态**：已实现，已通过本地验证。

### 修复内容

- QxAI 新会话创建时会从已加载 provider 列表中解析有效 provider/model，避免 provider 尚未加载完导致空配置会话。
- 发送消息前会再次校验并补齐会话 provider/model；缺失或异常时通过 QxShell 底部灵动岛显示错误。
- 聊天页右侧 Context Panel 新增当前会话 provider/model 选择，可直接切换已有会话模型。
- 修正自定义 OpenAI-compatible provider 的 Tauri invoke 参数名，确保真实请求能带上 `baseUrl/apiKey/model/messages`。
- DuckDuckGo provider 会将 `system` prompt 合并进首条 user 消息，并忽略 SSE 中非正文事件，避免接口格式导致空输出或异常正文。
- 通用 Select 支持 disabled 选项，QxAI provider 分隔项不再可被键盘或鼠标选中。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证内置 DuckDuckGo 输出、自定义 provider 输出、已有会话切换模型和异常灵动岛报错。

---

## Bugfix — 插件异常隔离与灵动岛报错

**状态**：已实现，已通过静态验证。

### 修复内容

- 插件加载改为非阻塞异步落地：先显示已安装插件列表和内置能力，再并发加载外部插件命令/面板。
- 单个插件加载失败、快捷键注册失败、命令运行失败不再影响其他插件加载。
- 插件加载、成功和失败状态通过统一 runtime status hook 汇报到 Launcher 灵动岛。
- Launcher 当前搜索时，插件命令/面板异步加载完成后会自动刷新搜索结果。
- 插件面板 render/loading/timeout/error 状态接入插件页自己的底部灵动岛，错误时显示 Retry。
- 增加 load token，避免刷新/启停插件时旧异步加载结果污染当前 registry。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证坏插件 entry、坏 panel render、慢插件加载、命令异常时 Qx 可正常打开且灵动岛显示错误。

---

## Maintenance — 插件库 UI 与文档更新

**状态**：已实现，已通过前端静态验证。

### 优化内容

- Extensions → Installed 新增已安装插件搜索，以及 `All / Built-in / External / Enabled / Disabled` 筛选。
- Installed 和 Browse 统一为左侧列表 + 右侧详情结构，便于查看插件权限、preferences、版本、作者、大小、更新时间和 SHA256。
- Browse 市场安装增加安装中、已安装、失败状态反馈。
- 插件管理按钮补充 lucide 图标，样式收敛到 `settings-actions.css` 的插件库类名。
- 更新 `public/doc/plugin-marketplace.md`、`public/doc/plugin-system.md`、`docs/technical-architecture.md` 和 `README.md` 中的插件库说明。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证 Installed 搜索/筛选、Browse 搜索/详情、安装状态和右侧插件详情。

---

## Feature — Raycast system-information 转换适配

**状态**：进行中，已通过静态验证。

### 新增内容

- 新增 `scripts/convert-raycast-extension.mjs`，可将 Raycast 扩展目录转换为 Qx 插件目录，并可打包为 `.qx-plugin`。
- 插件管理器新增 Raycast extension URL 安装入口，可直接粘贴 GitHub Raycast extension tree URL 触发转换安装。
- 针对 Raycast `system-information` 扩展生成 Qx 插件适配层，保留 `View System Information` 面板和 `check-storage / check-system-info / check-network / list-processes / kill-process` 命令。
- 新增后端真实系统信息命令：系统信息、存储、网络、进程列表、结束进程。
- 插件 RPC 权限检查同时支持精确命令名和 `invoke:<cmd>` 写法。
- 新增 `public/doc/raycast-plugin-conversion.md` 记录 Raycast 兼容边界和转换流程。

### 验证

- [x] `node scripts/convert-raycast-extension.mjs /tmp/qx-raycast-sparse/extensions/system-information --out /tmp/qx-raycast-converted --package`
- [x] `node --check scripts/convert-raycast-extension.mjs`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo fmt --check`（`src-tauri/`）
- [x] `cargo test marketplace::tests -- --nocapture`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] 安装转换后的 `.qx-plugin` 到 `~/.qx/plugins/raycast-system-information` 并启用。
- [x] 用已安装插件入口执行 6 个命令和面板渲染，验证 Hostname / Storage / Network / Running Processes 输出。
- [ ] 在 Qx UI 中手动验证搜索入口、面板展示和命令 toast。

---

## Bugfix — 窗口尺寸拖拽闪烁

**状态**：已实现，已通过本地构建验证。

### 修复内容

- `App.tsx` 启动恢复窗口尺寸只执行一次，不再依赖整个 `settings.appearance`，避免拖动窗口时 settings 回写触发 `setSize()`。
- `App.tsx` 的 resize 保存改为 250ms debounce，减少拖动时频繁保存和重渲染。
- `AppearanceSettings.tsx` 移除重复的 `onResized` 监听和自动 `set_window_size` effect，外观页只在用户提交 W/H 输入时主动调整窗口。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [x] `npm run tauri build`
- [x] 本地替换 `/Applications/Qx.app` 并启动。

---

## Maintenance — QxShell / Launcher 结构整理

**状态**：已实现，已通过静态验证。

### 整理内容

- 将 `QxShell.tsx` 中的底部灵动岛渲染拆到 `QxBottomIsland.tsx`，并保留 `BottomIslandContent` 类型从 `QxShell` re-export，避免影响现有模块 import。
- 将 Shell 底部动作按钮拆到 `ShellActionButton.tsx`，使 Shell 主文件只负责三层布局编排。
- 将 Launcher 的选中项动作生成、动作弹层、右侧 Context Panel、历史加载分别拆到 `src/launcher/` 下的小模块。
- 将 `.qx-shell-action` 与 Shell 响应式布局样式从 `launcher.css` 迁移到 `shell.css`，解除 Shell 公共 UI 对 Launcher 私有样式的依赖。
- 移除 Launcher Context 的内联 spacing style，改用 CSS class。
- 补充动作面板键盘索引 clamp，避免空动作列表时出现非法索引。

### 验证

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [ ] 手动验证 Launcher 搜索、右侧入口、Recent、`Cmd+K` 动作面板、`Cmd+,` 设置入口和底部动作按钮行为保持一致。

---

## Bugfix — 外观设置控件与窗口尺寸同步

**状态**：已实现，已通过静态验证。

### 修复内容

- 外观页 `W/H` 宽高输入改为输入草稿，失焦或回车后提交，避免半截数字触发窗口跳动。
- 接入 Tauri `onResized`，用户手动拖拽窗口后会回写 `appearance.window_width/window_height` 并同步显示到设置页。
- 设置保存改为乐观更新，避免旧的 `update_settings` 响应覆盖较新的本地状态。
- 圆角设置收敛到规范内的 `4px / 6px / 8px`，并让 `--qx-control-radius`、`--qx-card-radius` 跟随设置生效。

### 验证

- [x] `npx tsc --noEmit`
- [x] `cargo check`（`src-tauri/`，通过；存在既有 warning）
- [ ] 手动验证外观页宽高、圆角、字号点击与窗口拖拽尺寸同步。

---

## Bugfix — QxShell Top Bar 搜索样式统一

**状态**：已实现，已通过静态验证。

### 修复内容

- 明确 `UI_SPEC.md` 中 Shell Top Bar 搜索框实现约束：统一使用 `qx-search-wrap` + `qx-plugin-search`。
- 将通用搜索框样式从 Launcher 特例提升为 Shell 通用样式。
- 截图模块搜索框不再复用 Clipboard 私有样式，改用 Shell 通用搜索样式。
- Top Bar 内 Select 控件高度统一到搜索框高度，保证首页右上角筛选与搜索框对齐。
- Shell 搜索槽强制搜索框填满可用宽度，修复设置页搜索框收缩/无统一外观的问题。
- 纯文本 Top Bar 状态（如 `Qx v...`）统一成 42px 高的右上状态控件。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证首页与截图模块 Top Bar 搜索框高度、圆角、边框、focus 态一致。

---

## Feature — 主页灵动岛日期显示

**状态**：已实现，已通过静态验证。

### 新增内容

- 主页灵动岛模式新增 `日期显示`，用点阵屏风格显示当前时间、公历日期和农历日期。
- 原 `系统` 模式文案改为 `系统信息`，保留 CPU / GPU / MEM 老样式监控。
- `UI_SPEC.md` 补充灵动岛可承载消息通知、动态进度、播放进度，以及主页空闲样式说明。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证设置页可切换 `默认 / 系统信息 / 日期显示`，主页空闲时日期岛正常显示并实时更新。

---

## Spec — QxShell 灵动岛协议

**状态**：已完成。

### 规范内容

- 在 `UI_SPEC.md` 中新增灵动岛内容协议，明确模块和插件默认使用 `QxShell island` prop。
- 定义 `label/detail/progress/tone/actionLabel/onAction` 的字段语义和使用边界。
- 定义 `idle / notice / progress / activity / playback / error` 标准状态类型。
- 定义多消息抢占优先级：进行中任务、错误、完成通知、模块空闲信息、主页空闲样式。
- 明确视觉约束：默认 32px、最大 36px、窗口居中、单行截断、插件不得直接改 Shell 核心样式。
- 补充滚动展示规范：内部横向滚动、渐隐遮罩、hover/focus 暂停、遵守减少动态效果。

---

## Feature — 灵动岛滚动展示

**状态**：已实现，已通过静态验证。

### 新增内容

- 新增通用 `qx-island-marquee` 滚动轨道，支持固定岛尺寸内连续横向滚动。
- 系统信息和日期显示主页灵动岛已接入滚动展示。
- 支持 hover/focus 暂停滚动，并在 `prefers-reduced-motion: reduce` 下关闭自动滚动。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证系统信息与日期显示灵动岛滚动连续、不改变 Bottom Bar 高度和居中位置。

---

## Bugfix — Launcher Top Bar 层级和局部快捷键

**状态**：已实现，已通过静态验证。

### 修复内容

- 保持 Launcher Top Bar 的搜索框 + 右侧范围筛选结构不变，仅提升 Top Bar 层级，保证下拉菜单展开时覆盖下方内容区。
- Launcher 打开并聚焦时，`Cmd+,` 进入设置，`Cmd+K` 打开/关闭当前选中项操作框。

### 验证

- [x] `npx tsc --noEmit`
- [ ] 手动验证下拉菜单不会被右侧内容覆盖，`Cmd+,` 和 `Cmd+K` 只在 Launcher 内按预期生效。

---

## P1 — 主题系统（Vercel Geist 风格）

**概述**：参考 Vercel Geist Design System 重新设计 Qx 主题系统，支持亮色/暗色/跟随系统三种模式，提供统一的设计语言和 CSS 自定义属性架构。

### 设计原则（来自 Vercel Geist）

- **10 阶色阶**：每种颜色（Gray/Blue/Red/Amber/Green/Teal/Purple/Pink）定义 10 级色阶，1 最暗/10 最亮
- **高对比度 + 可访问性**：文本对比度不低于 WCAG AA
- **毛玻璃保留**：Qx 特有的半透明毛玻璃效果叠加在 Geist 纯色系统之上
- **Grid 背景元素**：Vercel 标志性的网格背景图案
- **组件色语义**：背景(3级) + 边框(3级) + 高对比背景(2级) + 文字(2级)

### CSS 自定义属性架构

```css
/* ====== 亮色主题 (Light) ====== */
[data-theme="light"] {
  /* 背景 */
  --qx-bg-100: #fafafa;        /* 默认页面背景 */
  --qx-bg-200: #ffffff;        /* 组件卡片背景 */

  /* Gray 色阶 (从深到浅，1=最深, 10=最浅) */
  --qx-gray-100: #0a0a0a;
  --qx-gray-200: #1a1a1a;
  --qx-gray-300: #2e2e2e;
  --qx-gray-400: #404040;
  --qx-gray-500: #6b6b6b;
  --qx-gray-600: #8a8a8a;
  --qx-gray-700: #a0a0a0;
  --qx-gray-800: #b0b0b0;
  --qx-gray-900: #d4d4d4;
  --qx-gray-1000: #ededed;

  /* Blue 主色 (Accent) */
  --qx-blue-600: #2563eb;      /* 默认 accent */
  --qx-blue-700: #1d4ed8;      /* hover accent */
  --qx-blue-900: #60a5fa;      /* 高亮文字 */
  --qx-blue-1000: #eff6ff;     /* 浅蓝背景 */

  /* 组件色语义 */
  --qx-bg-component-1: #ffffff;      /* 默认组件背景 */
  --qx-bg-component-2: #f5f5f5;      /* hover 背景 */
  --qx-bg-component-3: #e8e8e8;      /* active 背景 */
  --qx-border-1: #e5e5e5;           /* 默认边框 */
  --qx-border-2: #d4d4d4;           /* hover 边框 */
  --qx-border-3: #a3a3a3;           /* active 边框 */
  --qx-text-primary: #0a0a0a;       /* 主要文字 */
  --qx-text-secondary: #6b6b6b;     /* 次要文字 */
  --qx-text-tertiary: #a0a0a0;      /* 辅助文字 */

  /* 毛玻璃 */
  --qx-glass-bg: rgba(250, 250, 250, 0.75);
  --qx-glass-border: rgba(0, 0, 0, 0.06);
  --qx-glass-shadow: rgba(0, 0, 0, 0.04);
}

/* ====== 暗色主题 (Dark) ====== */
[data-theme="dark"] {
  --qx-bg-100: #0a0a0a;
  --qx-bg-200: #000000;

  --qx-gray-100: #1a1a1a;
  --qx-gray-200: #1f1f1f;
  --qx-gray-300: #292929;
  --qx-gray-400: #2e2e2e;
  --qx-gray-500: #454545;
  --qx-gray-600: #878787;
  --qx-gray-700: #8f8f8f;
  --qx-gray-800: #7d7d7d;
  --qx-gray-900: #a1a1a1;
  --qx-gray-1000: #ededed;

  --qx-blue-600: #3b82f6;
  --qx-blue-700: #60a5fa;
  --qx-blue-900: #93c5fd;
  --qx-blue-1000: #172554;

  --qx-bg-component-1: #1a1a1a;
  --qx-bg-component-2: #1f1f1f;
  --qx-bg-component-3: #292929;
  --qx-border-1: #292929;
  --qx-border-2: #333333;
  --qx-border-3: #454545;
  --qx-text-primary: #ededed;
  --qx-text-secondary: #878787;
  --qx-text-tertiary: #6b6b6b;

  --qx-glass-bg: rgba(10, 10, 10, 0.80);
  --qx-glass-border: rgba(255, 255, 255, 0.06);
  --qx-glass-shadow: rgba(0, 0, 0, 0.30);
}
```

### 字体系统

```css
--qx-font-sans: 'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--qx-font-mono: 'Geist Mono Variable', 'SF Mono', 'Fira Code', monospace;
```

Geist Variable 字体可通过 npm 包 `@vercel/geist-font` 安装，或使用系统备选。

### 网格背景（Grid Pattern）

Vercel 标志性设计元素：在全局设置面板的背景中叠加半透明网格图案。

```css
.qx-grid-bg {
  background-image:
    linear-gradient(rgba(128, 128, 128, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(128, 128, 128, 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
}
/* 暗色下透明度调整 */
[data-theme="dark"] .qx-grid-bg {
  background-image:
    linear-gradient(rgba(128, 128, 128, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(128, 128, 128, 0.08) 1px, transparent 1px);
}
```

### 主题切换实现

**存储**：`~/.qx/settings.json` 中 `appearance.theme: 'light' | 'dark' | 'system'`

**CSS 变量方案**：
- `[data-theme="light"]` / `[data-theme="dark"]` 在 `<html>` 元素上切换
- `data-theme="system"` 时，用 JS 监听 `prefers-color-scheme` 媒体查询自动切换
- 所有组件引用 `var(--qx-*)` 而非硬编码颜色

**组件**：
- 新增 `ThemeProvider.tsx`（或 useTheme hook）管理 theme class + 系统偏好监听
- `AppearanceSettings.tsx` 中的主题 radio 接入实际切换逻辑
- 主题切换时应用 `transition: background-color 0.2s ease, color 0.2s ease`

### 改造范围

| 文件 | 改动 |
|------|------|
| `src/App.css` | 全部重写为 `var(--qx-*)` 变量引用 + grid 背景 |
| `src/App.tsx` | 包裹 `<ThemeProvider>`，主题切换监听 |
| `src/modules/settings/AppearanceSettings.tsx` | 主题 radio 接入实际切换逻辑 |
| `src/modules/settings/store.ts` | 主题状态持久化到 settings.json |
| 所有组件 CSS | 逐步替换硬编码颜色为 `var(--qx-*)` |

**渐进策略**：先在主面板/app.css 层实现完整变量系统，再逐步替换各子组件的内联颜色。

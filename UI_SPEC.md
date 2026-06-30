# Qx UI Spec

Qx 的 UI 目标是一个稳定、紧凑、可透明的桌面工具壳：搜索优先，内容居中，右侧给上下文，底部承载返回、状态和动作。模块只替换内容区和 Context Panel，不重新发明主壳。

## Core Rules

- 主壳固定为三层：Top Bar / Main Area / Bottom Bar。
- 搜索是第一入口；模块内搜索必须放在 Top Bar。
- 右侧 Context Panel 只放导航、辅助信息和当前对象操作入口，不放第二套主布局。
- Bottom Bar 使用 `grid-template-columns: auto 1fr auto`。
- Bottom Island 必须相对窗口居中：`position: absolute; left: 50%; transform: translateX(-50%)`。
- `.qx-shell-bottombar` 必须 `position: relative`。
- 所有颜色、透明度、圆角、边框和状态必须走 CSS 变量，不在业务组件里硬编码色值。
- 产品可见控件必须使用 Qx shadcn/Radix 组件系统，不暴露浏览器原生 select、range、checkbox、radio 外观。

## Shell

结构：

```text
┌──────────────────────────────────────────────┐
│ Top Bar: Search + filters/actions            │
├──────────────────────────────────────────────┤
│ Main Area: Content + optional Context Panel   │
├──────────────────────────────────────────────┤
│ Bottom Bar: Esc + Bottom Island + Actions     │
└──────────────────────────────────────────────┘
```

尺寸变量：

```css
:root {
  --qx-topbar-h: clamp(64px, 11vh, 92px);
  --qx-bottom-bar-h: clamp(46px, 5.8vh, 56px);
  --qx-context-w: clamp(240px, 28vw, 340px);
  --qx-search-min-w: 220px;
  --qx-radius: 8px;
  --qx-control-radius: 6px;
}
```

视觉模式由 `QxShell` 的 `visual` prop 选择：

- `solid`：列表、Launcher、Clipboard 等高频扫描界面。
- `elevated`：Settings、表单、偏好设置。
- `glass`：阅读 overlay、截图、临时沉浸工具。

模块不得覆盖 `.qx-shell-topbar`、`.qx-shell-context`、`.qx-shell-bottombar` 的核心背景语义；只允许做尺寸、滚动和模块内容布局适配。

## Theme

主题采用 shadcn/Tailwind 语义 token + Qx 透明度算法：

- `ThemeProvider` 必须同步设置 `data-theme` 和 `.dark` class。
- `src/App.css` 通过 `@theme inline` 暴露 shadcn 标准 token。
- `src/styles/base.css` 负责把 Qx token 映射到 shadcn token。
- 透明度只作用在 surface/background token 上，不使用组件整体 `opacity`。
- 深色模式必须有可读性下限，避免低透明度把深色界面冲成灰白。

核心 token：

```css
--background
--foreground
--card
--card-foreground
--popover
--popover-foreground
--primary
--primary-foreground
--secondary
--secondary-foreground
--muted
--muted-foreground
--accent
--accent-foreground
--border
--input
--ring
```

Qx 兼容 token：

```css
--qx-bg-component-1
--qx-bg-component-2
--qx-bg-component-3
--qx-border-1
--qx-border-2
--qx-border-3
--qx-text-primary
--qx-text-secondary
--qx-text-tertiary
--qx-accent
--qx-danger
```

规则：

- 新 shadcn 组件优先使用 `background/foreground/card/popover/muted/accent/border/ring` 语义。
- 旧 Qx 样式可继续使用 `--qx-*`，但不能新增与 shadcn 语义冲突的 `--color-*` alias。
- `--accent` 是 shadcn 弱选中背景；蓝色主操作使用 `--primary` 或 `--qx-accent`。
- Dialog、Dropdown、Popover、Select menu、Tooltip 必须使用半透明 popover surface。
- Light/Dark 下主要文本、次级文本、禁用文本必须保持明显层级。

## Controls

统一出口：`src/components/ui.tsx`。底层源码：`src/components/shadcn/`。

必须使用：

- Button
- Input
- Select
- Switch / Toggle
- ToggleGroup / Tabs
- Slider
- Dialog
- DropdownMenu / Popover
- Tooltip
- Separator
- Badge
- ScrollArea
- Skeleton

禁止产品 UI 直接出现：

- `<select>`
- `<input type="range">`
- 可见原生 checkbox / radio

允许文本、数字、密码输入使用原生 input 能力，但必须用 Qx/shadcn 样式重绘外观。

组件规则：

- `Select` 使用 Radix Select；分隔项约定 `value: "---divider---"`，只渲染分隔线，不可选。
- `Slider` 使用 Radix Slider，必须支持 pointer、键盘、ARIA。
- `Switch` 表达二元状态；不使用 checkbox 外观。
- 弹层优先用 Dialog、Popover、DropdownMenu，不写临时 absolute 菜单。
- 控件圆角走 `--radius` / `--qx-control-radius`。
- Focus ring 走 `--ring` 或 `--qx-accent-soft`。

## Top Bar

Top Bar 包含搜索、返回、筛选和少量上下文操作。

要求：

- 模块搜索统一使用 `qx-search-wrap` + `qx-plugin-search`。
- 搜索框自动聚焦。
- trailing 操作不得挤压搜索框到不可输入。
- 可交互元素必须 `-webkit-app-region: no-drag`。
- 筛选使用 shadcn Select，不使用原生 select。

## Main Area

默认使用：

```css
.qx-shell-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.qx-shell.has-context .qx-shell-main {
  grid-template-columns: minmax(0, 1fr) var(--qx-context-w);
}
```

滚动规则：

- Shell 外层不做页面级滚动。
- 内容列表、详情、Context Panel 各自管理滚动。
- 左右栏滚动互不影响。
- 任意宽度下不得产生横向页面滚动。

Context Panel：

- 宽度填满 `var(--qx-context-w)`。
- 面板本身就是容器，不再套大卡片菜单。
- 列表项可有 hover/active，但不要把整个右栏做成一张卡。

## Bottom Bar

结构：

```text
Esc / Back        [ Bottom Island ]        Actions
```

左侧：

- 只放 Esc / Back 语义。
- 不显示模块名和模块图标。

中间：

- Bottom Island 由 `QxShell` 统一渲染。
- 默认高度 `32px`，最大 `36px`。
- 文本单行截断，不撑高底栏。
- 为空时保持布局稳定。

右侧：

- 只显示当前上下文真实可执行动作。
- 无可用动作时不渲染按钮。
- `Actions` 打开临时菜单，不把菜单内容塞进 Context Panel。

Actions Menu：

- 点击 Actions 或 `Cmd+K` 打开。
- 锚定在底栏右侧按钮上方。
- `Esc` 先关闭菜单；再次按 Esc 走页面返回。
- 菜单项来自当前选中对象。

## Bottom Island

`island` 是轻量状态协议：

```ts
{
  label: string;
  detail?: string;
  progress?: number;
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}
```

优先级：

1. 用户正在等待的任务：同步、下载、导入、OCR、截图保存。
2. 错误或需要处理的状态。
3. 刚完成的短通知。
4. 当前模块位置、选中项、条目数量。
5. 首页空闲样式。

规则：

- 未知进度不要伪造百分比。
- 进度使用 `progress`，阶段文字放 `detail`。
- `tone` 只表达状态，不表达模块品牌。
- action 只放一个短动作，例如 Cancel、Retry、Open。
- 系统信息和日期显示可使用自定义 island，但仍必须满足尺寸约束。
- 动画遵守 `prefers-reduced-motion: reduce`。

## Module Layouts

Launcher：

- 左侧搜索结果，右侧常用入口和最近项。
- 搜索结果、右侧入口、底部动作都支持键盘操作。

Clipboard：

- 左侧历史列表，右侧预览和信息。
- 列表、预览、信息区独立滚动。
- 置顶、复制、删除等动作走 Bottom Bar / Actions。

RSS：

- 阅读器可使用三栏：Feed / Article List / Detail。
- 三栏宽度可以拖拽调整，宽度写入本地状态或设置。
- 每栏必须有最小宽度，拖拽时不得产生横向页面滚动。
- 详情阅读可隐藏 Context Panel 或使用 overlay bottom bar。

Settings：

- 使用 `visual="elevated"`。
- 面板结构、设计令牌、Row/Card/SettingsCard 规范、响应式断点与新增 tab 步骤见 [docs/settings-panel.md](docs/settings-panel.md)。

Plugin Manager：

- 安装、刷新、加载使用 Skeleton 或 spinner。
- 插件详情放 Context Panel 或详情区域，不弹出系统样式窗口。

## Loading States

- 列表首屏加载使用 Skeleton。
- 按钮异步状态使用 lucide `LoaderCircle` spinner。
- 长任务状态进入 Bottom Island。
- 局部 loading 不伪造进度。
- 空状态、错误状态必须占位稳定，不导致布局跳动。
- `prefers-reduced-motion: reduce` 下停止 shimmer/自动滚动，只保留静态占位和状态文案。

## Interaction

Esc 级联统一通过 `useEscBack`：

1. inner state：关闭详情、预览、弹层等内部状态。
2. local query：清空模块搜索。
3. launcher：关闭模块回到主搜索页。

规则：

- 每层命中后消费事件，不继续递进。
- 模块不得复制 Esc 监听逻辑。
- 新增内部子状态时必须纳入 `inner`。

快捷键：

- `ArrowUp / ArrowDown`：移动列表选中项。
- `Enter`：执行主操作。
- `Cmd+K`：打开 Actions。
- `Cmd+P`：剪贴板置顶。
- `Cmd+Backspace`：删除当前对象。

## Responsive

- 宽屏可以使用两栏或三栏。
- 窄屏隐藏或下移 Context Panel。
- Top Bar 可换行，但搜索框不得小于可输入宽度。
- Bottom Bar 隐藏非必要快捷键，保留 Esc、Bottom Island 和主动作。
- 按钮文字必须截断或缩短，不溢出容器。

## Application Naming

- 后端 `AppEntry` 同时携带 `name`（`.app` 文件名去掉 `.app`，作为身份标识）和 `display_name`（本地化展示名）。
- `display_name` 解析优先级：`zh-Hans.lproj > zh_CN.lproj > Chinese.lproj > zh-Hant/zh_TW > 内置 Apple 系统 app 中文字典 > CFBundleDisplayName > name`。
- `name` 永远是 path / metadata key / 历史记录的唯一身份，不随语言改变。
- 前端在 `general.language === "zh-CN"` 时优先渲染 `display_name`，其他语言始终渲染 `name`。前端统一通过 `useDisplayName()` 取值，不要在业务组件中直接读取。
- 搜索匹配使用 `name`、`display_name` 与 `aliases` 三路打分，`aliases` 由 Rust 端在扫描时一次性生成，包含全部本地化名称及其拼音（全拼 + 首字母），不下发到前端，不写入用户可见 UI。
- Apple 系统应用中文名字典位于 `src-tauri/src/apps_zh_dict.rs`，按 `CFBundleIdentifier` 索引；新增条目时第一项默认作为该 app 的 zh-Hans 展示名（仅在没有 lproj 名时使用）。

## Native And Tauri Constraints

- Tauri v2 通信使用 `@tauri-apps/api/core` 的 `invoke`。
- 文件路径展示必须通过 `convertFileSrc()`，禁止直接拼 `file://`。
- 系统监控使用 Mach 内核 API，不使用 `sysinfo` crate。
- 下载、API、插件安装必须使用真实调用，不做模拟成功。

## Validation

提交前按风险选择验证：

- UI / TS 改动：`npx tsc --noEmit`。
- 前端构建或主题改动：`npm run build`。
- Rust 改动：`cargo fmt --check` 和 `cargo check` in `src-tauri/`。
- 原生控件扫描：`rg '<select|type="range"|type="checkbox"|type="radio"' src`。

视觉验收：

- Light / Dark / 透明度调节下文本层级清晰。
- Select、Popover、Dialog、Dropdown、Tooltip 保持半透明且可读。
- Bottom Island 始终窗口居中。
- 小窗口、默认窗口、宽屏无横向滚动、无文字挤压。

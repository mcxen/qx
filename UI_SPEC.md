# Qx UI Spec

> 状态：Current · 适用版本：v0.4.61 · Owner：Frontend · 最后复核：2026-07-10
>
> 事实来源：`src/components/`、`src/styles/`、`src/modules/`

Qx 的 UI 目标是一个稳定、紧凑、可透明的桌面工具壳：搜索优先，内容居中，右侧给上下文，底部承载返回、状态和动作。模块只替换内容区和 Context Panel，不重新发明主壳。

## Core Rules

- 主壳固定为三层：Top Bar / Main Area / Bottom Bar。
- 搜索是第一入口；模块内搜索必须放在 Top Bar。
- 右侧 Context Panel 只放导航、辅助信息和当前对象操作入口，不放第二套主布局。
- Bottom Bar 使用 `grid-template-columns: auto 1fr auto`。
- Bottom Island 必须相对窗口居中：`position: absolute; left: 50%; transform: translateX(-50%)`。
- `.qx-shell-bottombar` 必须 `position: relative`。
- 使用 QxShell 的页面不得在 Shell 外再渲染第二条全局 footer/actionbar。
- 所有颜色、透明度、圆角、边框和状态必须走 CSS 变量，不在普通业务组件里硬编码色值。数据可视化、真实品牌色和按数值动态计算的渐变属于受控例外，但必须集中定义、提供 Light/Dark 回退，并在代码中注明语义。
- 产品可见控件必须使用 Qx shadcn/Radix 组件系统，不暴露浏览器原生 select、range、checkbox、radio 外观。
- 图标默认使用 `lucide-react`；状态动画可使用 lucide 图标动画或 Qx 统一 CSS 动画，但必须尊重 reduced motion。

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

QxShell 的纵向结构高度不得因为窗口左右缩窄、文字变长、筛选项变化或 trailing 操作变多而改变。Top Bar 和 Bottom Bar 必须使用固定高度约束；响应式只能改变列宽、隐藏次级内容、图标化或折叠菜单，不能让 Shell 区域增高、换行或重排成多行。

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

Token 分层：

| 层级 | 示例 | 使用边界 |
|---|---|---|
| 公开语义 token | `--background`、`--foreground`、`--primary`、`--border` | 业务组件首选，允许直接消费 |
| Qx 语义 token | `--qx-text-secondary`、`--qx-danger`、`--qx-bg-component-1` | Shell、兼容样式和 Qx 特有语义使用 |
| 原始色板/算法 token | `--qx-gray-*`、`--qx-surface-rgb-*`、opacity effective 值 | 只在 `base.css` 主题映射层使用 |
| 模块数据 token | contribution level、CPU/MEM/GPU、天气渐变 | 仅用于真实数据或品牌表达，必须同时定义浅色和深色值 |

规则：

- 新 shadcn 组件优先使用 `background/foreground/card/popover/muted/accent/border/ring` 语义。
- 旧 Qx 样式可继续使用 `--qx-*`，但不能新增与 shadcn 语义冲突的 `--color-*` alias。
- `--accent` 是 shadcn 弱选中背景；蓝色主操作使用 `--primary` 或 `--qx-accent`。
- Dialog、Dropdown、Popover、Select menu、Tooltip 必须使用半透明 popover surface。
- Light/Dark 下主要文本、次级文本、禁用文本必须保持明显层级；普通文本至少满足 WCAG 2.2 AA 4.5:1，大文本和非文本控件至少 3:1。
- 业务 TSX 不得为普通文本、边框和背景提供十六进制/RGB fallback；缺失 token 应在 `base.css` 修复。
- 品牌色、图表和天气等受控例外不得承担唯一状态表达，必须配合标签、图标或数值。

## Controls

业务组件统一出口：`src/components/ui.tsx`。底层源码：`src/components/shadcn/`。

Shell 基础设施可以直接消费 shadcn primitive，但应限制在 `src/components/` 内，并由统一的 Shell 组件封装后供业务模块使用。原生 `button` / 文本 `input` 仅在需要底层行为或已有 Qx class 契约时允许；必须具备一致的 focus、disabled、键盘和可访问名称。普通间距、颜色和字体不得通过 inline style 设置；动态尺寸、进度、坐标和数据可视化允许 inline style。

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

## Iconography And Motion

图标来源：

- 产品 UI 的通用动作、状态、导航和文件类型图标优先使用 `lucide-react`。
- macOS app、外部插件、订阅源、用户文件缩略图等真实资产优先使用真实图标或图片；缺失时再回退到 lucide 或字母占位。
- 自定义 CSS/SVG 图标只用于 lucide 没有对应语义、需要保留现有 Qx 品牌形状、或需要渲染真实内容预览的场景。
- 图标按钮必须使用清晰语义的 lucide 图标，并通过 `aria-label` 或 Tooltip 提供可访问名称。
- 装饰性图标必须 `aria-hidden="true"`，不能重复朗读已有文字。

尺寸与样式：

- 工具栏、列表行、Context Panel 操作区的 lucide 图标默认使用 `14px-16px`，空状态或详情标题可放大到 `20px-24px`。
- `strokeWidth` 默认 `2` 或 `2.1`；不要在同一控件组内混用粗细。
- 图标颜色必须继承当前文本色或使用语义 CSS 变量，不在组件里硬编码色值。
- 图标容器尺寸必须固定，避免 hover、loading 或选中状态造成布局跳动。

动画：

- loading、同步、刷新、处理中的状态优先使用 lucide `LoaderCircle` / `RefreshCw` 等图标配合 Qx 统一 spinner 动画。
- 需要表达状态变化、确认、警告或轻量反馈时，可以使用 lucide 图标动画；动画只服务于状态理解，不做持续装饰。
- 常规 UI 过渡优先使用 CSS transition/keyframes；跨组件进入/退出或复杂状态编排可使用 `framer-motion`，但不得改变 Shell 三层结构尺寸。
- 所有循环动画、shimmer、marquee、spinner 和 lucide 动画都必须在 `prefers-reduced-motion: reduce` 下停止或降级为静态状态。
- 动画时长保持短促：反馈动画约 `120ms-240ms`，弹层/列表进入约 `160ms-220ms`，持续 loading 只保留必要旋转或点状状态。
- 不使用纯装饰的漂浮、呼吸、渐变光斑或大面积背景动画。

## Top Bar

Top Bar 包含搜索、返回、筛选和少量上下文操作。

要求：

- 模块搜索统一使用 `qx-search-wrap` + `qx-plugin-search`。
- 搜索框自动聚焦。
- trailing 操作不得挤压搜索框到不可输入。
- Top Bar 必须保持单行。筛选、状态和 trailing 操作不得换行，不得移动到第二行，也不得用 `grid-column: 1 / -1` 做窄屏兜底。
- 窄屏空间不足时，优先压缩搜索宽度、限制 trailing 最大宽度、隐藏次要状态文本、使用图标按钮或把低频动作收进菜单；不得通过增加 Top Bar 高度解决。
- Top Bar 高度不得随窗口宽度变化。模块样式不得只用 `min-height` 允许内容撑高 Top Bar；必须保持固定 `height` / `max-height` 或等价 block-size 约束。
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
- 不得在 QxShell Bottom Bar 下方叠加第二条控制栏、快捷键提示栏或全局 Settings/Hide footer；这些入口必须合并进 QxShell 的 escape/action/island 协议。

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

- 使用 `Tabs` 切换 Installed / Browse，不使用 `SegmentedControl`。
- 列表项禁用行内开关；启用/禁用、偏好配置统一放在右侧详情区。
- 导入区、详情区分组使用 `Card` / `SettingsCard`。
- 搜索和偏好输入使用 shadcn `Input`，不暴露原生 `<input>` 外观。
- 安装、刷新、加载使用 Skeleton 或 spinner。
- 响应式规则：`max-width: 760px` 下列表与详情上下堆叠，详情区隐藏，仅列表可点击展开详情。
- 完整实现与扩展规范见 [docs/plugin-architecture.md](./docs/plugin-architecture.md) 和 [public/doc/plugin-system.md](./public/doc/plugin-system.md)。

## UI States

页面和组件按适用范围覆盖以下状态：

- `initial`：尚未发起请求，不提前显示错误或伪进度。
- `loading`：保留稳定占位；列表首屏用 Skeleton，按钮用 spinner。
- `empty`：说明为空原因，并在可恢复时提供一个主动作。
- `partial` / `stale`：已有内容继续可见，同时标记刷新或部分失败。
- `success`：短反馈进入 Bottom Island 或局部状态，不长期占据布局。
- `warning` / `error`：说明影响、原因和 Retry/Open 等恢复动作。
- `offline` / `permission-denied`：不得伪装成空状态；指向网络或系统权限解决路径。
- `disabled`：控件不可操作且原因可发现，不只依赖降低透明度。
- destructive：删除/清空等不可逆操作必须确认，文案说明对象和影响。

状态分为页面级、区域级、列表行级、按钮级和 Bottom Island 长任务级；局部失败不得无必要替换整个页面。

## Loading States

- 列表首屏加载使用 Skeleton。
- 按钮异步状态使用 lucide `LoaderCircle` spinner，或同语义 lucide 动画图标。
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
- `max-width: 860px` 时通用 QxShell 隐藏 Context Panel；模块若需要保留详情，必须提供进入详情页、Dialog 或 Drawer 的明确入口，不使用未实现的“自动下移”假设。
- Top Bar 保持单行；空间不足时压缩搜索、图标化次要动作或收进菜单，搜索框不得小于可输入宽度。
- `681px-860px` 保留 Esc、Bottom Island 和主动作，并隐藏 Island 次级 detail。
- `max-width: 680px` 可隐藏 Bottom Island，为 Esc 和主动作让位；进行中的任务、错误和权限问题必须在主内容内保留等价可见状态，不能因 Island 隐藏而丢失反馈。
- 按钮文字必须截断或缩短，不溢出容器。

| 宽度 | Context Panel | Bottom Island | 操作策略 |
|---|---|---|---|
| `> 860px` | 显示 | 完整显示 | 可显示文本动作 |
| `681px-860px` | 隐藏 | 保留 label，隐藏 detail | 次要动作图标化或收入菜单 |
| `<= 680px` | 隐藏 | 可隐藏 | 主内容提供关键状态，保留 Esc 与主动作 |

## Accessibility

- 所有图标按钮必须有 `aria-label` 或同等可访问名称；Tooltip 不能替代 accessible name。
- Dialog、Popover、Dropdown 打开时焦点进入可操作区域，关闭后回到触发器；Esc 先关闭最内层 overlay。
- 列表、菜单、Tabs、Slider 遵循对应 WAI-ARIA 键盘模型；不可点击的 `div` 模拟按钮。
- 异步结果和错误使用适当的 `aria-live`，频繁进度不得持续打断屏幕阅读器。
- 表单错误与输入控件通过 `aria-describedby` / `aria-invalid` 关联。
- Focus ring 不得被 `outline: none` 无替代地移除；键盘操作必须能到达所有真实动作。
- 状态不得只靠颜色表达；至少同时提供文字、图标、形状或数值之一。
- 自动化最低要求：静态 a11y 检查 + 关键 Shell/Dialog 的键盘人工验收。

## Internationalization And Content

- 用户可见的标题、按钮、空状态、错误和通知必须通过 `useT()` 或统一翻译入口；品牌名、协议名和用户数据除外。
- 新文案同时提供 `en` 和 `zh-CN`，缺失翻译使用明确 fallback，不显示裸 key。
- 布局按中文和英文长文案验收；固定高度区域使用单行截断，重要完整内容通过 Tooltip 或详情呈现。
- 日期、时间、数字、百分比和文件大小使用 locale-aware formatter，不在组件内拼接语言相关格式。
- 快捷键符号不翻译；动作名称翻译。技术词汇应在 `i18n.ts` 中保持统一。

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

视觉验收矩阵：

- 尺寸：480×360、680×500、980×576、1280×800、1500×900。
- 主题：Light / Dark / System；透明度最低、默认、最高。
- 内容：空、正常、超长、加载、部分失败、权限拒绝。
- 输入：鼠标与纯键盘；动画正常与 `prefers-reduced-motion: reduce`。
- Light / Dark / 透明度调节下文本层级清晰。
- Select、Popover、Dialog、Dropdown、Tooltip 保持半透明且可读。
- Bottom Island 始终窗口居中。
- 小窗口、默认窗口、宽屏无横向滚动、无文字挤压。

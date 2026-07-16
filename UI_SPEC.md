# Qx UI Spec

> 状态：Current · 适用版本：v0.5.13 · Owner：Frontend · 最后复核：2026-07-14
>
> 事实来源：`src/components/QxShell.tsx`、`src/hooks/useEscBack.ts`、`src/styles/shell.css`、`src/styles/settings-actions.css`、`src/home-island/`、`src/modules/settings/plugins/`、`src/i18n.ts`
>
> 本文件是 UI 布局与交互的单一事实来源。实现与本文冲突时，以代码为据并回写本文件。

Qx 的 UI 目标是一个稳定、紧凑、可透明的桌面工具壳：搜索优先，内容居中，右侧给上下文，**底部左下角统一 Esc 返回**，中间承载状态与可扩展灵动岛，右侧承载动作。模块只替换内容区和 Context Panel，不重新发明主壳。

## Core Rules

- 主壳固定为三层：Top Bar / Main Area / Bottom Bar。
- 搜索是第一入口；模块内搜索必须放在 Top Bar。
- **主搜索可直达模块子界面**（Module Surfaces：订阅源、会话、宏等）。协议见 `docs/module-surfaces.md`；用户可在 Settings → Appearance → Launcher Search Sources 按模块关闭接入。
- Screen Recording、Weather、V2EX、Macro Recorder 标记为 **Beta**：模块名后使用浅色虚线 `Beta` 标识，并通过 tooltip/模块设置说明其可能不稳定。Beta 标识只表达成熟度，不用整卡警告色。
- 可关闭的 Beta 内置模块在 Settings → Extensions → Installed 的模块配置 Dialog 中启停。关闭后必须同时从 Quick Entries、Launcher 静态命令、Module Surfaces 和直接导航中移除；对应 lazy view 不得挂载，模块 effect / IPC 数据请求不得启动。Settings 中的模块卡仍保留，作为重新启用的唯一管理入口。
- **返回只走 Bottom Bar 左下角 Esc**（`escapeAction` + `useEscBack`）。Top Bar 默认不渲染返回箭头；禁止模块在 Top Bar 再做一套返回。
- 右侧 Context Panel 只放导航、辅助信息和当前对象操作入口，不放第二套主布局。
- **Context 侧栏宽度全局统一**：只用 `--qx-context-w`（`QxShell.has-context` 的 grid 第二列）。禁止模块用 inline style / localStorage 改写该变量；列表内部分栏（如 RSS 文章列表宽）可单独 token，不得影响 shell context 列宽。
- Bottom Bar 使用 `grid-template-columns: auto 1fr auto`。
- Bottom Island 必须相对窗口居中：`position: absolute; left: 50%; transform: translateX(-50%)`。
- `.qx-shell-bottombar` 必须 `position: relative`。
- **Top / Bottom chrome 厚度接近**：共用水平 inset 与相近高度 token，禁止顶栏做成远厚于底栏的「大标题板」。
- **Launcher 空闲灵动岛可插拔**：模式走 `src/home-island` 注册表；指标采样必须异步非阻塞。
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
  --qx-shell-chrome-x: 14px;              /* topbar / bottombar 共用水平 inset */
  --qx-topbar-h: clamp(48px, 6vh, 54px);  /* 与底栏接近，禁止顶栏厚到 90px+ */
  --qx-bottom-bar-h: clamp(46px, 5.8vh, 54px);
  --qx-context-w: clamp(240px, 28vw, 340px); /* 全应用唯一 Context 侧栏宽度；模块禁止覆盖 */
  --qx-search-min-w: 220px;
  --qx-radius: 8px;
  --qx-control-radius: 6px;
}
```

- Top / Bottom 水平内边距必须都用 `--qx-shell-chrome-x`，不得一边 16px 一边 14px。
- Topbar 内搜索控件高度应适配 slim chrome（Shell 内默认约 `36px`），不得把栏高重新撑开。
- 窄屏可下调 `--qx-shell-chrome-x`（如 `10px`），上下栏同步。

视觉模式由 `QxShell` 的 `visual` prop 选择：

- `solid`：列表、Launcher、Clipboard 等高频扫描界面。
- `elevated`：Settings、表单、偏好设置。
- `glass`：阅读 overlay、截图、临时沉浸工具。

模块不得覆盖 `.qx-shell-topbar`、`.qx-shell-context`、`.qx-shell-bottombar` 的核心背景语义；只允许做尺寸、滚动和模块内容布局适配。

QxShell 的纵向结构高度不得因为窗口左右缩窄、文字变长、筛选项变化或 trailing 操作变多而改变。Top Bar 和 Bottom Bar 必须使用固定高度约束；响应式只能改变列宽、隐藏次级内容、图标化或折叠菜单，不能让 Shell 区域增高、换行或重排成多行。

### QxShell 契约（模块接入）

每个可打开模块必须用 `QxShell`，并同时满足：

| 职责 | API / 机制 | 说明 |
|---|---|---|
| 可见 Esc | `escapeAction` | 左下角唯一返回入口；`variant="escape"` 只显示快捷键胶囊（通常 `Esc`） |
| 键盘 Esc 级联 | `useEscBack` → `onKeyDown` | 处理 inner → query → launcher；命中后 `preventDefault` + `stopPropagation` |
| Shell 最终兜底 | `QxShell` 内置 | 若模块 `onKeyDown` 未消费 Esc，则触发 `escapeAction.onClick` |
| 搜索 / trailing | `search` / `trailing` | 搜索在 Top Bar 主列；筛选与少量上下文操作在 trailing |
| 状态 | `island` / `customIsland` | 轻量任务与位置信息，见 Bottom Island |
| 主动作 | `primaryAction` / `secondaryAction` / `actions` | 当前上下文真实可执行动作 |
| **i18n** | `useT(key, englishFallback)` | **所有用户可见文案**（标题、按钮、空态、toast、confirm）必须可翻译；中文进 `i18n.ts` 的 `zh` 表 |

**禁止：**

- `primaryAction` / `secondaryAction` / `actions[]` 使用 `kbd: "Esc"` / `"Escape"`（Esc 专属 `escapeAction`）。`QxShell` 在 action 匹配时会忽略 Esc。
- 在 Chat Settings 等表单页把 “Done” 标成 `kbd: Esc`（会与级联冲突、且违反 UI_SPEC）。
- 模块硬编码中文或英文 UI 字符串而不走 `useT`（`console` / 开发注释除外）。

推荐写法：

```tsx
const goBack = () => setTab("launcher"); // 或返回上一级视图
const { onKeyDown } = useEscBack({
  inner: { active: showDetail, close: () => setShowDetail(false) },
  query: { active: !!localQuery, clear: () => setLocalQuery("") },
  launcher: goBack,
});

return (
  <QxShell
    title="Module"
    search={/* search slot */}
    escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
    onKeyDown={onKeyDown}
    island={{ label: "Module", detail: "…" }}
    primaryAction={{ label: "Open", kbd: "↵", onClick: openSelected }}
  >
    {/* content */}
  </QxShell>
);
```

禁止：

- 同时传 `onBack` 与 `escapeAction`（会画出左上角箭头 + 左下角 Esc，双返回）。
- 新代码依赖 `onBack` / `backLabel` 渲染 Top Bar 返回箭头。`onBack` 仅为历史兼容；模块应只传 `escapeAction`。
- 在 Context Panel 外再做一套全局返回栏或 footer。
- 复制 Esc 监听逻辑而不走 `useEscBack`。

## Theme

主题采用 shadcn/Tailwind 语义 token + Qx 透明度算法：

- `ThemeProvider` 必须同步设置 `data-theme` 和 `.dark` class。
- `src/App.css` 通过 `@theme inline` 暴露 shadcn 标准 token。
- `src/styles/base.css` 负责把 Qx token 映射到 shadcn token。
- 透明度只作用在 surface/background token 上，不使用组件整体 `opacity`。
- 系统毛玻璃是独立开关：关闭时原生 Vibrancy/Acrylic 与 CSS backdrop blur 同时关闭，所有表面以不透明 token 渲染；重新开启恢复此前参数。
- 窗口不透明度与模糊半径必须独立：不透明度允许 5%–100%，模糊允许 0–30px；不得再由不透明度推导模糊值。
- Appearance 分别控制窗口背景、Top Bar/Context、内容表面、Action/控件和 Bottom Bar；禁止再由单一透明度滑块推算全部区域。
- Popover 属于 Action/控件视觉层，并以 Bottom Bar 的磨砂强度为下限；它不得与普通内容背景使用相同 alpha。
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
- 列表、工具栏和信息区的功能/内容类型图标默认使用中性色，不按文件类型、模块或装饰目的分配多种强调色；强调色只用于当前选中项、置顶/固定状态、主操作和危险操作。
- 图标容器尺寸必须固定，避免 hover、loading 或选中状态造成布局跳动。

动画：

- loading、同步、刷新、处理中的状态优先使用 lucide `LoaderCircle` / `RefreshCw` 等图标配合 Qx 统一 spinner 动画。
- 需要表达状态变化、确认、警告或轻量反馈时，可以使用 lucide 图标动画；动画只服务于状态理解，不做持续装饰。
- 常规 UI 过渡优先使用 CSS transition/keyframes；跨组件进入/退出或复杂状态编排可使用 `framer-motion`，但不得改变 Shell 三层结构尺寸。
- 所有循环动画、shimmer、marquee、spinner 和 lucide 动画都必须在 `prefers-reduced-motion: reduce` 下停止或降级为静态状态。
- 动画时长保持短促：反馈动画约 `120ms-240ms`，弹层/列表进入约 `160ms-220ms`，持续 loading 只保留必要旋转或点状状态。
- 不使用纯装饰的漂浮、呼吸、渐变光斑或大面积背景动画。

## Top Bar

Top Bar 包含搜索、可选 leading、筛选和少量上下文操作。**不包含模块返回**；返回统一在 Bottom Bar 左下角 Esc。

列布局：

| 条件 | 类名 / 网格 | 列含义 |
|---|---|---|
| 默认（无 leading / 无 `onBack`） | `.qx-shell-topbar.no-leading` → `minmax(search) 1fr · trailing` | 搜索主列 + trailing |
| 有 `leading` 或历史 `onBack` | `.qx-shell-topbar` → `auto · minmax(search) 1fr · trailing` | leading + 搜索 + trailing |
| Launcher 两栏 | `.launcher-shell .qx-shell-topbar` | 搜索对齐 Content / Context 分割线 |

要求：

- 模块搜索统一使用 `qx-search-wrap` + `qx-plugin-search`。
- 搜索框自动聚焦。
- 搜索是 Top Bar 的主体内容，并保留一个独立、紧凑的输入控件表面；只允许一层边框、背景和 focus ring，不得再包裹第二张搜索卡片或装饰容器。
- 列表型模块中，搜索文字的起始位置必须与主列表行标题列的起始位置对齐，允许误差不超过 `4px`；对齐对象是标题文字，不是列表外边缘或类型图标。列表行本身不得为「已删除的顶栏返回」预留大段 `padding-left`。
- Launcher 等带 Context Panel 的两栏 Shell，搜索卡片右边缘必须与 Main Area / Context Panel 分割线对齐，允许误差不超过 `4px`；筛选控件位于右侧 trailing/context 轨道。
- 搜索占据可用主列；筛选和少量上下文操作固定在 trailing 列，不得把搜索缩成短输入框。
- Quick Entries 不以成组图标占用 Top Bar；它们保留在 Context Panel、Actions 或专用入口中。Top Bar trailing 只保留筛选和当前上下文必需操作。
- Launcher 右侧默认 Quick Entries 只保留剪贴板、RSS 阅读、设置和文件搜索。文件搜索入口切换到 Files scope、清空旧 query 并聚焦搜索框；其他模块仍可由用户在编辑模式中自行添加。
- Launcher 的 All / Files 搜索中，每次非空 query 变化（输入、删除、粘贴）都必须立即调用文件搜索 pass 0；后续 pass 可异步增量合并，但不得以字符数阈值、Enter 或失焦作为首次调用条件。旧请求必须由序号/取消信号隔离，不能覆盖新 query。
- trailing 操作不得挤压搜索框到不可输入。
- Top Bar 必须保持单行。筛选、状态和 trailing 操作不得换行，不得移动到第二行，也不得用 `grid-column: 1 / -1` 做窄屏兜底。
- 窄屏空间不足时，优先压缩搜索宽度、限制 trailing 最大宽度、隐藏次要状态文本、使用图标按钮或把低频动作收进菜单；不得通过增加 Top Bar 高度解决。
- Top Bar 高度不得随窗口宽度变化。模块样式不得只用 `min-height` 允许内容撑高 Top Bar；必须保持固定 `height` / `max-height` 或等价 block-size 约束。
- 可交互元素必须 `-webkit-app-region: no-drag`。
- 筛选使用 shadcn Select，不使用原生 select。
- 模块 CSS 不得再为 `.qx-shell-back` 写专用尺寸；返回箭头不是产品默认路径。

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
- Main Area 在几何上延伸到 Top/Bottom Bar 背后；上下栏使用单层自适应磨砂材质、
  细边缘高光和短距离 scroll-edge fade。禁止在整个 Shell 与上下栏重复叠加 blur。
- 内容滚动容器使用与上下栏等高的安全 inset；滚动时内容可以进入栏后并被材质柔化，
  初始内容和键盘滚动落点不得被栏遮挡。
- 内容列表、详情、Context Panel 各自管理滚动。
- 左右栏滚动互不影响。
- 任意宽度下不得产生横向页面滚动。
- **滚动条**：所有原生 scrollbar chrome 永久隐藏，统一由 `src/utils/overlayScrollbar.ts` 绘制固定浮层拇指；仅对应区域**正在滚动**时短暂显现，停止后自动淡出。普通 overflow、Radix ScrollArea 和插件 iframe 必须使用同一细线样式；勿在业务模块写常驻宽滚动条或第二套 scrollbar。

Context Panel：

- 宽度填满 `var(--qx-context-w)`。
- 面板本身就是容器，不再套大卡片菜单。
- 列表项可有 hover/active，但不要把整个右栏做成一张卡。

### 阅读类主区（RSS 等）

仍用 **同一套 QxShell**（Top / Main / Bottom / Context），但主区内容按阅读优化，与列表工具的「密排扫描」区分：

- 打开文章时 Shell 可切 `visual="glass"`，并给 shell 加 `is-reading`。
- **正文字行长随阅读列宽变化**（不强制居中 max-width measure）；列表栏可略收一点让出正文。
- Context 仍只放动作，宽度继续用全局 `--qx-context-w`（略紧即可，不单独加宽）。
- 正文字号/字体来自 Settings → RSS；正文排版（段落/标题/代码）可增强，但**文章标题样式保持原逻辑**。

## Bottom Bar

结构：

```text
[ Esc ]        [ Bottom Island ]        [ Primary / Secondary / Actions ]
```

布局：`.qx-shell-bottombar` 为 `position: relative` + `grid-template-columns: auto 1fr auto`；Island 绝对居中叠在中间轨。

### 左侧 · Esc（唯一可见返回）

- 只渲染 `escapeAction`（或兼容路径下由 `onBack` 推导的 fallback），通过 `ShellActionButton variant="escape"`。
- escape 变体**只显示快捷键**（`kbd`，通常为 `Esc`），不重复显示模块名或图标。
- `escapeAction.onClick` 必须与 `useEscBack` 的最终一级（`launcher` / 上一级视图）语义一致：
  - 模块根视图 → `setTab("launcher")` 或关闭 Settings 等。
  - 子视图（如 QxAI chat/settings、RSS detail）→ 回到模块内上一级列表。
  - 录制等临时态可先停任务 / 丢弃草稿，再在级联下一层离开。
- 禁止用右侧 `primaryAction` / `secondaryAction` 的 `kbd: "Esc"` 替代左下角 Esc；Esc 快捷键归属左侧。

### 中间 · Bottom Island（QxIsland）

- 由 `QxIslandDockSlot` / `QxIslandSurface` 统一渲染（`docs/qx-island-architecture.md`）。
- **统一高度 `34px`**（min 32 / max 36）；docked 宽 `min(400px, calc(100% - 260px))`。
- Chrome（尺寸、居中、玻璃/border）只在 `.qx-island-surface`；内容不得自带 absolute 外轮廓。
- 模块 `island` prop 经 shim 写入 session store；`customIsland` 为分类例外（如录屏 HUD），会抑制 store docked。
- 文本单行截断，progress 为底边 overlay，不撑高底栏。
- 为空时 `visibility: hidden` 保持布局稳定。
- Appearance 可启用独立的 External Island Display。它只显示 host task 或获 `island`
  权限的插件结构化 slots；插件不能提供自定义 chrome、窗口坐标或置顶策略。主窗隐藏
  显示与 always-on-top 均由用户设置决定，同一 session 默认不在 docked / floating 双显。

### 右侧 · Actions

- 只显示当前上下文真实可执行动作（`primaryAction` / `secondaryAction` / `actions`）。
- 无可用动作时不渲染按钮。
- `Actions` 打开临时菜单，不把菜单内容塞进 Context Panel。
- 不得在 QxShell Bottom Bar 下方叠加第二条控制栏、快捷键提示栏或全局 Settings/Hide footer；这些入口必须合并进 QxShell 的 escape/action/island 协议。

Actions Menu：

- 点击 Actions 或 `Cmd+K`（Windows：`Ctrl+K`）打开 / 关闭（Raycast Action Panel 语义）。
- 锚定在底栏右侧按钮上方。
- 点击 Qx 窗口内菜单以外区域关闭；关闭走 shadcn/Radix Popover 的 `data-state` 进出动画，不得瞬时卸载导致无动画。
- 菜单打开后，键盘优先操作菜单本身（capture 阶段拦截，避免列表 / 搜索框抢走按键）：
  - `ArrowUp` / `ArrowDown`：高亮上一项 / 下一项（跳过 disabled）。
  - `Home` / `End`：第一项 / 最后一项。
  - `Enter`：执行当前高亮项。
  - 单字母 `kbd`：执行对应菜单项（仅菜单打开时）。
  - 菜单项上标注的组合键（如 `Cmd+C` / `Cmd+P` / `Cmd+Backspace`）：菜单打开时同样直接执行对应项（Raycast Action Panel 语义）；裸 `Enter` 仍只执行当前高亮项。
  - `Esc` 或再次 `Cmd+K` / `Ctrl+K`：关闭菜单，并**恢复打开菜单前的焦点**（搜索框 / 列表 / region）；列表 `navigation` 选中项不得因菜单内上下键而改变。
  - 关闭菜单后的下一次 `Esc` 才走 `escapeAction` / `useEscBack` 离开模块。
- 菜单项来自模块传入的 `actions`（当前选中对象上下文）。
- 模块不得在搜索框聚焦时用裸字母（如 `n` / `s`）强行拦截输入；裸快捷键仅在非编辑目标、或 Actions 菜单打开时由 Shell 协议处理。

## Bottom Island

权威模型为 `IslandSession` + `IslandSlotContent`（`src/island/`）。模块仍可传遗留 `BottomIslandContent`；shim 映射为：

| 遗留字段 | slots |
|---|---|
| `label` | `primary` |
| `detail` | `secondary` |
| `progress` / `activity` | `meter` |
| `actionLabel` / `onAction` | `action` + `bindActions` |

遗留形状（仍支持）：

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

### Launcher 空闲 · Home Island（可插拔）

Launcher 在**无搜索活动、无结果**时，由 **Launcher 单写者**经 `islandHost` 发布 `priority: "home"` session。实现位于 `src/home-island/` + `src/island/`，不得再把模式 if/else 写进 `Launcher.tsx` / `AppearanceSettings.tsx`。

| 角色 | 位置 | 职责 |
|---|---|---|
| 统一层 | `src/island/` | Surface / session store / host API / DockHost |
| 注册表 | `home-island/registry.ts` / `catalog.ts` | `registerHomeIsland` / list / normalize |
| 解析 | `resolveHomeIsland` | idle → slots 或 componentId |
| 贡献 | `useHomeIslandContribution` | 仅 Launcher 写全局 `home` |
| 设置 UI | `HomeIslandSettings` | 卡片网格；preview 用本地 Surface，不写全局 home |
| 异步数据 | `data/bus.ts` + hooks | 指标采样；组件只读缓存 |

内置模式（示例）：`default`（shell 文案）、`system`、`date`、`pulse`（网速）、`core`（电源）、`orbit`（任务时钟 + CPU）。`home_island_mode` 为自由字符串；未知 id normalize 到默认模式。富组件仅 docked；浮窗 v1 slots-only。

**新增模式只需：**

1. `modes/FooIsland.tsx`（content-only，无 absolute 尺寸）+ `modes/fooMode.tsx`
2. `catalog.ts` 中 `registerHomeIsland(...)`；若 custom，在 `island/home/registerHomeComponents` 注册 `componentId`
3. `i18n.ts` 补 title/hint 中文

**不要**改 Launcher 或 Appearance 的分支表。

### Home Island 异步数据（强制 · 非阻塞）

系统指标、网速、电源等采样**不得阻塞 paint、搜索或键盘**。

```text
岛 UI ──subscribe──► data/bus ──idle/timer──► Tauri invoke (Rust spawn_blocking)
  ▲                      │
  └── useSyncExternalStore（只读缓存）
```

通用要求：

1. **首屏**：先渲染占位（`--` / 空 VU / 空条），禁止在 render 路径 `await invoke`。
2. **首次采样**：`requestIdleCallback`（fallback `setTimeout(0)`），不得同步打满主线程。
3. **兴趣计数**：仅挂载中的模式订阅的 channel 才轮询；卸载即减引用。
4. **隐藏暂停**：`document.hidden` 时停表；可见后 idle 再采。
5. **防重入**：channel 级 in-flight；重叠采样直接跳过。
6. **共享**：同一 channel（如 `stats`）多模式共享一次 IPC。
7. **失败**：缓存上次值或占位；错误记入 bus，不 throw 到 React。
8. **主题**：岛 UI 只用 `--qx-system-island-*` / `--qx-stats-*` 等 token，跟随 Light / Dark / System 主题。

Hooks：`useIslandStats` · `useIslandPower` · `useIslandNet` · `useIslandData([...])`。新指标优先扩展 bus，而不是在组件内私自 `setInterval + invoke`。

自定义 Home content 渲染在统一 Surface 内：高度 **34px**，宽 `min(400px, calc(100% - 260px))`，居中由 surface 负责；窄屏规则挂在 `.qx-island-surface`。

## Module Layouts

所有下列模块的返回均只通过 `escapeAction` + `useEscBack`，不传 `onBack`。

Launcher：

- 左侧搜索结果，右侧常用入口和最近项。
- 搜索结果、右侧入口、底部动作都支持键盘操作。
- 主搜索选中行必须明显区别于普通 hover：使用弱 accent 混合背景与完整的浅蓝色细描边，不使用点阵、左侧实线或括号式轮廓，也不得仅依赖在浅色透明主题下难以辨认的 component 背景层级。键盘选中项越过可视区域时必须以 `block: nearest` 自动滚动跟随。
- 内置模块命令必须同时匹配英文标识、当前中文名称与常用功能别名；例如“设置 / 偏好设置 / 扩展 / 快捷键 / 外观”都应召回 Qx Settings，并以命令自身的匹配档位参与排序，不能被同名系统应用或文件结果挤掉。
- Search 是默认键盘归宿：除文本输入、编辑器、IME 组合输入或打开的 Dialog/Menu/Listbox 外，普通点击结束后焦点回到当前 Shell 搜索框；焦点意外落在非编辑控件时，首个可打印字符或删除键必须转交 Launcher 搜索且不能丢字。
- 查询输入与结果发布解耦：输入先绘制，约 45ms 静默窗口后再启动 latest-wins provider；旧请求立即失效，渐进批次合并后避开输入帧提交，排序 Worker 常驻且只保留最新等待任务。
- Esc 级联（根视图）：有搜索文字时 **清空 query**（可继续输入并用 Enter 打开结果）；query 已空时再 Esc 才隐藏窗口（host escape）。
- 有搜索文字时底栏 Esc 清空；无文字时同一 Esc 动作隐藏 Launcher。可见动作与键盘行为必须一致，不得渲染无 `onClick` 的禁用式 Esc 占位。
- 空闲 Home Island 由 `resolveHomeIsland` 解析；搜索中 / 有结果 / 插件 status 优先占用 shell island。

Clipboard：

- 左侧历史列表，右侧预览和信息。
- 列表、预览、信息区独立滚动。
- 置顶、复制、删除等动作走 Bottom Bar / Actions。
- 单击左侧条目必须把该条目写入系统剪贴板，供用户随后手动粘贴；不得在单击时自动向前台应用发送粘贴键。
- 文本条目支持双击列表行或右侧预览进入编辑。编辑始终先进入本地草稿，默认不落库；草稿变化后灵动岛显示红色未保存提醒，并提供“保存”和“另存为新条目”。切换条目、按 Esc 退出编辑或离开模块时，未明确保存的修改直接丢弃。
- 左侧日期分组标题是可点击的日期筛选入口；Popover 使用 Geist Calendar，支持本地时区下的单日或包含首尾日期的范围选择、月份与键盘导航，以及今天、最近 7 天、最近 30 天和全部日期预设。触发器在选择后保持显示已提交范围。
- Esc → launcher；列表行不预留顶栏返回缩进。

RSS：

- 阅读器可使用三栏：Feed / Article List / Detail。
- 三栏宽度可以拖拽调整，宽度写入本地状态或设置。
- 每栏必须有最小宽度，拖拽时不得产生横向页面滚动。
- 详情阅读可隐藏 Context Panel 或使用 overlay bottom bar。
- Esc 级联：详情 → 文章列表 → Feed 列表 → launcher。

V2EX / Weather / DevTxt / Screen Capture / Macro / Plugin Host：

- 统一 `escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}`。
- 录制类模块：Esc 可先停止录制或丢弃草稿，再在下一层离开；不要静默无出口。

Screen Capture：

- 截图与录屏共用一个模块、历史列表和显示器选择协议；截图保存 PNG，录屏保存 MP4/MOV 并可按需转 GIF。
- 显示器枚举、稳定 ID、内置/外接/主屏判断、鼠标所在屏幕和跨后端映射属于 Qx 系统级能力；截图、窗口管理、浮窗与热插拔监听必须消费同一服务，不得在模块内各自判断。圈选尚未开始时，截图工具由后台低频检测鼠标所在显示器并随跨屏移动；一旦开始框选、已有选区或进入确认流程就停止跟随，避免编辑状态被迁移。
- Qx 首次启动后的第一次唤起也必须出现在鼠标所在显示器与当前 macOS Space；不得沿用隐藏窗口创建时的主屏、DPI 或桌面归属，后续唤起遵循同一规则。
- 区域圈选初始覆盖鼠标所在显示器；顶栏提供 **区域 / 窗口 / 全屏** 模式、内置屏/外接屏切换；捕获目标必须携带显示器 ID，不得把外接屏圈选错误映射回主屏。
- 入口意图（截图 / 录制）决定确认条主按钮高亮与 Enter 默认动作；仍可在确认前切换。模块主界面只保留双入口（截图 / 录制），不再提供绕过圈选的「直接开始主屏全屏录制」歧义路径。
- 圈选确认方式可配置：**精修后捕获**（默认：松手只建选区，可移动、四角+四边缩放后再确认）或 **松手即捕获**（按意图立即截图/录制；按住 Alt/Option 强制进入精修）。点暗幕可重画选区。
- 确认工具条：截图 / 录制；截图路径提供矩形、箭头、文字、画笔、序号、马赛克与颜色，标注只进入 PNG，不进入录屏（有标注时禁用录制）。键盘：Enter 确认、双击选区确认、Space 全屏、S/R 意图、Tab 区域/窗口、1–6 工具、⌘Z/⇧⌘Z 撤销重做、Esc 分层退出。上次成功选区在同一显示器上会作为默认精修起点。
- 延迟 0/3/5s 可配置；倒计时期间圈选窗穿透桌面输入，Esc 取消倒计时。
- 窗口模式：悬停高亮可见窗口轮廓，单击选定后进入与区域相同的精修/确认路径。
- “开始截图”和“开始录制”是两个独立 Launcher command，也是默认关闭、可录入的全局快捷动作。
- 截图完成后的默认动作可配置为“自动复制到剪贴板”或“仅保存”；复制失败不得删除已经保存并写入历史的 PNG。模块内展示轻量 post-capture toast（打开 / 复制 / 显示）。
- “显示/隐藏捕获灵动岛”是第三个默认关闭、可录入的全局快捷动作，只切换捕获工具栏，不改变主窗口当前 route。
- 用户可开启 340×36 常驻捕获灵动岛；空闲时提供截图/录制入口，录制中切换为时长、帧数和停止控制，控制窗始终启用内容保护。
- 空闲捕获岛提供截图、录制、捕获历史和关闭入口；历史入口打开 Screen Capture 模块，并保持左侧标准 Qx 列表、右侧预览/设置布局；历史项以图标区分截图与视频。
- 区域录制开始后，受保护的选区边框必须保持可见并切换为鼠标穿透，录制灵动岛贴近选区下方；停止后恢复同一选区的拖动/缩放和再次截图/录制能力。全屏录制的控制岛固定在所选显示器工作区底部。
- 录制边框只能使用缩小到选区尺寸的轻量窗口，禁止保留覆盖整块显示器的透明 WebView；鼠标穿透设置失败时宁可隐藏装饰边框，也不得阻塞桌面输入。截图完成后立即关闭圈选窗口，并恢复常驻捕获岛或原模块界面。

QxAI：

- 列表：Esc → launcher。
- Chat / Settings：Esc → 会话列表（`setView("list")`），不是直接 launcher。

### Documents（文本工具箱 · 简易 Notepad++）

- 定位：不想开 VS Code 时的 **快速文本便签/草稿编辑**（加一行、改一行）。
- 布局：**左侧文本文件列表 + 右侧编辑区**；Context 为文件信息、语言与操作。
- 语言（SQL / Java / JSON…）通过 Context 芯片或 Actions 设置，存在每个文件元数据里（`language`）。
- 文件列表本地持久化（`localStorage`）；Esc：重命名 → 清空搜索 → launcher。

Settings：

- 使用 `visual="elevated"`。
- Esc / Close → 关闭设置面板。
- 面板结构、设计令牌、**线性分区**（`SettingsCard` 实为 section + hairline `Row`，非营销大卡片）、响应式与新增页步骤见 [docs/settings-panel.md](docs/settings-panel.md)。

### Settings · Extensions / 已安装模块（成熟小卡片）

实现：`src/modules/settings/plugins/`（`PluginManager` → Installed / Browse）。视觉在 `settings-actions.css` 的 `.qx-plugin-module-card*`。

**产品形态（对标 Raycast 扩展格 / 系统设置密度，不是后台管理大卡片）：**

| 层 | 规则 |
|---|---|
| 列表 | 响应式 **小圆角 tile 网格**，`repeat(auto-fill, minmax(112px, 1fr))`，`gap: 8px` |
| 卡片封面 | 只暴露 **图标 + 名称 + 一行弱状态**；点击打开配置 |
| 二级配置 | **悬浮 Dialog**（带阴影 / 毛玻璃），承载启用、命令、快捷键、别名、偏好、卸载 |
| 页级操作 | 导入归档、筛选搜索、Browse 市场留在页面，不塞进每张卡 |

**卡片封面禁止：**

- 双 Badge（On/Off + Built-in 同时堆在角上）
- 封面上的长描述截断段落
- 营销式大写 CTA（如 `CONFIGURE`）
- 重阴影、抬升 translate、装饰渐变底
- 行内开关（启用/禁用进 Dialog，不在 tile 上直接点）

**卡片封面必须：**

- 圆角 **8px**（`--qx-card-radius` 量级），小卡密度，不是 12px+ 大板
- 无默认 box-shadow；hover 只换 **边框 / 背景**（`bg-component-1` → `2`）
- 图标约 **36×36**、圆角 **8px**，居中偏上
- 标题 **12px / semibold**，单行省略
- 状态行 **10px / tertiary**：`Disabled` · `Built-in` · `vX.Y.Z` 三选一优先（禁用优先于版本）
- 禁用模块：整卡 `opacity ≈ 0.55`，不另做大红 Badge
- `focus-visible` 用 accent 描边，可键盘打开
- Beta 内置模块的标题后可显示单个浅色虚线 `Beta` 标识；不得再叠加第二个醒目成熟度 Badge

**配置 Dialog：**

- 使用 shadcn `Dialog`（`.qx-shadcn-dialog-content` + `.qx-plugin-config-dialog`）
- 宽约 `min(560px, 100vw - 40px)`，带清晰阴影与边框；内容区可滚动
- 标题 = 模块名；说明一句即可（设置 / 快捷键 / 偏好）
- 详情内分组仍用 `SettingsCard` + `Row`；快捷键 `ShortcutRecorder`；别名 `SearchAliasTagEditor`
- Esc 先关 Dialog，再回 Settings 级联
- 可关闭的 Beta 内置模块在 Status 分组提供启用开关，并明确关闭会停止入口、搜索接入、界面挂载和数据请求；稳定核心内置模块保持不可关闭

**Tabs：**

- Installed / Browse 用 `Tabs`（不是顶栏 `SegmentedControl` 代替主切换）
- 首行保持单层紧凑工具条：Tabs 在左；Raycast Actions 开关、Import、Rescan 在右；窄宽度可换行但不得扩成说明卡片
- Import 打开独立 `Dialog`，集中承载本地压缩包、GitHub archive 与 Raycast extension URL 三种入口
- 搜索已安装 + 过滤（All / Built-in / External / Enabled / Disabled）紧随首行，模块网格无需经过大段说明内容即可到达
- Raycast Actions 的完整说明使用 tooltip / accessible description，页面上只保留短标签和开关

**成熟度原则（写给后续设计）：**

1. **封面极简，详情完整** — tile 只负责识别与入口；配置密度放在二级浮层。  
2. **桌面工具，不是运营后台** — 避免徽章墙、彩色状态条、大按钮 CTA。  
3. **与 Settings 其它页一致** — token / 圆角 / 字号阶梯对齐 `Row` + `SettingsCard`，不要另起一套视觉语言。  
4. **可扫描** — 图标对齐、标题基线一致；网格宁可多空一列，不要挤成 200px 宽信息卡。

参考实现：`InstalledModuleCard.tsx`、`.qx-plugin-card-grid`、`.qx-plugin-config-dialog`。  
插件协议与运行时见 [docs/plugin-architecture.md](./docs/plugin-architecture.md)、[public/doc/plugin-system.md](./public/doc/plugin-system.md)。

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

### Esc 协议（强制）

键盘与可见按钮共用同一套返回语义。

**A. 键盘级联 · `useEscBack`**

```ts
useEscBack({
  inner: { active, close },   // 1. 详情 / 预览 / 弹层 / 输出视图
  query: { active, clear },   // 2. 模块本地搜索
  launcher: goBack,           // 3. 回 launcher 或模块上一级
});
```

规则：

- 每层命中后必须 `preventDefault` + `stopPropagation`，不继续递进。
- 模块不得自写 Esc 监听；新子状态必须挂到 `inner`。
- 打开的 Dialog / Popover / Dropdown / Actions 菜单优先于模块级联；最内层 overlay 先关。

**B. 可见按钮 · `escapeAction`**

- 左下角 Esc 按钮的 `onClick` 等于当前级联的**最终一级**（与 `launcher` / 上一级 `goBack` 相同）。
- 级联的中间层（关详情、清搜索）只由键盘 `useEscBack` 处理；不要把中间层绑到左下角按钮，以免单击 Esc 胶囊跳过中间层语义混乱。若模块需要「按钮也关闭详情」，应把当前视图的返回目标设为「关详情后的父级」，而不是跳过父级直接 launcher。

**C. Shell 兜底**

- 模块 `onKeyDown` 未消费的 `Escape`，由 `QxShell` 调用 `leftAction.onClick`（即 `escapeAction`）。
- 因此 `escapeAction.onClick` 不得省略；省略时左下角可能只显示不可用的 Esc 外观。

**D. 与 Top Bar 的关系**

- Top Bar **不**再承担返回。
- 禁止 `onBack` + `escapeAction` 双开。
- Context Panel 内的「Back to …」动作项可作为辅助入口，快捷键仍标 `Esc`，行为必须与 `escapeAction` 一致。

### 键盘导航

事件从最具体到最宽泛：

1. 原生可编辑控件与系统编辑快捷键（复制/粘贴/全选/IME）。
2. 打开的 Dialog / Popover / Dropdown / Actions 菜单。
3. 模块 `useEscBack` 与模块专有命令。
4. `data-qx-region` 左右区域切换与阅读区滚动。
5. `QxShell.navigation` 列表移动与展开/收起。
6. 可见动作快捷键与最终 Esc 兜底。

QxShell 的区域、列表与内容移动统一由 `useQxShellNavigation` +
`navigationModel` 处理，模块不得复制方向键/Page/Home/End 的索引计算或
`data-qx-region-scroll` 滚动算法。`QxShell.navigation` 可用 `regionId` 将
列表移动限制在指定区域；`editable` 策略默认为 `search`：搜索框允许用
上下键/Page 键移动结果，但 textarea、普通 input 和 contenteditable 保留
原生光标、选区与滚动行为。只有明确的非编辑型自定义控件才能选择 `all`。

**列表选中外观与滚动追随**（与按键分离）统一由 `useQxListSelection` /
`getQxListItemProps`（`src/hooks/useQxListSelection.ts`）实现：

| 职责 | 接口 |
|---|---|
| 上下键改 `index` | `QxShell.navigation` |
| 浅色选中背景 | 行 class：`qx-list-row` + `is-active` → `var(--qx-bg-component-3)`（Launcher 可叠加 accent） |
| 滚动追随 | `data-qx-list-index` + `scrollIntoView({ block: "nearest" })` |
| 行 props | `getItemProps(i)` 或 `getQxListItemProps(i, selected)` |

模块只维护 `selected` 状态并传入 `navigation={{ index, count, onChange }}`，
不得再手写 `querySelector('[aria-selected]')` / 各自 `scrollIntoView`。

标准映射：

| 按键 | 行为 |
|---|---|
| `ArrowUp` / `ArrowDown` | 上一项 / 下一项 |
| `PageUp` / `PageDown` | 按 pageSize 翻页 |
| `Home` / `End` | 首项 / 末项（非编辑焦点时） |
| `ArrowRight` | 打开详情 / 预览（若有） |
| `ArrowLeft` | 关闭详情 / 预览（若有） |
| `Enter` | 主操作 |
| `Esc` | 见上方 Esc 协议 |
| `Cmd+K` / `Ctrl+K` | 打开 Actions 菜单 |
| `Cmd+P` / `Ctrl+P` | 剪贴板置顶（模块内） |
| `Cmd+Backspace` / `Ctrl+Backspace` | 删除当前对象（模块内） |

- 快捷键标签必须反映当前平台（macOS 用 ⌘，Windows 用 Ctrl）；不要把 macOS 符号写死为唯一说明。
- Shell 快捷键是窗口内响应链事件，不是进程级全局快捷键；唯一默认全局键是召唤 Launcher。
- 全局召唤分为两个可独立配置的动作：**Launcher Search** 显示 Qx、进入 Launcher 并聚焦搜索，不会因为窗口已显示而隐藏；**Toggle Current Window** 只切换窗口显隐，再次显示时必须保留原模块、route 和子界面。后者默认关闭，避免额外占用系统按键。
- **禁止**把 `Alt+Space` / `Option+Space`（Launcher 召唤）或 `Cmd+Space` / `Ctrl+Space`（系统 Spotlight 等）绑成模块 Action；Shell 匹配层必须放行这些宿主级组合键，不得 `preventDefault`。
- 剪贴板等模块的删除应使用 `Cmd/Ctrl+Backspace`（或 `Delete` 等价），不得使用 Space 系全局键。
- 多栏编辑模块应给列表、编辑器、动作面板设置稳定 `data-qx-region`；列表的
  `navigation.regionId` 指向列表区域。编辑器获得焦点后，方向键、PageUp/PageDown、
  Home/End 和带 Shift 的选区移动不得触发列表选择或区域滚动。

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
- 多栏内容使用 QxShell 区域协议：左右键切换可见区域，上下键处理区域内部导航或阅读滚动；
  `Cmd/Ctrl+K` 仅在当前 Shell 有 Actions 时拦截，且不得重置区域、条目或滚动位置。
- 除用户明确启用的全局功能外，不得注册系统级快捷键；QxShell 的 Esc、方向键、
  `Cmd/Ctrl+K` 和裸键动作只在当前窗口当前 Shell 的事件链中处理。
- 状态不得只靠颜色表达；至少同时提供文字、图标、形状或数值之一。
- 自动化最低要求：静态 a11y 检查 + 关键 Shell/Dialog 的键盘人工验收。

## Internationalization And Content

### 语言偏好与系统扫描

设置项 `general.language` 取值：

| 值 | 含义 |
|---|---|
| `system`（默认） | 跟随操作系统语言 |
| `en` | 强制英文 |
| `zh-CN` | 强制简体中文 |

**跟随系统解析规则**（`resolveLocale` / `detectSystemLocale` in `src/i18n.ts`）：

1. 读取 WebView 可见的系统语言列表：`navigator.languages` + `navigator.language`。
2. 若任一条目为**简体中文**（`zh-CN` / `zh-Hans` / `zh-SG` / `zh-MY` / 裸 `zh` 等），有效 locale = `zh-CN`。
3. **其余一律英文**（含 `en-*`、`zh-TW` / `zh-HK` / `zh-Hant` 繁体、日韩欧等）。
4. OS 触发 `languagechange` 时重新解析；用户显式选 `en` / `zh-CN` 时不跟系统。

前端统一用 `useLocale()` 取**已解析** locale，用 `useLanguagePreference()` 取设置原值。不要在业务里直接判断 `settings.general.language === "zh-CN"`（会漏掉 `system` → 中文的情况）。

### 文案与快捷键

- 用户可见标题、按钮、空状态、错误、通知、Bottom Island 文案必须走 `useT(key, englishFallback)`；品牌名、协议名、用户数据、文件路径除外。
- **英文**写在调用处 fallback；**中文**写在 `src/i18n.ts` 的 `zh` 表。缺失中文时回退英文 fallback，不显示裸 key。
- **快捷键与键盘符号不翻译**：`kbd`、`formatQxShortcut`、Shell 左下角 Esc 胶囊、Actions 菜单里的 `⌘` / `Ctrl` / `Esc` / `↵` 等保持平台原样。只翻译动作名称（如 “复制”“关闭”），不翻译按键本身。
- 左下角 `escapeAction` 推荐 `label: "Esc", kbd: "Esc"`（escape 变体只渲染 kbd）；不要把 “返回/Back” 当必须翻译的左下角主文案。
- 日期、时间、数字、百分比和文件大小使用 **resolved locale** 的 `Intl` formatter（`useLocale()`），不在组件内硬编码 `"zh-CN"` 或手写语言相关拼接。
- 布局按中英文长文案验收；固定高度区域单行截断，完整内容用 Tooltip 或详情。

### 实现清单（模块作者）

```tsx
const t = useT();
const locale = useLocale();

// ✅ 文案
t("clipboard.title", "Clipboard History")

// ✅ 快捷键：不走 t()
escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
primaryAction={{ label: t("common.copy", "Copy"), kbd: "↵", onClick: copy }}

// ✅ 日期
new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date)
```

禁止：模块内大段硬编码中文或仅英文 UI 字符串而不经 `useT`；用 `onBack` 顶栏返回代替已 i18n 的 Esc 协议。

## Application Naming

- 后端 `AppEntry` 同时携带 `name`（`.app` 文件名去掉 `.app`，作为身份标识）和 `display_name`（本地化展示名）。
- `display_name` 解析优先级：`zh-Hans.lproj > zh_CN.lproj > Chinese.lproj > zh-Hant/zh_TW > 内置 Apple 系统 app 中文字典 > CFBundleDisplayName > name`。
- `name` 永远是 path / metadata key / 历史记录的唯一身份，不随语言改变。
- 前端在 **`useLocale() === "zh-CN"`** 时优先渲染 `display_name`，其他 resolved locale 始终渲染 `name`。统一通过 `useDisplayName()` 取值，不要在业务组件中直接读字段或读未解析的 `general.language`。
- 搜索匹配使用 `name`、`display_name` 与 `aliases` 三路打分，`aliases` 由 Rust 端在扫描时一次性生成，包含全部本地化名称及其拼音（全拼 + 首字母），不下发到前端，不写入用户可见 UI。
- Apple 系统应用中文名字典位于 `src-tauri/src/apps_zh_dict.rs`，按 `CFBundleIdentifier` 索引；新增条目时第一项默认作为该 app 的 zh-Hans 展示名（仅在没有 lproj 名时使用）。

## Native And Tauri Constraints

- QxAI 内置供应商按 OpenRouter、DeepSeek 排序，OpenRouter 是默认供应商；内置供应商固定 API endpoint 和推荐模型，设置界面只要求用户填写对应 API Key。DuckDuckGo 不属于内置供应商目录。

- 透明无边框主窗口在 macOS 和 Windows 上均使用系统原生窗口阴影；CSS 只保留画布内高光和边框，不在 WebView 边界内模拟窗口外阴影。Windows 由 Tauri/Tao 的 undecorated shadow 交给 DWM，macOS 由 AppKit `NSWindow` 绘制。
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
- Esc 协议扫描（模块不得再给 QxShell 传 `onBack`）：
  - `rg 'onBack=\{' src/modules src/plugin`
  - 允许命中：`useEscBack` 的 `launcher` 回调名、组件 props 透传（如 loading shell），但不得作为 `QxShell` 的 `onBack=`。
  - 每个 `QxShell` 业务用法应有 `escapeAction=`（Launcher 根视图除外）。
- Home Island：新模式不得在 `Launcher.tsx` / `AppearanceSettings.tsx` 写死分支；指标不得在组件内同步阻塞 IPC。

视觉验收矩阵：

- 尺寸：480×360、680×500、980×576、1280×800、1500×900。
- 主题：Light / Dark / System；透明度最低、默认、最高。
- Top / Bottom chrome 厚度接近（约 48–54px），水平 inset 对齐。
- 灵动岛空闲先出占位，数据稍后填入，不卡搜索输入。
- 内容：空、正常、超长、加载、部分失败、权限拒绝。
- 输入：鼠标与纯键盘；动画正常与 `prefers-reduced-motion: reduce`。
- Light / Dark / 透明度调节下文本层级清晰。
- Select、Popover、Dialog、Dropdown、Tooltip 保持半透明且可读。
- Bottom Island 始终窗口居中。
- 左下角 Esc 可见且可点；Top Bar **无**返回箭头（除非显式 `leading`）。
- 键盘 Esc 与点击 Esc 胶囊在同一模块根视图下行为一致。
- 小窗口、默认窗口、宽屏无横向滚动、无文字挤压。

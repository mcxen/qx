# Qx UI Spec

## 目标

Qx 的主界面采用统一的「命令入口 + 内容工作区 + 右侧上下文区 + 底部操作区」设计方法。不同模块只替换内容工作区和右侧上下文区，不重新发明整套框架。

参考草图：

- `public/doc/ui-sketches/main-shell-search-results.png`
- `public/doc/ui-sketches/main-shell-content-sidebar.png`
- `public/doc/ui-sketches/main-shell-rss-detail.png`

## 设计原则

1. 主界面优先服务高频动作，不做营销式首页。
2. 搜索永远是第一入口；筛选和快捷按钮是搜索的补充。
3. 左侧或中间展示当前任务的主要内容，右侧展示上下文入口、导航、固定工具或条目操作。
4. 底部操作区固定，用来承载 `Esc`、主操作、辅助操作和快捷键提示。
5. 每个模块使用相同边距、圆角、边框、焦点态和键盘逻辑，形成一致的工具感。

## 主壳布局

主壳为圆角矩形窗口，内部使用三层结构：

```text
┌──────────────────────────────────────────────┐
│ Top Bar: 搜索框 + 快捷按钮 + 类型筛选        │
├──────────────────────────────────────────────┤
│ Main Area: 内容区 / 结果区 + Context Panel   │
├──────────────────────────────────────────────┤
│ Bottom Bar: Esc + 当前模块 + 主操作 + Actions│
└──────────────────────────────────────────────┘
```

推荐尺寸：

- 默认窗口比例：约 `17:10`
- 默认窗口：`980 x 576`
- 推荐舒适窗口：`1180 x 694`
- 最大常用窗口：`1500 x 882`
- 最小窗口：`480 x 360`
- 主壳圆角：`8px` 以内
- 控件圆角：`6px` 以内
- 边框：`1px solid var(--qx-border-1)`
- 搜索区、内容区、右侧区之间保持明确分隔线

### Shell Visual Styles

`QxShell` 负责统一主壳视觉层级。模块不得自行重写整套 shell 背景、分隔线或底栏视觉；需要差异化时通过 `visual` prop 选择一种既定样式。

支持样式：

- `solid`：默认样式。内容区、Top Bar、Context Panel、Bottom Bar 使用清晰分隔线，适合 Launcher、列表、剪贴板、文件搜索等高频扫描界面。
- `elevated`：设置、偏好、表单类界面。内容区保持 `var(--qx-bg-component-1)`，外层和 Context Panel 使用 `var(--qx-bg-component-2)`，形成轻微层级但不出现嵌套卡片。
- `glass`：沉浸或浮层型界面。使用 `rgba(var(--qx-glass-bg), ...)` 和 blur，适合截图、阅读 overlay、临时工具面板。玻璃样式必须仍保留边框和可读文本对比。

实现规则：

- `QxShell` 根节点输出 `visual-solid` / `visual-elevated` / `visual-glass` class。
- 模块只能通过 `visual` prop 选择 shell 视觉；禁止在模块 CSS 中覆盖 `.qx-shell-topbar`、`.qx-shell-bottombar`、`.qx-shell-context` 的核心背景语义，除非是明确的模块尺寸或布局适配。
- Context Panel 必须填满 `var(--qx-context-w)` 分配的宽度；面板内的导航或工具列表使用 `width: 100%`，不得再固定旧 sidebar 宽度造成右侧空白。
- 不允许在 Context Panel 里再放一层大卡片式菜单；列表项可以有 hover/active 状态，但右侧区域本身就是容器。
- 所有视觉状态使用 CSS 变量，不硬编码色值。

### 可配置窗口大小

窗口大小允许在设置中调整，但布局内部需要保持稳定比例。设置项建议：

- `compact`: `720 x 424`
- `default`: `980 x 576`
- `comfortable`: `1180 x 694`
- `wide`: `1500 x 882`
- `custom`: 用户自定义宽高，受最小值和最大值约束

实现规则：

- 设置里保存 `window.width`、`window.height`、`window.layoutPreset`。
- 用户手动拖拽窗口后，可选择保存为 `custom`。
- 主壳内部不要使用硬编码像素铺满所有区域，优先使用 CSS 变量和 `clamp()`。
- 模块区的列宽根据窗口宽度自动计算，而不是跟随模块自己随意扩张。

### 固定区域尺寸策略

固定区域包括 Top Bar、Context Panel、Bottom Bar。它们应该稳定，但不能在小窗口下挤压主内容。

推荐 CSS 变量：

```css
:root {
  --qx-shell-gap: 16px;
  --qx-topbar-h: clamp(64px, 11vh, 92px);
  --qx-bottom-bar-h: clamp(52px, 7vh, 68px);
  --qx-context-w: clamp(240px, 28vw, 340px);
  --qx-search-min-w: 220px;
}
```

宽屏布局：

- Top Bar 高度固定在 `64-92px` 范围。
- Bottom Bar 高度固定在 `52-68px` 范围。
- Context Panel 宽度固定在 `240-340px` 范围。
- 主内容区使用剩余空间：`minmax(0, 1fr)`。

窄屏布局：

- 当窗口宽度 `< 760px`，Context Panel 隐藏、折叠或下移。
- Top Bar 允许两行，但搜索框宽度不得小于 `220px`。
- Bottom Bar 隐藏非必要快捷键，保留模块名、灵动岛、主按钮。

### Bottom Bar 灵动岛内容

Bottom Bar 中央灵动岛由 `QxShell` 统一承载，支持模块消息通知、动态进度、播放进度和主页空闲状态展示。主页空闲状态可配置：

- `默认`：显示启动器提示文字。
- `系统信息`：显示 CPU / GPU / MEM 等系统监控。
- `日期显示`：使用点阵屏风格显示时间、公历日期和农历日期。

#### 灵动岛内容协议

模块和插件默认使用 `QxShell` 的 `island` prop，不要自己在 Bottom Bar 中绘制新岛。`island` 是轻量消息协议：

```ts
{
  label: string
  detail?: string
  progress?: number
  tone?: "neutral" | "success" | "warning" | "danger"
  actionLabel?: string
  onAction?: () => void
}
```

字段规则：

- `label`：当前状态主语，控制在 12 个汉字或 24 个英文字符内，例如 `Screenshot`、`RSS 同步`、`Playing`。
- `detail`：辅助状态，显示计数、文件名、速度、剩余时间或播放曲目，必须可截断。
- `progress`：`0-100` 的确定性进度。未知进度不要传 `progress`，用 `detail` 显示 `准备中`、`同步中` 等文本。
- `tone`：只表达结果/风险，不表达模块品牌色。默认 `neutral`；成功完成用 `success`，需要注意用 `warning`，失败或危险用 `danger`。
- `actionLabel/onAction`：只放一个短动作，例如 `Cancel`、`Open`、`Retry`。复杂操作放右侧 Bottom Bar actions 或 Context Panel。

#### 标准状态类型

- `idle`：模块空闲或主页空闲。主页可使用 `默认 / 系统信息 / 日期显示`；普通模块用 `label + detail` 表达当前位置和条目数量。
- `notice`：短消息通知，例如插件完成安装、RSS 刷新完成。推荐 `tone: success`，几秒后回到 `idle`。
- `progress`：下载、导入、同步、OCR、截图保存等确定性任务。使用 `progress`，必要时给 `Cancel`。
- `activity`：未知进度的长任务。不要伪造百分比；用 `detail` 显示当前阶段。
- `playback`：播放/录制进度。`label` 放媒体或任务类型，`detail` 放标题或时间，`progress` 放播放百分比。
- `error`：失败状态。使用 `tone: danger`，`detail` 放短错误摘要，动作优先是 `Retry` 或 `Open`。

#### 滚动展示

灵动岛支持在固定尺寸内横向滚动展示长内容或多段状态，适用于系统信息、日期显示、播放曲目、下载文件名等信息密度较高的场景。

- 滚动必须发生在岛内部，不能改变岛宽高或 Bottom Bar 布局。
- 主页 `系统信息` 和 `日期显示` 使用统一的 `qx-island-marquee` 轨道。
- 滚动内容应连续循环，左右两端使用渐隐遮罩，避免突然裁切。
- 鼠标悬停或键盘焦点进入时应暂停滚动，便于阅读。
- 遵守 `prefers-reduced-motion: reduce`，减少动态效果时停止自动滚动。
- 普通 `island` 文本默认仍使用截断；只有确实需要展示多段信息时才使用滚动自定义岛或后续扩展字段。

#### 使用优先级

当同一模块同时有多种信息时，按以下顺序占用灵动岛：

1. 用户正在等待的进行中任务：下载、导入、导出、录制、OCR、同步。
2. 错误或需要用户处理的状态。
3. 刚完成的短通知。
4. 当前模块位置、选中项、条目数量等空闲信息。
5. 主页空闲样式。

#### 视觉和布局约束

- 默认岛高度 `32px`，最大高度 `36px`。系统信息和日期显示等 `customIsland` 也必须遵守。
- 灵动岛始终相对窗口居中，用 `.qx-shell-bottombar { position: relative }` 和岛自身 `position: absolute; left: 50%; transform: translateX(-50%)`。
- 文本必须单行截断，不允许撑高 Bottom Bar。
- `customIsland` 只用于主页系统信息、日期显示、音频可视化等确实需要自定义结构的展示；普通模块和插件必须优先使用 `island` 协议。
- 插件不得直接改 `.qx-shell-bottombar` 或 `.qx-bottom-island` 核心样式。需要扩展能力时先扩展 `BottomIslandContent` 类型。

固定区域不可做的事：

- 不因为列表内容长而改变宽高。
- 不因为按钮文案变化而挤压搜索框。
- 不出现横向页面滚动。

## Top Bar

Top Bar 包含：

- 返回按钮：位于左侧，进入子模块后显示。
- 搜索框：占据主要宽度。
- 快捷按钮组：2-3 个常用入口，适合固定剪贴板、截图、RSS 导航等。
- 类型筛选下拉：用于剪贴板类型、内容类型、RSS 分组等。

行为要求：

- 搜索框自动聚焦。
- 输入时实时过滤当前模块内容或启动器命令。
- 下拉筛选不应挤压搜索框到不可用宽度。
- 窄屏时 Top Bar 可以换行，搜索框必须保持可输入宽度。

实现约束：

- 模块顶部搜索框统一使用 `qx-search-wrap` + `qx-plugin-search`。
- Top Bar 右侧筛选/操作/状态控件必须使用 Shell 内统一控件高度，与搜索框视觉对齐并右对齐。
- Shell search slot 必须让搜索框填满可用宽度，不得因 trailing 文本或模块局部样式收缩。
- 模块不得复用其他模块的私有搜索样式（例如 clipboard 专用 class）来实现 Shell Top Bar。

## Main Area Variants

### Variant A: Launcher / Search Results

适用：主启动器、全局命令搜索、应用搜索。

结构：

```text
┌─────────────────────────────┬───────────────┐
│ Search Results              │ Quick Entries │
│ - Command                   │ - Fixed tools │
│ - App                       │ - Recent      │
│ - Plugin action             │ - Shortcuts   │
└─────────────────────────────┴───────────────┘
```

左侧为搜索结果列表，右侧为常用入口区。

右侧区分为上下两段：

- 上段固定：Pinned Clipboard、Screenshot、RSS、Settings 等。
- 下段动态：最近使用、推荐插件、当前模块快捷入口。

验收：

- 搜索 `cli` 应出现 `Open Clipboard History`。
- 搜索 `rss` 应出现 RSS 入口。
- 搜索结果和右侧入口都支持键盘选择。

### Variant B: Clipboard History

适用：剪贴板历史。

结构：

```text
┌─────────────────────────────┬───────────────┐
│ Clipboard List              │ Preview       │
│ - Text                      │               │
│ - Link                      ├───────────────┤
│ - Image                     │ Information   │
│ - Code                      │               │
└─────────────────────────────┴───────────────┘
```

左侧为历史列表，右侧上半区预览内容，右侧下半区显示信息。

Information 字段：

- Content type
- Characters
- Words
- Copied time
- Copy count
- Pinned state

筛选下拉：

- All Types
- Pinned
- Links
- Code
- Long
- Frequent

底部主操作：

- `Paste to Clipboard`
- `Actions`
- 快捷键提示：`Enter`、`Cmd K`

验收：

- 重复复制同一内容时更新时间，而不是产生重复条目。
- 支持置顶，置顶条目排序靠前。
- `Cmd P` 切换置顶。
- `Enter` 复制当前条目。
- 空状态清晰显示，不撑坏布局。
- 左侧 Clipboard List 和右侧 Preview / Information 必须独立滚动；外层 shell content 不得滚动导致左右区域一起移动。
- 右侧 Preview 与 Information 可各自内部滚动，但不得把整个 Clipboard 页面推成单一滚动页。

### Variant C: Content Detail / RSS Detail

适用：RSS 文章详情、文档阅读、截图详情。

结构：

```text
┌───────────────────────────────────┬───────────────┐
│ Content                           │ Detail Nav    │
│                                   │ - Headings    │
│                                   │ - Related     │
│                                   │ - Actions     │
└───────────────────────────────────┴───────────────┘
```

主内容区尽可能宽，右侧区用于详情导航和条目操作。

右侧区可隐藏：

- 当内容需要沉浸阅读时，隐藏右侧区。
- 当模块需要目录、RSS 列表、截图工具时显示右侧区。

验收：

- 内容区不被底部操作栏遮挡。
- 右侧导航滚动不影响主内容滚动。
- 详情页仍保留顶部搜索和筛选入口。

## Bottom Bar

Bottom Bar 固定在主壳底部。

通用结构：

```text
Esc / Back   [ Dynamic Island Slot ]   Actions
```

字段：

- 左侧：只放 `Esc` 或返回按钮提示，不显示模块名和模块图标。
- 中间区域：灵动岛槽位，插件和模块可以自定义内容。
- 右侧：仅显示当前上下文真实可执行的操作按钮；没有可用操作时不显示按钮。
- 快捷键：用 `kbd` 展示。

要求：

- 不出现两个底栏。
- 子模块若有专属底栏，应隐藏通用底栏。
- 右侧按钮 disabled 或无选中对象时不渲染，不占用视觉空间。
- 灵动岛槽位为空时保持占位，不导致左右按钮跳动。
- `Esc` 是导航/退出语义，不算右侧业务 Action。
- `Actions` 按钮只负责打开迷你菜单，不把菜单内容塞进右侧 Context Panel。

### Actions Mini Menu

`Actions` 是临时浮层菜单，用于当前选中对象的可执行操作。

触发：

- 点击底栏 `Actions`。
- 按 `Cmd K`。

位置：

- 默认锚定在底栏右侧按钮上方。
- 宽度不超过 `280px`。
- 不改变主内容、右侧 Context Panel 或底栏布局。

交互：

- `ArrowDown` / `ArrowUp`：移动菜单选中项。
- `Enter`：执行当前选中 Action 并关闭菜单。
- `Esc`：只关闭菜单；菜单关闭后再次按 Esc 执行页面返回规则。
- 点击菜单项：执行并关闭菜单。

内容：

- 菜单项按当前选中对象类型生成。
- 应用：打开、在 Finder 中显示、复制路径、显示包内容。
- 文件：打开、在 Finder 中显示、复制路径。
- 剪贴板：复制文本、打开剪贴板历史。
- 命令：运行命令。
- 禁止把 Actions 菜单渲染成右侧整栏。

### Bottom Dynamic Island

底部两个按钮之间的中间区域作为「Dynamic Island Slot」。它不是普通状态栏，而是一个可交互、可被模块或插件填充的轻量容器。

位置：

```text
┌─────────────────────────────────────────────────────────┐
│ Esc              [ Dynamic Island Slot ]          Actions │
└─────────────────────────────────────────────────────────┘
```

定位规则（强制）：

- Island 必须通过 `position: absolute; left: 50%; transform: translateX(-50%)` 始终相对窗口居中。
- 禁止使用 `justify-self: center` 或 `margin: 0 auto` 在 grid 列内居中 —— 左右列宽度变化会导致 island 视觉偏移。
- 父容器 `.qx-shell-bottombar` 必须设 `position: relative` 作为锚点。
- Island 脱离 grid 流后，grid 的 `1fr` 中间列允许为空。

尺寸：

- 默认宽度：`clamp(180px, 26vw, 360px)`
- 默认高度：`32px`
- 系统监控岛最大高度：`36px`
- Bottom Bar 高度：`clamp(46px, 5.8vh, 56px)`
- 最大高度：不超过 Bottom Bar 高度减去上下 padding
- 内容过长时使用省略或内部进度，不撑高底栏
- 迷你指标必须单行呈现；二级说明可隐藏，不能把岛撑成双行卡片。

内容类型：

- 进度：RSS 同步、下载插件、导入 OPML、截图保存
- 临时状态：Copied、Pinned、Saved、Sync failed
- 迷你控制：暂停/继续、取消、重试
- 插件自定义内容：插件名称、当前任务、进度、轻量动作

交互规则：

- 点击灵动岛可展开一个小 popover，但不能打开整页 modal。
- 右键或 `Cmd K` 可显示相关 Actions。
- 插件内容必须声明最小宽度和最大宽度。
- 插件不得直接控制底栏左右按钮，只能填充自己的槽位。

建议 API：

```ts
interface BottomIslandContent {
  id: string;
  owner: "system" | "plugin";
  pluginId?: string;
  priority: number;
  label: string;
  detail?: string;
  progress?: number; // 0-100
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}
```

优先级：

1. 当前模块正在执行的任务
2. 当前选中条目的临时反馈
3. 插件任务
4. 空状态占位

### RSS Dynamic Island Example

RSS 阅读器刷新时，灵动岛显示同步进度：

```text
[ RSS Syncing  8/24 feeds  ███████░░░  33%  Pause ]
```

状态字段：

- `label`: `RSS Syncing`
- `detail`: `8/24 feeds`
- `progress`: `33`
- `actionLabel`: `Pause`
- `tone`: `neutral`

交互：

- 点击 `Pause` 暂停刷新队列。
- 点击灵动岛主体展开 popover：
  - 当前 feed 标题
  - 成功数量
  - 失败数量
  - 最后一条错误
  - `Retry failed` 操作

完成后显示 2 秒：

```text
[ RSS Updated  24 feeds · 128 new articles ]
```

失败时：

```text
[ RSS Sync failed  3 feeds failed  Retry ]
```

视觉：

- 同步中使用 `--qx-accent` 进度条。
- 成功使用 `success` tone。
- 失败使用 `--qx-danger`，但不整条大面积染红。

插件示例：

```ts
context.bottomIsland.set({
  id: "rss-refresh",
  owner: "plugin",
  pluginId: "builtin:rss",
  priority: 80,
  label: "RSS Syncing",
  detail: "8/24 feeds",
  progress: 33,
  actionLabel: "Pause",
});
```

## Interaction Model

键盘：

- `Esc`：返回上一级；在主启动器中隐藏窗口。
- `ArrowUp / ArrowDown`：移动列表选中项。
- `Enter`：执行主操作。
- `Cmd K`：打开 Actions 或命令菜单。
- `Cmd P`：剪贴板条目置顶。
- `Cmd Backspace`：删除当前条目。

鼠标：

- 单击列表项：选中。
- 双击剪贴板条目：复制。
- 右侧快捷入口单击：打开对应模块或固定工具。

焦点：

- 进入模块后搜索框自动聚焦。
- 列表选中态必须和详情预览同步。
- 下拉、按钮、列表均有可见 focus 状态。

## Responsive Rules

宽屏：

- 使用两栏或三栏布局。
- 右侧 Context Panel 可显示。
- 内容区和右侧区之间保留分隔线。

窄屏：

- Top Bar 允许换行。
- 右侧 Context Panel 隐藏或下移。
- Main Area 退化为单栏。
- 底部操作栏只保留模块名、主操作、Actions，隐藏复杂快捷键。

硬性要求：

- 任意宽度下不得出现横向页面溢出。
- 搜索框不得被挤压到不可输入。
- 按钮文字不得溢出按钮。

## Visual Tokens

使用现有 CSS 变量：

- `--qx-bg-component-1`
- `--qx-bg-component-2`
- `--qx-bg-component-3`
- `--qx-border-1`
- `--qx-border-2`
- `--qx-border-3`
- `--qx-text-primary`
- `--qx-text-secondary`
- `--qx-text-tertiary`
- `--qx-accent`
- `--qx-danger`

### 超链接样式

在 RSS 文章详情等富文本内容中，超链接使用 `--qx-accent`：

```css
.rss-article-content a {
  color: var(--qx-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

禁止使用浏览器默认蓝色 `#0000ee` / `#551a8b`。

### 自定义滚动条

所有模块禁止使用原生滚动条，改为 Qx 自定义样式，以支持半透明背景下的沉浸显示：

```css
/* 窄轨道 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--qx-scrollbar-thumb, rgba(128, 128, 128, 0.3));
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--qx-scrollbar-thumb-hover, rgba(128, 128, 128, 0.5));
}
```

- 轨道始终 `transparent`，不显示白色背景条
- 滑块使用 `--qx-scrollbar-thumb` 变量统一控制，用户可在主题中覆盖
- 鼠标经过时加深至 `--qx-scrollbar-thumb-hover`
- 宽度 6px 兼顾触控精准和视觉轻盈

### Select 组件分隔项

`Select` 组件支持 `<option>` 中插入分隔项。分隔项的 `value` 约定为 `---divider---`，`label` 为任意占位文本。组件内部遇到分隔项时渲染为分隔线（不可选）：

```tsx
const options = [
  { value: "builtin-a", label: "Built-in A" },
  { value: "---divider---", label: "──────────" },
  { value: "custom:abc", label: "My Custom" },
];
```

处理 `onChange` 时需跳过分隔项：

```tsx
const handleChange = (next: string) => {
  if (next === "---divider---") return;
  // ... rest of logic
};
```

### BYOK 自定义 Provider 管理模式

在 Settings 类模块中，支持用户添加自己的 API key 提供方。模式要求：

1. **持久化**：自定义 provider 通过 Tauri Rust 命令读写 `~/.qx/qxai-custom-providers.json`，使用 `qxai_get_custom_providers` / `qxai_save_custom_providers`
2. **API Key 掩码**：显示时仅保留前 4 位 + … + 后 4 位，输入框用 `type="password"`
3. **内联表单**：添加/编辑使用内联展开表单，不用弹窗 Modal
4. **Provider 合并**：内置 provider + 自定义 provider 合并到一个 `Select` 组件中，中间用分隔项分隔
5. **命名规则**：自定义 provider id 使用 `custom:<uuid>` 前缀，前端据此判断调用 `g4f_chat_custom` 还是 `g4f_chat`
6. **模型输入**：支持逗号分隔的模型 ID 列表，自动转为 `{ id, name }` 数组

卡片展示风格：

```tsx
<div style={{
  background: "var(--qx-bg-component-2)",
  borderRadius: "var(--qx-card-radius)",
  padding: 12,
}}>
  <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
  <div style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
    Base URL: {baseUrl}
  </div>
  <div style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
    API Key: {maskedKey}
  </div>
  <div style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
    Models: {modelList}
  </div>
  <div style={{ display: "flex", gap: 6 }}>
    <button className="qx-command-button">Edit</button>
    <button className="qx-command-button" style={{ color: "var(--qx-danger)" }}>Delete</button>
  </div>
</div>
```

### 内联 Add/Edit 表单模式

用于少量字段的配置表单（如 BYOK provider 添加/编辑），使用以下约束：

- 背景 `var(--qx-bg-component-2)`，无需外层 shell
- 表单内联展开，不使用 Modal 弹窗
- 字段：最多 5 个 input，垂直排列，间距 10px
- 保存/取消按钮右对齐
- label 字号 12px，颜色 `var(--qx-text-secondary)`

新增模块类名建议：

- `.qx-shell`
- `.qx-topbar`
- `.qx-main-area`
- `.qx-context-panel`
- `.qx-bottom-bar`
- `.qx-module-layout`
- `.qx-module-list`
- `.qx-module-content`
- `.qx-module-info`

目标是逐步替换模块里分散的专用布局类，保留少量模块私有样式。

## Implementation Plan

1. 抽取通用 Shell：
   - `TopBar`
   - `MainArea`
   - `ContextPanel`
   - `BottomBar`

2. 迁移 Launcher：
   - 左侧搜索结果
   - 右侧常用入口
   - 搜索内置命令、应用、插件命令

3. 迁移 Clipboard：
   - 使用 Variant B
   - 接入类型筛选、置顶、复制次数、详情信息

4. 迁移 RSS：
   - 列表页使用 Variant A/B 混合
   - 详情页使用 Variant C

5. 验证：
   - `npm run build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - 浏览器检查 480px、900px、1498px 三档宽度
   - 控制台新增 error/warn 为 0

## Acceptance Checklist

- 主启动器、剪贴板、RSS 的顶部结构一致。
- 所有模块只有一个底栏。
- 搜索 `cli` 能打开剪贴板历史。
- 剪贴板历史可以筛选、置顶、复制、预览。
- RSS 详情页主内容宽，右侧导航不抢空间。
- 窄屏无横向溢出。
- CDP/browser 调试无新增 console error。

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

# Qx 插件 UI 与 Actions 规范

> 状态：Current · 适用：Qx ≥ 0.6.0 · 读者：业务 / 第三方插件作者
>
> 本文是插件作者的界面规范。宿主实现的完整事实来源仍是
> [`UI_SPEC.md`](../../UI_SPEC.md)；插件运行时与信任边界见
> [`docs/plugin-architecture.md`](../../docs/plugin-architecture.md)。

Qx 插件应当像宿主桌面工具的一部分，而不是在窗口里嵌入一张独立网页。标准列表、
Gallery、详情、搜索、状态和 Actions 优先发布为 Workbench 纯数据；只有图表、地图、
媒体、画布等无法结构化表达的界面才使用 Custom Panel。

## 1. 选择界面模式

按以下顺序选择，前一种能满足需求时不要进入后一种：

1. **Declarative Workbench**：标准 List / Gallery / Detail / tabs / search / Actions。
2. **Commands-only**：一次性操作、toast、剪贴板、打开 URL，不需要 Panel。
3. **Custom Panel**：图表、地图、媒体、画布或其他 Workbench 无法表达的交互。
4. **Island**：任务状态的补充表面，不能代替主 Panel。

Workbench 中，插件负责业务 state、稳定 id、数据获取、动作处理和持久化；宿主负责
Shell、明暗主题、焦点、滚动、选择、响应式布局、Esc、Actions 菜单与 Island chrome。
图片详情的横竖比例适配、加载失败和全尺寸 Dialog 同样由宿主负责；插件只发布
`detail.image` 的 `aspectRatio/zoomable/caption`，不得向隐藏 iframe 注入宿主 class
CSS 或另做 lightbox。图片/元数据分批更新时保留旧内容并发布
`item.status/detail.status`，使用 `mountWorkbench()` 返回 controller 的
`updateItems` 按稳定 id 合并，不要清空整个列表。插件不得复制这些宿主能力。

## 2. 基本布局

插件不能在内容区重新创建一套完整应用框架：

- **Top Bar**：搜索、tabs、当前筛选；保持单行，不放返回按钮。
- **Main Area**：List / Gallery / Detail 或 Custom Panel 的业务内容。
- **Context Panel**：只放当前对象的辅助信息与动作，不复制详情主内容。
- **Bottom Bar**：左侧固定 Esc，中间可选 Island，右侧 Primary Action 与 Actions。

禁止增加第二条全局 toolbar、footer、快捷键栏或返回栏。窄窗口优先收起次要文案、
图标化低频动作或放入 Actions 菜单，不能让 Top / Bottom Bar 增高或换成多行。

列表和 Gallery 必须遵守：

- 每个 item 提供稳定、唯一、非空的 `id`。
- 标题、副标题和 badge/meta 位于各自轨道，超长内容单行省略，不互相覆盖。
- 空、加载、错误和少量数据都保留稳定画布，不用假条目撑布局。
- 已有内容刷新时保留旧内容并标记 loading，不先清空列表。
- 选择、焦点、滚动和键盘导航不能等待慢 I/O 才更新。
- 浏览态由 List / Gallery 占满 Main Area；激活带 `detail` 的条目后，宿主自动保留左侧集合并在右侧打开详情。插件不要自建 split view，也不要把详情复制进 Context Panel。

## 3. 主题、明暗度与颜色

所有插件必须在 **Light、Dark、System** 下可用，并在最低、默认、最高界面透明度下
检查可读性。

### 3.1 对比度下限

- 普通文本与实际合成背景的对比度至少满足 WCAG 2.2 AA **4.5:1**。
- 大文本、图标、Focus Ring、边框和可交互控件至少 **3:1**。
- Primary、Danger、Success、Warning 等颜色不能承担唯一状态表达；同时提供文字、
  图标、形状或数值。
- 禁用态不能只靠整体变淡表达，原因应当可发现。

透明度只作用于 surface/background token。禁止给整个内容容器设置 `opacity` 来表达
弱化或透明；这会同时降低文字、图标和焦点环的对比度。暗色低透明度下必须保留可读
下限，不能让深色界面被桌面背景冲成灰白。

### 3.2 语义 token

Workbench 由宿主渲染，不需要插件提供颜色。Custom Panel 必须优先使用运行时注入的
公开语义 token：

```css
color: var(--foreground);
background: var(--background);
border-color: var(--border);

/* 可用语义 */
--background; --foreground;
--card; --card-foreground;
--popover; --popover-foreground;
--primary; --primary-foreground;
--secondary; --secondary-foreground;
--muted; --muted-foreground;
--accent; --accent-foreground;
--destructive; --destructive-foreground;
--border; --input; --ring; --radius;
```

旧 Custom Panel 可继续使用 `--qx-text-*`、`--qx-bg-component-*`、`--qx-border-*`、
`--qx-accent` 与 `--qx-danger` 兼容 token。普通文本、边框和背景不得在业务 CSS 中加入
十六进制/RGB 的深色专属 fallback；缺失 token 应由宿主修复。

品牌资产、真实数据图表和按数值计算的渐变属于受控例外，但必须同时定义 Light/Dark
值，并配合标签或数值，不得只靠颜色传递业务状态。

运行时会同步 `document.documentElement.dataset.theme`、`.dark` 和上述 token。Custom
Panel 可以用 `[data-theme="dark"]` 处理必要的品牌/图表例外，但普通控件仍应使用语义
token。

## 4. 控件、排版与动态效果

- 使用系统字体栈；普通正文约 `12px–14px`，辅助信息不小于 `10px`。
- 普通控件高度约 `28px–36px`，圆角使用 `--radius` 或 `--qx-control-radius`。
- 所有真实操作必须可通过键盘到达，并有可见 `:focus-visible` ring。
- 图标按钮必须有 `aria-label`；装饰图标使用 `aria-hidden="true"`。
- 不暴露浏览器原生 select、range、checkbox、radio 外观。
- loading、错误和异步完成必须立即给出局部、Island 或 toast 反馈。
- 循环动画、spinner、shimmer 和 marquee 必须在
  `prefers-reduced-motion: reduce` 下停止或降级为静态状态。
- 不使用营销式 hero、大标题板、装饰渐变、连续呼吸/漂浮动画和层层嵌套大卡片。

## 5. Actions

### 5.1 层级

- 每个当前上下文最多一个可用 **Primary Action**。
- Primary 是最自然、最安全、最高频的操作，例如 Open、Copy、Apply；默认快捷键为
  `Enter`。
- 其他操作进入 `Cmd/Ctrl+K` Actions 菜单，按“打开/查看/复制 → 编辑/刷新/导出 →
  状态切换 → 危险操作”排序。
- 危险操作放在末尾，使用 `tone: "danger"`，并在不可逆时确认具体对象和影响。
- 动作不可用时设置 `disabled`，不要让用户执行后才收到“不可用”提示。
- label 使用明确的“动词 + 对象”，例如 `Copy URL`、`Delete History`，避免 `OK`、
  `Do it` 等模糊文案。

Workbench action 示例：

```js
actions: [
  { id: "open", label: "Open", primary: true },
  { id: "copy-url", label: "Copy URL", kbd: "CmdOrCtrl+C" },
  { id: "delete", label: "Delete", tone: "danger" },
]
```

`primary` 表达动作层级；Action 的状态色只使用默认/危险语义。`success`、`warning`、
`accent` 适用于 item、badge 或 detail field 状态，不用于把多个 Action 涂成彩色按钮。

### 5.2 快捷键

- `Esc` 永远属于返回阶梯，不能作为 Action 快捷键。
- `Enter` 默认属于当前 Primary Action。
- `Cmd/Ctrl+K` 只负责打开或关闭 Actions 菜单。
- 不覆盖 Qx 的全局召唤组合键、系统 Spotlight 或输入法组合键。
- 搜索或编辑控件聚焦时不拦截裸字母快捷键。
- 使用 `CmdOrCtrl` 等平台化描述，不把 macOS 符号作为 Windows 的唯一说明。

### 5.3 执行路径与反馈

- 不带 `command`：回调 `handlers.onAction`，用于刷新、清筛选等当前 Panel 局部动作。
- 带 `command`：由宿主 command runtime 执行，用于计时、下载等跨 Panel 生命周期任务。
- command 与 Panel 通过 `context.storage.persist` 共享状态，不能依赖 iframe 全局变量。
- 动作开始后立即进入 busy/disabled/progress 状态，防止重复提交。
- 失败保留当前选择、滚动和仍有效的数据，并提供 Retry/Open 等恢复动作。
- command 完成后使用 `onCommandComplete` 单次重读持久化状态，不做高频磁盘轮询。

## 6. Esc、键盘与焦点

- 返回只走 Bottom Bar 左下角 Esc；插件不在 Top Bar 增加返回箭头。
- 每次 Esc 只退一层：overlay/detail → 本地 query → launcher → 清 launcher query →
  隐藏 Qx。
- Actions 菜单打开时，Esc 先关闭菜单并恢复此前焦点；下一次 Esc 才进入返回阶梯。
- List 使用 ↑/↓、Page、Home/End；Gallery 使用二维方向键；Enter 对带详情条目先打开详情，无详情时执行 Primary。
- 打开 Actions 菜单、刷新或回画不得重置选中项、活动区域或滚动位置。
- Custom Panel 只处理自身内部 overlay/detail；不得注册进程级 Esc 或系统级快捷键抢占
  宿主响应链。

## 7. 状态与内容

按适用范围覆盖 `initial`、`loading`、`empty`、`partial/stale`、`success`、
`warning/error`、`offline/permission-denied`、`disabled`：

- 空态说明为空原因；可恢复时提供一个主动作。
- offline、permission denied 和 error 不伪装成空列表。
- 局部错误不无必要替换整个页面。
- 未知进度使用 indeterminate activity，不伪造百分比。
- 用户可见的标题、按钮、空态、错误、toast 和确认文案必须可本地化；快捷键本身不翻译。

## 8. 合并前 UI 自检

- [ ] 能用 Workbench 的界面没有改为 Custom Panel。
- [ ] Light / Dark / System 与三档透明度下层级清晰。
- [ ] 普通文本 ≥ 4.5:1；大文本、图标和控件 ≥ 3:1。
- [ ] 480×360、680×500、980×576 下无横向滚动、文字覆盖或多行 Shell chrome。
- [ ] 空、加载、正常、超长、stale、错误、权限拒绝均有稳定布局。
- [ ] 恰好一个 Primary；Enter、Esc、Cmd/Ctrl+K 无冲突。
- [ ] 危险动作有 danger 语义和必要确认。
- [ ] 鼠标与纯键盘均能完成主路径，Focus Ring 清晰。
- [ ] reduced motion 下没有非必要循环动画。
- [ ] 刷新和 Action 执行不丢选择、滚动、焦点或可用缓存。

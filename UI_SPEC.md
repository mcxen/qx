# Qx UI Spec

## File Actions 内置模块

- File Actions 使用标准 Top Bar / Main Area / Bottom Bar，不另造工具窗口。Main Area 为可调整的两栏：左侧是 Qx 唤起前 Finder / Windows Explorer 的完整选择列表，中间是操作选择与参数区。
- 左侧列表复用 `useQxListSelection`，显示文件/文件夹图标、名称与父目录；不得把系统选择降级成剪贴板文本，也不得因 Qx 获得焦点而清空刚捕获的选择快照。
- 中间操作区提供重命名、移入新文件夹、压缩为 ZIP、解压 ZIP。重命名仅允许单选；归拢与压缩要求选择项位于同一父目录；解压只接受 ZIP。
- Enter 执行当前有效操作，Esc 经 `useQxModuleShell` 返回 Launcher。运行中以 Bottom Island 的真实 indeterminate 状态反馈，不造成布局跳动；错误保留在操作区，选择列表仍可使用。
- 所有参数输入使用 Qx shadcn 控件和主题变量。写操作不得静默覆盖已有目标；完成后左栏切换为宿主返回的输出项快照。

> 状态：Current · 适用版本：v0.5.13 · Owner：Frontend · 最后复核：2026-07-14
>
> 事实来源：`src/components/QxShell.tsx`、`src/hooks/useEscBack.ts`、`src/styles/shell.css`、`src/styles/settings-actions.css`、`src/home-island/`、`src/modules/settings/plugins/`、`src/i18n.ts`
>
> 本文件是 UI 布局与交互的单一事实来源。实现与本文冲突时，以代码为据并回写本文件。

Qx 的 UI 目标是一个稳定、紧凑、可透明的桌面工具壳：搜索优先，内容居中，右侧给上下文，**底部最右侧统一 Esc 返回**，中间承载状态与可扩展灵动岛，右侧依次承载主动作、Actions 与 Esc。模块只替换内容区和 Context Panel，不重新发明主壳。

## Core Rules

- Windows 可复用透明截图 picker/shade 在隐藏前必须先从 DWM 合成中 cloak，隐藏后提交一次
  compositor flush，再恢复其他 Qx 窗口；复用前解除 cloak。创建任何 WebView2 controller 前
  必须将默认背景设为透明，确认、复制或取消后不得残留全屏白色合成面。

- 主壳固定为三层：Top Bar / Main Area / Bottom Bar。
- Qx 完全退出后再次启动时，新进程必须主动显示一次 Launcher，让用户明确知道重启已完成；
  同一进程内的设置 hydration、HMR 或窗口隐藏/显示不得重复触发。首次安装且没有保存尺寸时，
  默认窗口宽度必须高于 860px 的 Context 响应式断点（屏幕空间不足除外），确保右侧快捷入口
  可见；已有用户继续恢复其保存尺寸。
- 截图或录屏成功后必须走同一个 capture-session 完成协议：结束 picker generation、隐藏并
  清空圈选层、解除内容保护、恢复结果界面，并按统一的捕获后隐藏设置处理控制栏。成功停止
  录屏不得重新弹出此前选区；仅失败时允许保留选区供重试。
- 从常驻截图控制栏或全局截图快捷键启动截图时，如果主 Qx 窗口当前可见，必须保持其当前
  模块与画面可见并临时解除主窗口内容保护，使 Qx 可以截取自身界面；圈选层、遮罩和截图
  控制栏仍必须受内容保护并排除在成品之外。截图模块内部的普通捕获入口继续隐藏来源窗口。
- 圈选会话记录启动时主 Qx 窗口是否可见：从桌面全局快捷键启动后 Esc 只退出圈选并恢复
  原前台应用，不得额外打开 Qx；从可见 Qx 界面启动后 Esc 才恢复原模块。`⌘C` / `Ctrl+C`
  无论 WebView 焦点落在根节点还是非编辑覆盖层，都必须直接截图并写入系统图片剪贴板。
- 捕获预览的历史侧栏按“截图”和“录屏”分为两个默认展开的折叠组，不得把两种成品混排；
  每组可独立折叠，Shell 键盘导航只遍历当前展开组中的可见条目。
- 截图与录屏历史项在列表和图库布局中均提供重命名操作；仅编辑文件主名并保留原扩展名，
  后端必须同步移动成品、录屏封面与历史记录。录屏预览默认自动播放一次，抵达结尾即停止；
  再次点击播放时从头开始，不得自动循环。
- RSS 阅读器的正文与封面图片只经 Rust 图片缓存加载；列表选中项、相邻文章与当前文章的
  首批图片必须提前预热并在 WebView 解码完成后才显示，禁止透明占位图直接切换为本地路径而闪烁。
- 截图/录屏圈选控制栏的全部图标始终保持单排，不因窗口或选区宽度拆成多行；全屏模式下
  初始悬浮于当前显示器屏内中下侧，可从控制栏空白处拖动并始终夹紧在屏幕内，且继续受
  内容保护与捕获排除约束，不得进入截图或录屏成品。
- 录屏区域使用蓝色边框，区域外保持压暗；开始录制前的确认图标使用 `▶`。录制开始后不得
  使用 Bottom Island 承载录制控制，而应在受内容保护的独立工具栏前部显示“正在录制”和
  实时时长，尾部使用 `⏺` 作为暂停并保存动作；保存处理中切回 `▶`。蓝色边框、域外遮罩
  与录制工具栏均不得进入录屏成品。
- 可复用 picker 每次收到新的捕获会话都必须退出旧全屏状态、清空旧交互并恢复区域圈选；
  白色序号标注使用黑色数字和深色轮廓，其余颜色使用白色数字，工具栏预览与成品一致。
- 截图文字工具启用后在选区内点击位置生成单字符宽编辑框；输入时按内容增长，选中态使用
  虚线框、四角蓝色缩放点与右上角删除按钮。文字框可自由拖动，四角等比缩放必须同步字号；
  上下左右四条边均提供拖拽命中区：左右边改宽并重新排版，上下边改高但不得小于完整文字
  所需高度；四个角只执行以对角为锚点的等比缩放，并同步缩放文本框与字号。中文等 IME
  合成期间必须显示拼音等原生 preedit 内容，并随当前输入实时调整文字框，但不把 preedit 写入
  标注；候选确认后一次性提交并排版。输入与删除均须按当前内容同步伸缩文字框，
  合成中的 Enter 必须留给输入法，合成结束后的 Enter 才结束编辑。文字增长到截图
  右边界后必须自动换行并扩高文本框，接近底边时向上调整；输入态与完成态均须完整显示所有
  行。`Shift+Enter` 可手动换行。Enter 或点击框外结束编辑并隐藏控件，截图成品只保留纯色
  文字，不绘制白色外描边。文字输入布局须保持线性测量，拖动与缩放按动画帧合并更新；纯文字
  变化不得重绘非文字标注画布。马赛克必须使用连续平滑的模糊笔迹，不能呈现彼此断开的方块图章。
- 无边框主窗口必须保留原生窗口操作语义：Top Bar 负责拖动，Shell 最外沿提供
  resize hit targets。Windows WebView2 使用上下左右与四角八方向
  `startResizeDragging` 手柄，并显式拥有
  `core:window:allow-start-resize-dragging` capability；禁止把窗口边缘标成 drag
  region，否则会抢走缩放命中。Tauri/tao 在 macOS 不支持该 IPC，因此 macOS 不渲染
  WebView 手柄，继续由可调整大小的 Cocoa/NSPanel 原生窗口边缘处理。
- Settings → Appearance 可启用跨平台自绘标题栏，默认隐藏以保留紧凑 Launcher。启用后标题栏固定在 Top Bar 上方，macOS 与 Windows 按各自桌面习惯排列最小化、最大化/还原和关闭按钮；按钮使用 Qx 主题变量，空白与标题可拖窗，双击切换最大化。关闭按钮只隐藏可复用主窗口，不销毁后台 helper。
- Settings → Appearance → Window & Density 统一提供三种主窗口显示方式：始终置顶、普通窗口、悬浮桌面且失焦自动隐藏。三者互斥；普通窗口不因失焦隐藏，也不参与置顶层；悬浮模式只有在窗口失焦后收起，不能打断当前应用工作。
- 同一设置区域提供“显示在应用栏”开关；开启后 macOS 保留 Dock 图标、Windows 保留任务栏图标，关闭后继续使用后台工具的隐藏应用列表行为。macOS 点击 Dock 图标时按传统应用语义重新显示 Qx。
- 搜索是第一入口；模块内搜索必须放在 Top Bar。
- Launcher 搜索为空时 Main Area 显示宿主绘制的 Home Dashboard；输入任意查询后立即切回
  ResultsList。Dashboard 复用现有置顶 metadata 与系统指标采样总线，不保存像素坐标，
  只保存有序组件 ID；窗口拖拽缩放由容器断点重排，不改写用户布局。Dashboard 顶部常驻
  “编辑主页”Popover：可搜索并置顶应用、内置模块和已安装插件，主页卡片开关也集中在同一处；
  该入口不依赖置顶卡是否启用或是否有内容，关闭置顶卡后指标卡自动铺满可用宽度；
  Context 侧栏不再重复放置主页组件编辑区。Dashboard 轻量数据源统一遵循窗口可见性与
  激活协议：主窗口隐藏时停止轮询，重新显示后立即补采样；定时、事件和激活触发必须
  single-flight 合并，慢请求最多保留一次尾随刷新，失败保留最近可用快照。
- Tray 左键打开宿主绘制的紧凑控制面板，右键保留系统原生菜单。滑块类 Tray 控件只能来自
  已登记的 manifest `surfaceProviders`，与 Launcher Home 共用宿主数据适配器；设置页负责
  显示开关和顺序。Tray/Home 不得为了读取 Provider 启动完整插件 Panel 运行时。Tray
  Surface 只使用 `compact` 288 pt、`standard` 360 pt、`wide` 440 pt 三档宽度，并按标准
  行型自动测量 150–520 pt 高度；业务插件不得自定义面板几何或注入 CSS。Tray 面板关闭按钮
  只隐藏 Tray 面板，不得显示主窗口；鼠标离开面板或面板失焦后等待约 2.4 秒自动隐藏，鼠标
  重新进入时取消隐藏计时。
- List 主从视图中，搜索为空时 ←/→ 在左侧列表与中间详情区域之间切换活动区域；
  随后的 ↑↓/PageUp/PageDown 分别驱动左侧选择或中间详情滚动。用户以 pointer 激活
  中间详情后，即使搜索框仍保留 DOM 光标，垂直阅读键也必须滚动详情。搜索非空时
  ←/→、Home/End、文字输入及带修饰键选择仍归原生搜索编辑。
- **主搜索可直达模块子界面**（Module Surfaces：订阅源、会话、宏等）。协议见 `docs/module-surfaces.md`；用户可在 Settings → Search Settings → Launcher Search Sources 按模块关闭接入。
- Screen Recording、Weather、V2EX、Macro Recorder 标记为 **Beta**：模块名后使用浅色虚线 `Beta` 标识，并通过 tooltip/模块设置说明其可能不稳定。Beta 标识只表达成熟度，不用整卡警告色。内置模块专属配置统一进入 Settings → Extensions → Installed → 对应模块；模块主界面只保留直接跳转链接。
- 可关闭的 Beta 内置模块在 Settings → Extensions → Installed 的模块配置 Dialog 中启停。关闭后必须同时从 Quick Entries、Launcher 静态命令、Module Surfaces 和直接导航中移除；对应 lazy view 不得挂载，模块 effect / IPC 数据请求不得启动。Settings 中的模块卡仍保留，作为重新启用的唯一管理入口。
- **返回走 Bottom Bar 最右侧 Esc**（`escapeAction` + `useEscBack`，文案 Back/Hide）；非主搜索左侧另有小房子一键回主界面。Top Bar 默认不渲染返回箭头；禁止模块在 Top Bar 再做一套返回。
- 右侧 Context Panel 只放导航、辅助信息和当前对象操作入口，不放第二套主布局。
- 插件 Workbench 的 Context 由宿主固定分区：当前对象标题、非主业务 Actions、可选后台状态，
  最后是可选「关于」。关于区只从 Manifest 投影本地化名称、作者和本地化描述；插件不得自行
  复制、排序或绘制另一套 About。当前语言无对应文案时回退英文 `name` / `description`。
- 使用完整 Context Action 区的内置模块与插件面板只在 Bottom Bar 保留 Enter 主动作，
  Context 只列其余业务动作，并关闭重复的 Actions 菜单。插件宿主不得把 manifest 启动命令、
  后台 interval 或宿主 reload 自动追加为当前面板动作。
- 有列表与详情的 Workbench 面板，Enter 是宿主导航动作：列表中打开所选详情，详情中关闭详情并
  返回列表。插件的“在浏览器打开”等业务动作不得占用 Enter，必须作为 Context Action 并使用带修饰键的
  明确快捷键。
- **Context 侧栏由 QxShell 全局控制**：默认宽度使用 `--qx-context-w`，用户可拖动宿主分隔条调整；拖到右缘阈值后收起，主内容占满，收起后仍保留窄恢复轨。宽度由 Shell 使用同一持久键保存，禁止模块用 inline style / 私有 localStorage 改写；列表内部分栏（如 RSS 文章列表宽）继续使用自己的 token。
- Bottom Bar 使用 `grid-template-columns: auto 1fr auto`。
- Bottom Island 必须相对窗口居中：`position: absolute; left: 50%; transform: translateX(-50%)`。
- 无边框主窗口必须让 Top Bar 的标题、空白和非交互包装区域在 macOS 与 Windows 都可直接拖动；Windows 另保留位于顶部缩放边缘以内的独立握区。输入框、按钮、链接、选择器与可编辑内容必须保持 `no-drag`，不得用整条透明覆盖层吞掉控件。
- `.qx-shell-bottombar` 必须 `position: relative`。
- **Top / Bottom chrome 厚度接近**：共用水平 inset 与相近高度 token，禁止顶栏做成远厚于底栏的「大标题板」。
- **Launcher 空闲灵动岛可插拔**：模式走 `src/home-island` 注册表；指标采样必须异步非阻塞。System 信息岛默认只展示 CPU / MEM 两项，GPU 采样可保留在共享数据模型中但不在该岛呈现。
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
  --qx-context-w: clamp(240px, 28vw, 340px); /* Context 默认宽度；实际值由 QxShell 分隔条覆盖 */
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
| 可见 Esc | `escapeAction` | 最右侧返回入口；`variant="escape"` 显示 **文案 + Esc**（Back/Hide）；非主搜索左侧有小房子回主界面 |
| 键盘 Esc 级联 | `useEscBack` → `onKeyDown` / `stepBack` | 每按一次退一层：inner → query → leave module；命中后 `preventDefault` + `stopPropagation` |
| Shell 最终兜底 | `QxShell` 内置 | 若模块 `onKeyDown` 未消费 Esc，则触发 `escapeAction.onClick`（应与 `stepBack` 同语义） |
| Host 阶梯兜底 | `App.performHostEscape` + `moduleEscapeHost` | 焦点不在 Shell 内时仍生效：先 `tryModuleEscapeStep`（`useQxModuleShell` 注册的 `stepBack`，含 RSS 文章列表→源列表），再 leave module → 清空 launcher query → hide。模块已 `preventDefault` 时不二次步进。**禁止**非 launcher 时直接 `setTab("launcher")` 跳过模块内阶梯 |
| 搜索 / 内容筛选 / trailing | `search` / `topbarFilters` / `trailing` | 搜索在 Top Bar 主列；内容筛选只发布数据给宿主固定 Select；`trailing` 仅保留不可归入筛选或 Actions 的短状态 |
| 状态 | `island` / `customIsland` | 轻量任务与位置信息，见 Bottom Island |
| 动作 | `actions` + `primaryActionId` | 单一动作集合；稳定 ID 指定 Bottom Bar 与 Enter 的主动作，Shell 自行生成 Actions 入口 |
| **i18n** | `useT(key, englishFallback)` | **所有用户可见文案**（标题、按钮、空态、toast、confirm）必须可翻译；中文进 `i18n.ts` 的 `zh` 表 |

**禁止：**

- `actions[]` 使用 `kbd: "Esc"` / `"Escape"`（Esc 专属 `escapeAction`）。`QxShell` 在 action 匹配时会忽略 Esc。
- 为 Bottom Bar、Enter、Context Panel 复制动作，或用无回调 action 充当 Actions 菜单哨兵。动作只声明一次，`id` 必须稳定、非本地化且同层唯一。
- 在 Chat Settings 等表单页把 “Done” 标成 `kbd: Esc`（会与级联冲突、且违反 UI_SPEC）。
- 模块硬编码中文或英文 UI 字符串而不走 `useT`（`console` / 开发注释除外）。

推荐写法：

```tsx
const goBack = () => setTab("launcher"); // 或返回上一级视图
const { onKeyDown, stepBack } = useEscBack({
  inner: { active: showDetail, close: () => setShowDetail(false) },
  query: { active: !!localQuery, clear: () => setLocalQuery("") },
  launcher: goBack,
});

return (
  <QxShell
    title="Module"
    search={/* search slot */}
    // 底栏 Esc 与键盘同一阶梯（stepBack），不要写成永远 jump 到 launcher
    escapeAction={{ id: "escape", label: "Back", kbd: "Esc", onClick: stepBack }}
    onKeyDown={onKeyDown}
    island={{ label: "Module", detail: "…" }}
    actions={[
      { id: "open", label: "Open", kbd: "↵", onClick: openSelected },
      { id: "refresh", label: "Refresh", kbd: "R", onClick: refresh },
    ]}
    primaryActionId="open"
  >
    {/* content */}
  </QxShell>
);
```

整窗 Esc 阶梯（Qx 前台时，每次 Esc 只退一层，直到隐藏）：

1. 模块 inner（详情 / 预览 / 录制中停止…）
2. 模块 local query
3. 离开模块 → launcher（`setTab("launcher")` / 上一级视图）；**Settings** 则 `closeSettings()` → `returnTo`（模块/插件/launcher）
4. 清空 launcher 搜索词
5. `floating_hide_restore_focus` 隐藏主界面

Host 窗口 `keydown` 兜底覆盖第 3–5 步；第 1–2 步由模块 `useEscBack` 在 Shell 焦点链上完成。

系统模态交互属于 Esc / 隐藏协议的临时挂起态：

- 打开 macOS 权限设置或原生文件/文件夹选择器前，宿主必须标记 external interaction；
  期间 Qx 保持显示，blur、点击窗口外和 Esc 不得把正在进行的下一步操作藏掉。
- 文件读取/导入完成或选择器取消后，清除该状态；打开系统设置时则在 Qx 再次获得焦点
  时清除。随后恢复正常 Esc 阶梯与点击窗口外隐藏。
- 不得用进程级 Esc 监听关闭系统选择器，也不得因为授权窗口抢焦点而把 Qx 当成普通
  blur 自动隐藏。

禁止：

- 同时传 `onBack` 与 `escapeAction`（会画出左上角箭头 + 底栏最右侧 Esc，双返回）。
- 新代码依赖 `onBack` / `backLabel` 渲染 Top Bar 返回箭头。`onBack` 仅为历史兼容；模块应只传 `escapeAction`。
- 在 Context Panel 外再做一套全局返回栏或 footer。
- 复制 Esc 监听逻辑而不走 `useEscBack`。

## Theme

主题采用 shadcn/Tailwind 语义 token + Qx 透明度算法：

- `ThemeProvider` 必须同步设置 `data-theme` 和 `.dark` class。
- `src/App.css` 通过 `@theme inline` 暴露 shadcn 标准 token。
- `src/styles/base.css` 负责把 Qx token 映射到 shadcn token。
- 透明度只作用在 surface/background token 上，不使用组件整体 `opacity`。
- 系统毛玻璃是独立开关：关闭时原生 Vibrancy/Mica 与 CSS backdrop blur 同时关闭，所有表面以不透明 token 渲染；重新开启恢复此前参数。Windows 11 使用 Mica；Windows 10 不启用拖拽性能较差的 Acrylic，改用高不透明度 WebView 表面。
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

Advanced → Diagnostics 提供独立的 **Diagnostic Logging** 开关，默认关闭。开启后才将
运行诊断写入本地 `qx.log`；Developer Mode 仍可隐式启用 debug 日志。日志级别只控制
已启用日志的详细程度。诊断页必须提供日志文件定位入口；文件搜索诊断只能记录耗时、
阶段、计数和错误码，不记录完整搜索词或结果路径。

组件规则：

- 常规 Button、Input、Select、ToggleGroup/Tabs 的外框高度统一为 `32px`；紧凑工具栏允许使用 `28px`，Shell Top Bar 搜索与筛选统一为 `36px`。业务 CSS 不得再定义第四套默认控件高度。
- `update-progress` 等独立透明任务窗口必须在 WebView 边缘保留 `8px` 透明 inset，由单一内容表面使用 `--qx-effective-radius`（默认 `8px`）裁切和绘制阴影；禁止“直角原生阴影 + 内层大圆角卡片”的双层窗口。Windows 关闭透明无边框窗口的 DWM 方形阴影，按钮复用 Qx shadcn `Button` 的标准 `32px` 高度。
- 常规控件横向内边距统一为 `10px`，正文统一为 `12px / 500`；选中态、当前段和主操作使用 `600`，普通控件不得默认使用 `700` 造成无差别加粗。
- Settings 非堆叠行的 Select、SegmentedControl、Slider、数字组合输入统一占用 `220px` trailing 轨道；Switch、图标按钮等固有尺寸控件除外。窄窗口允许收缩，但同组控件必须保持等宽与右侧对齐。
- 视觉型选项（例如应用图标）可使用更高的内容区，但其外框宽度、圆角、选中态、字号和字重仍必须遵守同一控件系统。
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

Top Bar 包含搜索、可选 leading 和宿主统一渲染的内容筛选。**不包含模块返回，也不放刷新、新建、导入、截图等命令按钮**；返回统一在 Bottom Bar 最右侧 Esc，命令统一进入其左侧的 Bottom Bar 主动作或 Actions。

列布局：

| 条件 | 类名 / 网格 | 列含义 |
|---|---|---|
| 默认（无 leading / 无 `onBack`） | `.qx-shell-topbar.no-leading` → `minmax(search) 1fr · trailing` | 搜索主列 + trailing |
| 有 `leading` 或历史 `onBack` | `.qx-shell-topbar` → `auto · minmax(search) 1fr · trailing` | leading + 搜索 + trailing |
| Launcher 两栏 | `.launcher-shell .qx-shell-topbar` | 搜索对齐 Content / Context 分割线 |

要求：

- 模块搜索统一使用 `qx-search-wrap` + `qx-plugin-search`。
- 搜索框是否在进入页面时自动聚焦必须由调用方显式声明 `autoFocus`；
  `QxModuleSearch` 默认不抢焦点。Launcher、聊天输入和以搜索为首要入口的列表可声明
  一次性自动聚焦，编辑器、Workbench 表单和设置详情不得被隐式搜索焦点覆盖。
- 搜索框不是永久键盘所有者。用户点击列表、详情、按钮、表单或空白阅读区域后，
  焦点留在新的交互区域；Shell 禁止在全局 `pointerup` 后强制聚焦搜索框。
  `data-qx-search-focus="preserve"` 仅保留为旧控件兼容标记，不得再作为全局抢焦点例外机制。
- Launcher 与模块搜索框必须关闭浏览器/macOS 的拼写检查、自动纠正、自动大写和自动补全，确保缩写、路径、命令及标识符严格保留用户输入。
- 搜索是 Top Bar 的主体内容，并保留一个独立、紧凑的输入控件表面；只允许一层边框、背景和 focus ring，不得再包裹第二张搜索卡片或装饰容器。
- 列表型模块中，搜索文字的起始位置必须与主列表行标题列的起始位置对齐，允许误差不超过 `4px`；对齐对象是标题文字，不是列表外边缘或类型图标。列表行本身不得为「已删除的顶栏返回」预留大段 `padding-left`。
- Launcher 等带 Context Panel 的两栏 Shell，搜索卡片右边缘必须与 Main Area / Context Panel 分割线对齐，允许误差不超过 `4px`；筛选控件位于右侧 trailing/context 轨道。
- 搜索占据可用主列；内容筛选通过 `QxShell.topbarFilters` 发布 `id / label / value / options / onChange`，由宿主固定 Select 渲染在 trailing 列，不得把搜索缩成短输入框。
- 内置模块和插件都不得在 `trailing` 中自绘 Select、分段按钮或 tabs 充当内容筛选。刷新、新建、导入、录制等命令属于 Bottom Bar / Actions；短状态优先进入 Island，避免 Top Bar 重新变成工具按钮排。
- 插件安装、升级、重装成功只通过 Bottom Island 显示一次结果，不得在插件库内容顶部再渲染重复成功横幅；下载、兼容、安装失败仍须在当前操作区域保留可读错误，同时可同步发布 Island 错误状态。
- Quick Entries 不以成组图标占用 Top Bar；它们保留在 Context Panel、Actions 或专用入口中。Top Bar trailing 只保留筛选和当前上下文必需操作。
- Launcher 右侧 Quick Entries 保持用户可编辑；其后提供默认展开、可折叠的“所有模块”目录，
  由宿主模块目录与外置插件注册表自动生成，只显示当前已启用入口，不维护第二份硬编码列表。
  文件搜索入口切换到 Files scope、清空旧 query 并聚焦搜索框；模块启停或插件安装状态变化后，
  “所有模块”必须自动同步。
- Launcher 的 All / Files 搜索中，每次非空 query 变化（输入、删除、粘贴）都必须立即调用文件搜索 pass 0；后续 pass 可异步增量合并，但不得以字符数阈值、Enter 或失焦作为首次调用条件。旧请求必须由序号/取消信号隔离，不能覆盖新 query。
- Launcher 结果单击只更新选择，双击或 Enter 执行主动作。文件交给系统默认应用打开；文件夹交给平台文件管理器打开（macOS Finder、Windows 文件资源管理器），不得走仅允许应用包或可执行文件的 `open_app` 端口。
- Launcher Bottom Bar 与 Actions 必须消费同一个条目类型模型：文件夹显示“打开文件夹”，
  任意后缀的普通文件显示“打开文件”并交给系统默认应用，只有原生应用显示“打开应用”。
  “显示包内容”仅属于 macOS `.app`，不得出现在 Windows `.exe`、普通文件、文件夹、
  Qx 命令、计算结果或剪贴板条目中。
- Launcher 结果右键不再打开另一套条目菜单：必须先选中指针下的结果，再把同一套 Actions
  Popover 锚定在指针附近；`Cmd+K / Ctrl+K` 与右下角 Actions 按钮仍锚定 Bottom Bar。
  两种入口共享动作、快捷键、层级菜单和执行回调，只允许弹出位置不同。
- Launcher 的键盘选择与鼠标 Hover 相互独立：方向键立即移动选中项；鼠标移动只显示
  Hover，不得暗中改变当前选择。单击确认选中，双击执行该条目的 Enter 主动作；右键也先
  确认指针下条目，再打开 Actions。
- 系统托盘内置状态、快捷入口、窗口动作与退出项必须跟随 Qx 的 `system / English / 简体中文` 语言设置，并在语言变化后立即重建；用户自定义标题保持原文。插件托盘项通过 `titles` / `groupTitles` 发布双语文案，由宿主选择当前语言。
- macOS 首次引导覆盖普通 Shell 时，卡片顶部必须提供明确的窗口拖拽握区，卡片外空白背景也可移动无边框窗口；拖拽层不得覆盖按钮、开关、链接或正文交互。
- 文件结果只按 leaf name 命中，不以父目录制造相关性。短 ASCII 词（四字符及以下，例如 `Siri`）只允许字面量与弱分隔匹配，不生成逐字符通配符；更长 ASCII 缩写及至少三字符的非 ASCII 查询才允许密集有序子序列召回。Cardinal、Spotlight 与 Everything 的候选必须经过同一后置匹配，分类内先按名称相关性、再按修改时间排序。
- trailing 操作不得挤压搜索框到不可输入。
- 声明式 Workbench 的 Top Bar 由宿主统一组合：搜索只占 `search` 主列，tabs 与 `filters[]` 统一投影为 `topbarFilters` 固定 Select；筛选变更继续通过 `onTab(id)` / `onFilter(id, value)` 回传。插件不得提供筛选 DOM 或 CSS。后台状态进入紧凑宿主状态或 Island；统计、loading 与 error 信息属于 Main Area 状态行，不得把 Top Bar 撑成第二层。
- Workbench 是结构化业务表面，不是 CLI 专用皮肤。CLI、HTTP 与 typed
  `context.system.*` 数据源均可复用 List / Gallery / Detail / tabs / Actions；
  Sysinfo 是系统 API 数据源的参考。只有图表、地图、画布等无法表达为宿主结构化
  数据的布局才使用 custom panel。
- Extensions 的 Raycast URL 转换入口保留但必须明确显示 Legacy / Frozen 与暂停维护提示；正式插件默认路径是从上游源代码按 Qx Workbench / Actions / Island / `context.*` 协议重新开发。
- Workbench 发布后即使隐藏的插件 iframe 暂时保留焦点，List / Gallery 的方向键、Page、Home/End 与 Enter 也必须转交可见宿主 Shell；首次发布应把焦点恢复到宿主搜索或集合区域，后续选择刷新不得抢回焦点。
- Workbench List / Gallery 的鼠标点击必须由宿主立即更新选中态并异步通知插件；宿主视图可见时隐藏 iframe 必须退出指针命中层，不能让插件回传延迟或透明叠层造成点击无响应。
- Workbench query、active tab、filter value 与 selectedId 采用受控双层状态：宿主先乐观呈现交互，插件 handler 同步更新业务 state 并重新发布；慢 I/O 不得阻塞回画。Action 事件必须携带触发瞬间的 selectedId 快照，快速选择后执行不能落到旧条目。
- Workbench item `id` 是强制、稳定且唯一的业务键；缺失或重复 item/tab id 在信任边界直接拒绝，tabs 最多一个 active，不提供 title/index 兼容回退。`data:image/` 不得被截断成损坏 URL，超出宿主上限时应整体拒绝。
- Workbench 打开时先显示宿主保存的上次成功快照，再以 loading 状态后台刷新；空 loading/error
  快照不得替换仍可用的 items/detail。集合增量按稳定 item id 执行 upsert/remove/order，保持
  未改变的详情、选择和滚动；只有成功的空结果可以清空旧集合。敏感面板可显式禁用宿主缓存。
- Workbench manifest command 完成后宿主必须发送 `commandComplete` 回执；插件据此单次重读共享持久化状态，不得用亚秒级磁盘轮询等待暂停、继续、停止等动作生效。
- Workbench Gallery 使用当前响应式网格的真实列数做二维选择：←/→ 在同行移动，↑/↓ 跨行并尽量保持列位置。焦点留在搜索框时，上下键仍浏览网格；空查询的左右键也浏览网格，有查询文字时左右键才保留原生光标语义。
- 二维索引计算必须复用 `qxGridNavigation`；Workbench 只是消费者，不得在插件宿主内维护一份专用网格算法。List / Detail 的 region id 与 navigation 复用 `useQxMasterDetail`，Actions 项复用 `QxShellAction + QxActionList`。
- Workbench List / Gallery 默认以完整 Main Area 作为浏览画布；点击条目或对带详情的条目按 Enter 后，宿主统一切换为「左侧保留当前 List / Gallery 集合 + 右侧 Detail」的主从布局。Esc 先关闭 Detail 并恢复全宽集合，再清本地 query，最后离开模块；Context Panel 仍只承载 Actions。插件不得为 Bing、Unsplash、Brew 等消费者各自复制这套布局状态。
- Workbench List / Gallery 的内容轨是稳定宿主表面：空数据或少量数据时仍占满当前浏览区或已打开详情时的左侧集合栏；空态必须跨满所属区域并垂直居中，不能缩成首个 grid cell 或随 item 数量塌缩。若发布的是无条目的面板级 `detail`，Detail 直接占满 Main Area，不保留无意义的空集合栏。
- Workbench Detail 的正文浏览位置由宿主按 `pluginId + tab/filter scope + item.id` 统一保存为归一化百分比。首次打开未读过的条目必须从顶部开始，不能继承前一个条目的 `scrollTop`；返回旧条目恢复其自身位置，正文和图片异步增长期间继续校正。插件不得自行操作宿主滚动 DOM。
- Workbench List 必须像 V2EX 一样始终保留左栏 section header 与数量；首次空载显示统一骨架行 + LoadingLabel，已有条目刷新时保留旧列表并把数量短暂显示为 `…`，不得退回整栏纯文本 loading。
- Workbench List 的单图缩略图继续使用 `item.image`；社区动态可用
  `item.images[]` 在文字轨下显示完整的横向滚动图片卡；宿主只保留与详情相同的 24 张
  异常输入安全上限，不得截断正常社区动态的图片集合。
  阅读文章不得把正文图片冒充列表缩略图，应通过
  `detail.mediaPlacement: "after-body"` 把 `detail.image(s)` 放在正文之后。
- Workbench 右侧图片详情必须由宿主适配横图、竖图、超宽图和窄内容区：单图使用
  `detail.image`，社区帖子等多图内容使用 `detail.images[]`；多图由宿主排成响应式网格。
  需要保留原文图文顺序的长文章使用 `detail.content[]` 发布有序的 `text` / `image`
  结构化块；宿主按顺序渲染并把所有块内图片组成同一预览集合。插件不得因为宿主只接受
  纯数据就丢弃上游已有的段落位置，也不得改为发布 HTML。
  详情图片默认按原始比例 contain，可声明 landscape/square/portrait 固定舞台；加载失败
  显示局部错误，点击可缩放图片打开宿主 Dialog，Esc 先关闭 Dialog。Dialog 必须保持
  在窗口可见范围内。普通图片首次打开的 100% 表示相对当前预览区域的完整 contain
  基准，而不是原始像素 1:1 或只铺满某一边；横图与竖图均不得在初始 100% 状态超出
  预览区域。加载后高度/宽度达到 3.2 的超长截图
  改为按宽度阅读并从顶部纵向滚动，不得强制塞满舞台高度或裁掉顶部/底部。画布必须
  支持 50%–400% 缩放、复位、双向滚动与按住拖拽平移，并保留
  Cmd/Ctrl+滚轮及 `+` / `-` / `0` 键盘操作。普通滚轮或触控板滚动不得修改缩放值；
  图片放大后，它只负责双向平移。底部缩放控件不得使用成组大工具条；
  加减按钮使用与右下角页码同高的紧凑圆形控件，百分比复位使用同规格胶囊。
  插件 iframe
  不负责预加载；宿主在大图打开及每次切换时应异步预取并解码前后各两张图片，使用
  最近访问 15 分钟、最多 24 张的 LRU 解码缓存，关闭预览不立即释放；超时或超过
  预算后按最后访问时间淘汰。缓存是性能策略，不得截断插件发布的正常图片集合；
  失败不得阻塞当前图片或改变导航顺序。
  不得注入宿主类名 CSS 或自建 lightbox 来修右栏。
- Workbench 的局部异步反馈使用 `item.status` / `detail.status`，已有图片和字段在刷新时继续可见。状态可传真实 `progress: 0–100`，或批量任务的 `completed / total / failed`，宿主通过统一 activity 协议计算百分比；未知进度不得模拟。分批/批量结果通过 `mountWorkbench()` controller 的 `updateItems({ upsert, removeIds, order, selectedId })` 按稳定 id 合并；SDK 仍向宿主发布完整纯数据快照。并发整快照可用单调 `revision` 做 latest-wins，旧 revision 不得覆盖新数据、选择或详情。
- Workbench 管理型详情可在 `detail.form.actions` 发布表单底部动作；同一业务对象的连续 controls 可用稳定 `group.id` 合并为一个 fieldset，并由首个 control 的 `group.action` 提供组内操作。宿主统一渲染按钮、危险色和事件 selectedId，插件不得为参数删除等常规管理重新自绘 DOM。
- Settings → Extensions 的 Installed / Plugin Store 与当前页工具必须共用一行紧凑工具栏。Plugin Store 在该行依次放仓库筛选、仓库源管理与唯一的“重新扫描”；每个仓库及“全部插件库”的插件数量直接显示在筛选下拉项，内容区不得再画数量标签或重复一行“刷新仓库源”。“重新扫描”在商店页强制重新读取当前仓库源。
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
  grid-template-columns:
    minmax(0, 1fr)
    var(--qx-context-handle-w)
    var(--qx-context-current-w, var(--qx-context-w));
}
```

滚动规则：

- Shell 外层不做页面级滚动。
- Main Area 在几何上延伸到 Top/Bottom Bar 背后；上下栏使用单层自适应磨砂材质、
  细边缘高光和短距离 scroll-edge fade。禁止在整个 Shell 与上下栏重复叠加 blur。
- 内容滚动容器使用与上下栏等高的安全 inset；滚动时内容可以进入栏后并被材质柔化，
  初始内容和键盘滚动落点不得被栏遮挡。
- Main Area 的直接子视图不得再次叠加 `--qx-topbar-h` / `--qx-bottom-bar-h`；业务布局只加
  自身紧凑内边距，避免首屏空白和无内容溢出。Launcher Home Dashboard 遵循此规则。
- 内容列表、详情、Context Panel 各自管理滚动。
- 左右栏滚动互不影响。
- 任意宽度下不得产生横向页面滚动。
- **滚动条**：所有原生 scrollbar chrome 永久隐藏，统一由 `src/utils/overlayScrollbar.ts` 绘制固定浮层拇指；仅对应区域**正在滚动**时短暂显现，停止后自动淡出。普通 overflow、Radix ScrollArea 和插件 iframe 必须使用同一细线样式；勿在业务模块写常驻宽滚动条或第二套 scrollbar。Workbench 横向胶片仍使用该浮层拇指，并通过宿主内部 inset 将其贴近图片底边，禁止恢复占满详情宽度的原生轨道。

Context Panel：

- 默认宽度使用 `var(--qx-context-w)`；宿主 `QxContextSplit` 可在 220–420px 内调整并全局持久化。
- 分隔条可用鼠标/触控笔左右拖动；右栏缩至阈值以下时折叠为 0，主内容占满。折叠后保留窄恢复轨，向左拖动或双击可恢复。
- 分隔条使用 `role="separator"`：Left 扩大右栏、Right 缩小，Home 到最大，End 收起；折叠 Context 的可聚焦后代必须进入 inert 状态，Shell 区域导航忽略它们。
- 面板本身就是容器，不再套大卡片菜单。
- 列表项可有 hover/active，但不要把整个右栏做成一张卡。

### 阅读类主区（RSS 等）

仍用 **同一套 QxShell**（Top / Main / Bottom / Context），但主区内容按阅读优化，与列表工具的「密排扫描」区分：

- 打开文章时 Shell 可切 `visual="glass"`，并给 shell 加 `is-reading`。
- **正文字行长随阅读列宽变化**（不强制居中 max-width measure）；列表栏可略收一点让出正文。
- Context 仍只放动作，宽度由 Shell 全局分隔条控制；RSS 不单独保存或覆盖宽度。
- 正文字号/字体来自 Settings → RSS；正文排版（段落/标题/代码）可增强，但**文章标题样式保持原逻辑**。
- 阅读进度按文章 ID 隔离持久化为 0–100 的归一化位置；滚动停止后节流写入，切换文章或离开详情时只提交正在退出的阅读会话快照。不得在复用滚动 DOM 时读取下一篇的尺寸并回写上一篇。再次打开时应在正文与图片布局稳定后恢复，窗口、字体或栏宽变化不得依赖旧像素偏移。

## Bottom Bar

结构：

```text
[ 🏠? ]   [ Bottom Island ]   [ Primary / Actions / Back|Hide + Esc ]
```

布局：`.qx-shell-bottombar` 为 `position: relative` + `grid-template-columns: auto 1fr auto`；Island 绝对居中叠在中间轨。

### 左侧 Home / 右侧 Actions + Esc

- 最右侧渲染 `escapeAction`（或兼容路径下由 `onBack` 推导的 fallback），通过 `ShellActionButton variant="escape"`；主动作与 Actions 菜单位于它左侧。
- escape 变体显示 **文案 + Esc 快捷键胶囊**：
  - **主搜索 Launcher**（`islandKey="launcher"`）：空查询为 **Hide / 隐藏**（隐藏主界面）；有查询为 **Back / 返回**（**整行清空**搜索框，不是只删光标处）。中文 IME 候选打开时 Esc 先取消候选；仅 `isComposing` 时让给 IME，不得用粘滞 `keyCode 229` 吞掉清行。**不显示**小房子。
  - **非主搜索**（模块 / Settings / 插件 / loading）：**Back / 返回**（与 `useEscBack.stepBack` 同语义，每按一次退一层）。
- 非主搜索时，底栏左侧另有一个同风格 **小房子** 按钮（`shell.goHome`）：一键回到主搜索 Launcher，跳过模块内阶梯与 Settings `returnTo`。Launcher 不渲染该按钮。
- `escapeAction.onClick` 应与 `useEscBack.stepBack` 一致。无 inner/query 时等价于最终 leave：
  - 模块根视图 → `setTab("launcher")`。
  - **Settings** → `closeSettings()`（`openSettings` 记录的一层 `returnTo`：调用方模块/插件，否则 launcher）。禁止 Settings leave 写死 `setTab("launcher")`。
  - 子视图（如 QxAI chat/settings、RSS detail）→ 回到模块内上一级列表。
  - 录制等临时态可先停任务 / 丢弃草稿，再在级联下一层离开。
- 禁止用 `actions[]` 的 `kbd: "Esc"` 替代最右侧 Esc；Esc 快捷键仍只归属 `escapeAction`。

### 中间 · Bottom Island（QxIsland）

- 由 `QxIslandDockSlot` / `QxIslandSurface` 统一渲染（`docs/qx-island-architecture.md`）。
- **统一高度 `34px`**（min 32 / max 36）；docked 宽 `min(400px, calc(100% - 260px))`。
- Chrome（尺寸、居中、玻璃/border）只在 `.qx-island-surface`；内容不得自带 absolute 外轮廓。
- 模块 `island` prop 经 shim 写入 session store；`customIsland` 只用于无法表达为标准岛内容的
  分类例外，并会抑制 store docked。录屏控制不属于该例外，必须使用捕获专用受保护工具栏。
- 文本单行截断；progress 默认使用 Surface 下层的浅蓝背景从左向右填充，也可由
  生产者选择宿主图标环、Surface 环或文案列短线；任何样式都不得撑高底栏或遮挡交互。
- `surface-fill` 使用统一的轻量点状“萤火虫”光效：粒子在当前填充区域内缓慢闪烁，滑块/填充
  下降时，原先右侧的荧光残影保留约半秒后淡出；真实 progress 立即更新，残影不能影响交互或
  可访问数值。`prefers-reduced-motion: reduce` 下关闭粒子与残影动画。
- 灵动岛短文案不使用渐隐蒙版；仅在文字实际溢出并启用跑马灯时对右边缘渐隐，左边缘
  始终保持不透明，不能遮挡首字。
- Launcher 主搜索的扫描与结果进度固定使用线条表达：扫描态保留专用 step bar，
  搜索完成态显式使用 `compact-line`，不得继承普通任务的 `surface-fill` 默认值。
- Island 文案未溢出时必须完整显示，不得套用边缘渐隐；只有宿主确认 marquee
  实际溢出后才启用左右遮罩和滚动，首尾字符不能被图标、进度层或遮罩覆盖。
- 不确定进度只使用宿主动画枚举：`wave`、`dots`、`spinner`、`pulse`。Producer
  不提供 SVG、DOM、CSS 或伪造百分比。session
  winner 切换只允许宿主短淡入，普通 progress/文案 update 不重复触发入场动画。
  加载动画只能在固定尺寸的内部盒子中改变描边、旋转、透明度或缩放，不得对 Surface、
  整行内容或加载元素做纵向位移，也不得通过动态高度造成灵动岛跳动。
- `countdown` 使用绝对 `endsAt` 或暂停态 `remainingMs`；宿主以等宽 tabular 数字实时渲染，docked / floating 不依赖生产者每秒推送文本。
- 普通模块 / 插件 slots 岛左侧由宿主按 `openTarget` 渲染 **24px 圆角矩形模块图标**；
  点击直接回到该内置模块或插件 Panel。内置 `QxShell` 默认从稳定 `islandKey` 命名空间
  绑定模块目标；插件目标和已解析的插件图标资产只由可信 bridge 绑定，缺图时使用宿主
  通用插件图标。业务内容不得自绘图标按钮或伪造跳转。
- 暂停的 `countdown` 必须保持静止：冻结剩余时间与底边进度，并由 `ShellContent`
  抑制 `wave / dots / spinner / pulse`，即使旧 producer 仍误传 activity 也不得播放。
- Island action 使用统一 22px 胶囊按钮：受限 `pause/play/stop/open` 图标、可见 hover/active/focus 状态，永远位于 trailing 最右；宿主模块最多可并列两个紧凑动作，插件仍只允许一个；动作可由宿主显示平台化快捷键提示（例如 Space），插件不得注入自定义按钮 DOM/CSS。
- Island business action 只能由 `IslandActionButton` 渲染；执行期间按钮进入 busy/disabled
  状态，防止重复提交。浮窗的缩小/展开与打开 Qx 是独立的宿主窗口控件，不占用
  producer action 配额。
- 为空时 `visibility: hidden` 保持布局稳定。
- Appearance → Desktop Floating Island 是 Qx 级总开关，不归番茄钟或任一插件所有。
  总开关只决定底部灵动岛是否显示宿主“悬浮到桌面”按钮；浮窗**不得**因 session 更新、
  计时开始、主窗隐藏或插件请求而自动弹出。只有用户在 Qx 底部灵动岛点击该按钮，
  本次浮出意图才成立。首次浮出默认位于**主显示器工作区右上角**；用户可从非按钮内容区
  拖动到任意显示器，位置写入 Appearance 设置并在隐藏/显示、缩小/展开和应用重启后恢复。
  已保存坐标不再可见时回落到当前主显示器工作区。浮窗只显示 host task 或获 `island` 权限的插件
  结构化 slots；背景透明度、主题、圆角与 docked `QxIslandSurface` 使用同一组 token。
  当前前台模块的非粘性 `location` 固定优先于后台粘性 `location`；只有后台常驻模块 / 插件
  之间按用户设置的时间间隔公平轮播。因此 RSS 阅读进度不会被番茄时钟轮播替换，离开 RSS
  后番茄时钟仍在 store 中恢复显示。`task > error > toast` 会立即抢占，结束后恢复前台或轮播。
  插件不能提供自定义 chrome、窗口坐标、轮播周期或置顶
  策略。已手动浮出的窗口在主窗隐藏时是否保留、是否 always-on-top 均由用户设置决定。
- 主窗与桌面悬浮灵动岛同时可见时属于同一 Qx 焦点组；点击灵动岛不得让主窗进入不可操作
  或前端 hidden 状态，焦点在二者之间切换不触发“失焦时自动隐藏”。只有焦点真正离开
  两个 Qx 窗口后才执行自动隐藏，且灵动岛保持可交互。
- 悬浮 Surface 最右侧固定提供宿主级“缩小 / 展开”、“打开 Qx”和“关闭”图标按钮。关闭会
  清除本次手动浮出意图；后续 session / 倒计时更新不得把窗口重新打开。展开宽度
  为 400px，缩小后真实窗口收至 240px，只保留阶段、倒计时和宿主按钮；插件动作在
  缩小态暂时隐藏，展开后恢复。缩放不得留下透明 WebView 区域阻挡桌面点击。
- “打开 Qx”按 session 的宿主 `openTarget` 回到 Launcher、内置模块或插件 Panel；
  插件不能伪造目标，插件 bridge 固定绑定当前插件。旧 session 没有目标时安全回退为
  仅显示主窗口，不擅自改变当前 route。

### 右侧 · Actions

- 只消费当前上下文的单一 `actions[]`。`primaryActionId` 指向其中一个稳定 ID，投影为主按钮与未修饰 Enter；Actions 菜单和 Context Panel 引用相同对象。
- 无可用动作时不渲染按钮。
- Bottom Bar 动作按钮不使用 pointer hover 改变颜色、边框或亮度；默认状态必须保持可读，交互反馈使用 `:focus-visible` 与 `:active`。
- 菜单入口文案由 Shell 固定为中文“操作”、英文 `Action`，快捷键固定为平台化的
  `Cmd/Ctrl+K`；模块不得覆盖为“终端操作”等领域名称。
- 禁止模块用 `onKeyDown` 再实现一份 bare Enter 业务语义；搜索框中的未修饰 Enter 也由 Shell 执行当前主动作，IME 组合输入除外。
- 窄窗口可压缩主动作或隐藏 Island 次要信息，但不得隐藏 Action 的快捷键提示；
  Action 文案可截断，快捷键本身必须保持完整且不参与收缩。
- `Action` 打开临时菜单，不把菜单内容塞进 Context Panel。
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
- 内容区右键统一复用这套 Actions Popover：Shell 从指针下最近的
  `data-qx-list-index` 读取条目索引，先调用 `navigation.onChange` 提交选中态，下一帧再把同一
  `actions[]` 锚定到指针坐标打开。内置模块与 Workbench List/Gallery 不得为右键另写菜单；搜索框、
  编辑器和 Actions/Bottom Bar 等宿主控件保留各自的原生/既有右键语义。
- 模块不得在搜索框聚焦时用裸字母（如 `n` / `s`）强行拦截输入；裸快捷键仅在非编辑目标、或 Actions 菜单打开时由 Shell 协议处理。

## Bottom Island

权威模型为 `IslandSession` + `IslandSlotContent`（`src/island/`）。模块仍可传遗留 `BottomIslandContent`；shim 映射为：

| 遗留字段 | slots |
|---|---|
| `label` | `primary` |
| `detail` | `secondary` |
| `progress` / `progressStyle` / `activity` | `meter` |
| `actionLabel` / `onAction` | `action` + `bindActions` |

遗留形状（仍支持）：

```ts
{
  label: string;
  detail?: string;
  progress?: number;
  progressStyle?: "surface-fill" | "icon-ring" | "island-ring" | "compact-line";
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

同优先级中的长期模块/插件位置态不以“最后一次更新”永久霸占：当前前台模块发布的
非粘性 `location` 先显示；后台粘性 `location` 才进入统一轮播队列。进度、倒计时心跳
和文字更新不得重置轮播或抬高排序。任务、错误、通知按上述优先级抢占，生产者不得用
高频更新模拟重点事件。

规则：

- 未知进度不要伪造百分比。
- 进度使用 `progress`，阶段文字放 `detail`。
- `progressStyle` 是宿主受控枚举：`surface-fill`（默认浅蓝背景从左到右填充）、
  `icon-ring`（模块图标圆角外沿）、`island-ring`（Surface 圆角外沿）或
  `compact-line`（文案列短线）。生产者不能传颜色、SVG、DOM 或 CSS；未知值回退默认。
- 不确定进度使用 `activity: "wave" | "dots" | "spinner" | "pulse"`；同一状态只选
  一套，默认通用加载推荐 `wave`，轻量等待推荐 `dots`，短命令推荐 `spinner`，持续
  采样推荐 `pulse`。
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
窗口 show/focus/navigate 只允许同步恢复可见状态、缓存快照与必要焦点；系统指标、模块状态、
历史记录和缓存修复统一进入 `windowActivation` 延迟/idle/合并调度。控件 `focusin` 不得触发
后台采样，Windows 不得为普通 DOM 聚焦重复请求原生 key window。

```text
岛 UI ──subscribe──► data/bus ──idle/timer──► Tauri invoke (Rust spawn_blocking)
  ▲                      │
  └── useSyncExternalStore（只读缓存）
```

通用要求：

1. **首屏**：先渲染占位（`--` / 空 VU / 空条），禁止在 render 路径 `await invoke`。
2. **首次采样**：`requestIdleCallback`（fallback `setTimeout(0)`），不得同步打满主线程。
3. **兴趣计数**：仅挂载中的模式订阅的 channel 才轮询；卸载即减引用。
   指标开关全关时必须传入零通道，不得仅隐藏 UI 后继续订阅；最后一个订阅释放时同步取消
   interval、idle callback、延迟 kick 和窗口激活监听。托盘指标只在托盘窗口实际激活时采集。
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

- 空查询时左侧显示紧凑 Home Dashboard（置顶应用 + 用户选中的系统组件），右侧保留常用
  入口、全部模块与主页组件编辑；有查询时左侧恢复搜索结果。Dashboard 不是新 route，
  因此 Esc 空查询仍隐藏窗口，输入焦点、Top Bar 和 Bottom Bar 契约不变。
- Home 组件只使用宿主注册的语义数据源。内置 CPU / Memory / Power / Network 复用
  `home-island/data` 兴趣计数总线；RSS 未读最新帖子复用宿主 RSS 快照端口并先画本地缓存。
  插件 `manifest.homeWidgets[]` 只能把受支持数据源关联到自身 Panel；插件若要让宿主把一项
  轻量信息透出到 Home，应声明 `manifest.surfaceProviders[]` 的受支持语义源。两者都不能
  注入 DOM、CSS、刷新周期、尺寸或点击动画，Home/Tray 读取 Provider 时不得启动完整插件运行时。
- 置顶应用组件只消费 `settings.search_metadata.*.pinned/pin_order`，与搜索结果 Actions 的
  Pin to Top 是同一份配置；不得另建“桌面收藏”列表。
- 搜索结果、右侧入口、底部动作都支持键盘操作。
- 选中应用 / 可管理入口后，Bottom Bar **⌘K / Ctrl+K Actions** 与右键菜单共用同一套管理能力：
  **置顶（Pin to top）**、**隐藏主页**、**编辑别名**、（仅原生应用）**录制 / 编辑全局启动快捷键**。
  置顶写入 `settings.search_metadata` 的 `pinned` + `pin_order`；**置顶区始终在结果最前**
  （独立分组 `launcher.pinned`），不受搜索相关度排序或 Qx/应用/插件分类影响；搜索时仍注入
  未命中 query 的置顶项。别名参与搜索召回；应用快捷键写入 `settings.app_shortcuts`。
  Actions 菜单内可用单键：`p` 置顶、`a` 别名、`s` 快捷键、`h` 隐藏。
- 主搜索选中行必须明显区别于普通 hover：使用弱 accent 混合背景与完整的浅蓝色细描边，不使用点阵、左侧实线或括号式轮廓，也不得仅依赖在浅色透明主题下难以辨认的 component 背景层级。键盘选中项越过可视区域时必须以 `block: nearest` 自动滚动跟随。
- 非文件结果固定按 Qx 内置、应用程序、外置插件分组，沿用文件分类的 hairline 标题、统一键盘选择和 Enter 折叠交互。Qx 内置命令与模块来自启动时同步注册的本地目录，必须先进入结果候选，不等待应用扫描、文件索引或外置插件 IPC。
- 文件结果按 Settings → File Search 中的用户分类顺序显示；默认顺序为文件夹、多媒体、代码、Office、图片、压缩包、其他文件，每类可配置多个扩展名。分类行只使用 hairline 线性分隔，不包裹卡片。分类行与文件行共同参与 ↑/↓、Page、Home/End 导航；分类行按 Enter 或单击切换展开/折叠，折叠后分类行继续保留并保持可选中。每个 pass 使用一次后台查询，由后端按分类优先召回并平衡结果；多 pass 渐进合并且旧 query 必须失效，不能为每个分类堆一组不可取消的系统查询。每个分类内默认按修改时间倒序，异步批次更新时不得让已选中的分类行失效。
- 内置模块命令必须同时匹配英文标识、当前中文名称与常用功能别名；例如“设置 / 偏好设置 / 扩展 / 快捷键 / 外观”都应召回 Qx Settings，并以命令自身的匹配档位参与排序，不能被同名系统应用或文件结果挤掉。
- 只有 Launcher 是裸字符的默认搜索归宿：焦点意外落在非编辑控件时，首个可打印字符
  或删除键转交 Launcher 搜索且不能丢字。模块 Shell 不得因普通 pointer 交互把焦点拉回
  顶栏搜索；模块需要重新搜索时由用户点击搜索框或使用明确快捷入口。
- 查询输入与结果发布解耦：输入先绘制，约 45ms 静默窗口后再启动 latest-wins provider；旧请求立即失效，渐进批次合并后避开输入帧提交，排序 Worker 常驻且只保留最新等待任务。
- Esc 级联（根视图）：有搜索文字时 **清空 query**（可继续输入并用 Enter 打开结果）；query 已空时再 Esc 才隐藏窗口（host escape）。
- 从任意模块回到 launcher 后，继续 Esc 走同一 launcher 阶梯，最终隐藏 Qx；不要要求用户先点进搜索框。
- 有搜索文字时底栏 Esc 清空；无文字时同一 Esc 动作隐藏 Launcher。可见动作与键盘行为必须一致，不得渲染无 `onClick` 的禁用式 Esc 占位。
- 空闲 Home Island 由 `resolveHomeIsland` 解析；搜索中 / 有结果 / 插件 status 优先占用 shell island。

Clipboard：

- 左侧历史列表，右侧预览和信息。
- 列表、预览、信息区独立滚动。
- 置顶、复制、删除等动作走 Bottom Bar / Actions。
- HTTP(S) 链接条目的 Actions 提供“URL 浏览器解码”：按浏览器 `decodeURIComponent`
  语义解开一层百分号编码并复制结果。整条被编码的 URL 仍归入链接筛选；非法转义保持
  原样且不得阻断其他有效片段。显式解码写入必须取消延迟恢复，避免窗口隐藏时被原条目覆盖。
- 剪贴板浏览态的“粘贴到 {前台应用} ↵”使用 Bottom Bar 主动作，固定在“操作
  Cmd/Ctrl+K”左侧；文本编辑且有改动时，Bottom Island 并列“保存 / 另存为新条目”。
  Island 动作组以短 enter 动画出现；保存成功后由宿主 effect 在岛边缘快速绕行
  一圈，不得用延迟业务完成或伪造 progress 来表现反馈。
- 单击左侧条目必须把该条目写入系统剪贴板，供用户随后手动粘贴；不得在单击时自动向前台应用发送粘贴键。
- 文件剪贴板必须按一个有序 file-list 条目保存和展示：单个文件、文件夹、多选文件、
  Windows UNC / 重定向路径均保留原生路径语义；捕获时不得因暂时不可访问而丢弃，
  用户执行复制/粘贴时再逐项校验。多选条目显示首项名称与总数量，并整体写回系统剪贴板。
- 文本条目支持双击列表行或右侧预览进入编辑。编辑始终先进入本地草稿，默认不落库；草稿变化后灵动岛显示红色未保存提醒，并提供“保存”和“另存为新条目”。切换条目、按 Esc 退出编辑或离开模块时，未明确保存的修改直接丢弃。
- 左侧日期分组标题是可点击的日期筛选入口；Popover 使用 Geist Calendar，支持本地时区下的单日或包含首尾日期的范围选择、月份与键盘导航，以及今天、最近 7 天、最近 30 天和全部日期预设。触发器在选择后保持显示已提交范围。
- Esc → launcher；列表行不预留顶栏返回缩进。

RSS：

- 阅读器可使用三栏：Feed / Article List / Detail。
- P仔是阅读上下文助手，不复制 RSS 的 Feed / Article / Detail 主布局。文章打开后从统一
  `QxShellAction[]` 提供“问 P仔”；触发后在右侧 Context 内显示一张紧凑悬浮会话面板，
  Esc 先关闭助手再退出正文。助手默认注入当前完整正文，并可通过 RSS Agent tools 查询
  当前内容库的其它/全部文章；摘要写入 summary，翻译与改写写入可编辑 draft，不覆盖
  不可变的 RSS 源正文。每个助手会话使用 QxAI session store，关闭面板后仍出现在 QxAI 历史中。
  P仔不再注册独立 Launcher Panel 或 Module Search 项，设置中的模块开关只控制该助手能力。
- 右侧 Context 是 RSS 唯一的完整 Action 面：Feed 视图按“订阅 / 内容库”分组；文章视图按
  “文章 / 刷新 / 导航”分组。文章组提供阅读、保存、已读状态、下载 HTML、在浏览器中打开与
  正文加载；同一动作不得再复制到右侧手写按钮、正文 footer 或 Bottom Bar Actions 菜单。
- RSS 不注册 `F/J/K/R/S/U/O/L` 等裸键快捷方式。Enter 遵循阅读层级：订阅列表进入所选订阅，
  文章列表打开所选文章，正文中返回文章列表并恢复列表焦点；`⌘/Ctrl+R` 刷新当前订阅，
  `⌘/Ctrl+D` 保存/取消保存文章，`⌘/Ctrl+S` 下载当前文章 HTML，`⌘/Ctrl+Shift+R` 全部刷新。
  上下方向键继续移动当前列表选择，Esc 阶梯不变。
- “刷新订阅”只刷新当前 Feed；“刷新全部”必须读取数据库中的完整订阅集合逐个执行真实 HTTP 请求，不能只处理当前列表选中项。
- Feed 列表副标题的相对时间显示该订阅已保存文章中最新的有效 `published_at`；文章未提供发表时间时才回退到订阅抓取/创建时间。批量刷新时间不得替代文章发表时间，导致所有订阅显示同一时间。
- Settings → RSS Reader → Library & Storage 默认开启“每日后台刷新”，可选择每 6 / 12 / 24
  小时或关闭。Qx 运行时按最近一次全量刷新时间与所选周期执行；手动“全部刷新”重新计时。后台任务不得要求面板挂载、
  召唤或聚焦窗口，也不得与手动/单 Feed 刷新并发。
- 刷新灵动岛不得使用计时器或固定百分比模拟网络进度。单个 Feed 请求中显示 activity；刷新全部时按 `已完成订阅数 / 全部订阅数` 计算确定进度，并显示当前 Feed 与失败数。解析、图标解析和数据库提交完成后，该 Feed 才计入 completed。
- Feed 图标必须优先读取 Qx 持久化的小尺寸本地缓存；远程 icon/favicon 只用于首次填充或低频过期刷新，打开阅读器不得为每个订阅重复下载图标。缓存图标保持适合列表显示的尺寸并保留字母占位降级。
- 正文与封面图片按平台加载：macOS 交给 WebView 直接加载原始 HTTP(S) 地址，不得先替换成透明占位等待 Rust 回填；Windows 使用 Rust 磁盘缓存并对相邻文章做有界预热和解码。任一平台加载失败都不得永久保留一块不可见图片占位。
- Article List / Detail 使用 `useQxListSelection` + `useQxMasterDetail` 标准端口；左侧文章列表不得另造键盘导航或选中状态。
- 三栏宽度可以拖拽调整，宽度写入本地状态或设置。
- 每栏必须有最小宽度，拖拽时不得产生横向页面滚动。
- 详情阅读可隐藏 Context Panel 或使用 overlay bottom bar。
- Esc 级联：详情 → 文章列表 → Feed 列表 → launcher。

V2EX / Weather / DevTxt / Screen Capture / Macro / Plugin Host：

- 统一 `escapeAction={{ label: "Back", kbd: "Esc", onClick: stepBack }}`（或 `useQxModuleShell` 的 `shell.escapeAction`）。
- 录制类模块：Esc 可先停止录制或丢弃草稿 / 清预览，再在下一层离开；不要静默无出口。
- Screen Capture 无真实搜索框时焦点常落在 body：必须依赖 host Esc 兜底 leave → hide，不能只靠 Shell 内 keydown。

Screenshot & Recording Module（截图录屏模块）：

- 截图与录屏共用一个模块、历史列表和显示器选择协议；截图保存 PNG，录屏保存 MP4/MOV 并可按需转 GIF。
- 显示器枚举、稳定 ID、内置/外接/主屏判断、鼠标所在屏幕和跨后端映射属于 Qx 系统级能力；截图、窗口管理、浮窗与热插拔监听必须消费同一服务，不得在模块内各自判断。圈选打开时先立即检测一次，随后以约 40ms 间隔检测鼠标所在显示器并随跨屏移动；一旦开始框选、已有选区或进入确认流程就停止跟随，避免编辑状态被迁移。圈选层同时为每个显示器创建轻量、鼠标穿透的黑色半透明遮罩，只有鼠标所在显示器保留交互层。
- Qx 首次启动后的第一次唤起也必须出现在鼠标所在显示器与当前 macOS Space；不得沿用隐藏窗口创建时的主屏、DPI 或桌面归属，后续唤起遵循同一规则。
- 点击截图/录屏入口或对应快捷键后直接进入拖拽圈选，不显示圈选前模式条；窗口捕获和 OCR 后端能力继续保留但不进入圈选控制栏。跨屏时由鼠标所在显示器自动决定目标，其他显示器使用不抢焦点的浅黑遮罩；捕获目标必须携带显示器 ID，不得把外接屏圈选错误映射回主屏。
- 入口意图（截图 / 录制）决定确认条主按钮高亮与 Enter 默认动作；仍可在确认前切换。模块主界面只保留双入口（截图 / 录制），不再提供绕过圈选的「直接开始主屏全屏录制」歧义路径。
- 录屏圈选确认方式可配置：**精修后捕获**（默认：松手只建选区，可移动、四角+四边缩放后再确认）或 **松手即捕获**（按意图开始录制；按住 Alt/Option 强制进入精修）。截图始终停留在可编辑选区，允许移动、四角+四边缩放和涂鸦；截图复制始终需要显式按下 `⌘C` / `Ctrl+C`，不会因拖动时的修饰键自动触发。截图模块列表与预览状态的底部主按钮均显示“截图/录制”，点击后直接进入圈选。
- 选区建立后显示双态工具条，第一个图标在截图 / 录屏之间切换，每个图标必须提供本地化 Tooltip（用途、快捷键或禁用原因）。截图态依次提供区域、全屏、矩形、箭头、画笔、文字、序号、马赛克、撤销/重做、颜色、选项、✓ 确认和 × 取消；录屏态提供区域录制、全屏录制、固定马赛克遮挡、选项、✓ 确认和 × 取消。区域与全屏按钮必须可往返并恢复最近区域选区；截图已有标注时切到录屏必须确认并清空标注及撤销栈；录屏马赛克按相对选区坐标逐帧覆盖，其他标注只进入 PNG。
- 工具条视觉按参考控制栏统一为浅色不透明横条、深色线性几何图标和竖向分隔线；马赛克图标是一个四等分正方形，右上与左下填实。选项弹层使用 macOS 菜单式纵向分组：灰色分组标题、单行选项、左侧勾选与分隔线，不使用胶囊按钮、开关矩阵或横向选项组。
- 工具条以实际测量宽高定位：默认位于选区下方，空间不足翻到上方；全屏状态固定悬浮在当前显示器底部内侧并向上展开，其他上下均不足的情况嵌入显示器内侧；水平位置始终夹紧在当前 picker 显示器内容区内。工具条和录制控制窗都启用内容保护，不得进入成品。
- 键盘：Enter 确认；双击选区不得直接截图或录屏；**⌘C / Ctrl+C 立即截图并复制到剪贴板，跳过延迟并隐藏圈选层与 Qx 主界面**（标注文本框内保留原生复制）、Space 全屏、S/V 切换截图/录屏、R 上次选区、Tab 区域/全屏、1–6 工具、⌘Z/⇧⌘Z 撤销重做、Esc 分层退出。上次成功选区仅在“记住上次选区”开启时作为默认精修起点。
- 延迟新设置为 0/5/10 秒；读取旧版 3 秒值时按 5 秒展示并保持兼容。倒计时期间圈选窗穿透桌面输入，Esc 取消倒计时。
- 截图和录屏成品始终先写入 Qx 图库，再异步导出到桌面、文稿、自选目录或剪贴板；导出或完成后打开失败不得回滚图库文件。截图内部保存成功后按设置播放一次 Qx 内置快门音，外部导出失败仍播放；失败截图、录屏开始/结束和关闭提示音时不播放。
- 捕获选项还包括浮动缩略图、截图/录屏指针、录屏点击效果和麦克风设备。录屏麦克风由随包 FFmpeg sidecar 采集 AAC 并在停止时合并；设备拔出、权限拒绝或合并失败时保留无声视频并显示局部警告。输入事件由共享服务供录屏点击效果和宏录制共同消费。
- “开始截图”和“开始录制”是两个独立 Launcher command，也是默认关闭、可录入的全局快捷动作。
- 截图完成后的默认动作可配置为“自动复制到剪贴板”或“仅保存”；复制失败不得删除已经保存并写入历史的 PNG。模块内展示轻量 post-capture toast（打开 / 复制 / 显示），宿主 Bottom Island 同时提供短时“复制”动作；复制成功后在原岛显示完成反馈。
- 桌面贴图由 Rust 在显示前按目标显示器工作区缩放并定位；前端必须继承同一初始缩放比，图片首帧加载不得再次改变原生窗口几何。首次按下拖动时，鼠标在图片内的相对落点必须保持不变，不得跳到窗口中心或角落。
- Windows 远程桌面会话不得继续使用可能“成功返回黑帧”的 WGC still-frame 路径，应直接走 GDI 兼容捕获；实体机会话继续优先使用 WGC。WGC 返回近全黑空帧时同样回退 GDI。透明 WebView2 圈选层挂载后必须通过 ready 握手重放 session 并重新置前/聚焦，避免远程环境中窗口已创建但选择器不可见或不接收输入。
- 捕获历史支持 **列表 / 图库** 两种持久化视图：未打开条目时集合占满 Main Area；选择条目后，两种视图都切换为标准 Workbench 主从布局，左侧保留当前 List / Gallery 集合，右侧显示捕获详情。两种视图必须共享选择、预览、删除、Shell 键盘导航和 Actions，不得维护两份历史状态。
- 捕获历史默认使用 Gallery：浏览态让缩略图网格占满 Main Area，打开卡片后保留左侧 Gallery 并在右侧显示详情，Esc 只关闭详情并返回全宽 Gallery；List 仍作为用户主动选择的紧凑模式保留，并遵循同一主从切换。
- 静态截图详情在图片和元数据下方提供系统 OCR 入口；识别文字显示在可滚动文本框内，双击进入编辑。编辑态的撤销、重做和保存固定在框内右下角，保存结果按截图路径保留；录屏与 GIF 详情不显示该区域。
- 底部捕获灵动岛始终保持普通状态，显示“开始截图/录屏”和“设置”；不在岛内切换为权限提示或显示“获取权限”，权限错误由实际捕获流程反馈。
- “显示/隐藏捕获灵动岛”是第三个默认关闭、可录入的全局快捷动作，只切换捕获工具栏，不改变主窗口当前 route。
- 用户可开启 340×36 常驻捕获灵动岛；空闲时提供截图/录制入口，录制中切换为时长、帧数和停止控制，控制窗始终启用内容保护。
- 录制中控制岛显示真实已编码帧数与按 `frame_count / elapsed` 计算的实测 fps；历史 Gallery/List 的视频元数据保留最终实测 fps，不能把目标设置值冒充实际采集帧率。
- 每个新视频由录制 worker 从首个已编码帧保留一张小尺寸 PNG 封面，结束后以持久
  sidecar 路径写入历史；Gallery、List 和预览优先使用该封面。不得依赖
  `<video preload="metadata">` 自动绘制首帧；旧历史无 sidecar 时才以加载视频并
  seek 到非零时间作兼容回退。删除历史视频必须同时清理封面。
- 空闲捕获岛的关闭 / 取消常驻必须同步回主设置并持久化；后台状态轮询、主窗重开或应用重启不得用旧的 `controls_pinned=true` 将其复活。录制进行中仍可临时显示控制岛，结束后按最新常驻设置恢复。
- 空闲捕获岛提供截图、录制、捕获历史和关闭入口；历史入口打开 Screen Capture 模块，并恢复用户上次选择的列表或图库布局；历史项以缩略图或图标区分截图与视频。
- 区域录制开始后，受保护的选区边框必须保持可见并切换为鼠标穿透，录制灵动岛贴近选区下方；停止后恢复同一选区的拖动/缩放和再次截图/录制能力。全屏录制的控制岛固定在所选显示器工作区底部。
- 录制边框只能使用缩小到选区尺寸的轻量窗口，禁止保留覆盖整块显示器的透明 WebView；鼠标穿透设置失败时宁可隐藏装饰边框，也不得阻塞桌面输入。截图完成后立即关闭圈选窗口，并恢复常驻捕获岛或原模块界面。

QxAI：

- **对话工作台**结构（AI Elements）与视觉（Beautiful UI）的单一标杆见 [`UI_SPEC_AI.md`](./UI_SPEC_AI.md)
  （对齐 Jan ChatInput / MessageItem / QueuedMessageChip）。壳层规则仍以本文为准。
- Workbench（左会话列表 + 右自绘聊天）为默认入口；打开恢复上次会话。Settings 为嵌套页。
- Esc：Workbench 清搜索/输入 → **Launcher**；Settings → Workbench（`setView("chat")`）。
  不再使用「Chat → 独立列表页」二级跳转。
- 每次模型请求都必须在系统上下文中注入当前真实宿主平台。Windows 不得向模型声明使用
  Spotlight、`mdfind`、Finder 或 AppleScript；`files` / `apps` 统一描述为 Qx 跨平台宿主能力。
- QxAI 的 `files` 必须复用 Launcher 的完整原生文件名搜索端口：未指定渐进 `pass` 时由后端
  合并 quick / expanded / system 三轮并去重。`grep` 仅用于明确目录下的文件内容搜索，必须
  提供 `root`，不得在文件名搜索无结果后扫描 Qx、编辑器或当前进程目录；`apps` 只查应用。
- Agent、工具总开关、各内置工具组与 Bash 在新安装及一次性旧设置迁移后默认开启，用户仍可
  逐项关闭。Qx 宿主动作统一提供打开路径、在 Finder/Explorer 定位、原生文件/文本剪贴板和
  文件附件；“发送文件”必须渲染带打开、定位、复制动作的真实文件卡片，不能只输出路径文字。
- Chat 请求进行中使用 Bottom Island 的不确定 `dots` activity，不得伪造固定百分比；回复完成、
  失败或取消后必须清除 activity / progress meter，静态岛只显示会话消息数或错误状态。
- Agent 的思考、工具调用和观察结果是只追加的时间序列：每轮思考必须在该轮工具调用之前占据
  固定步骤，后续轮次不得把已有思考移到工具结果下方；流式更新只修改原步骤内容和状态。
- Chat 生成期间输入框保持可编辑；再次发送进入会话内可见队列，按提交顺序串行执行。队列
  交互对齐 Jan：chip 点击文案回填输入并离队，可删除；使用 Lucide 图标，不用 emoji 或伪造进度。
- Token 速率对齐 Jan：按生成正文与活跃流式时长计量；**仅完成后**在消息脚注显示
  `N tokens/sec (M tokens)`；流式消息脚注不刷 TPS。
- Composer 为底部文档流 dock（非 absolute 遮挡消息）；Context 工具列表一行摘要 + 悬浮展开。
- Qx 管理 `~/.qx/skills`：支持 `<skill-id>/SKILL.md` 与根目录单文件 `<skill-id>.md`。输入 `/`
  打开 Skill 模糊搜索，ArrowUp / ArrowDown 移动、Enter 选择、Esc 关闭；选中的 Skill 只注入
  下一条用户请求，发送后自动清除。Skill 文件扫描和读取必须在异步阻塞边界执行。

### Documents（文本工具箱 · 简易 Notepad++）

- 定位：不想开 VS Code 时的 **快速文本便签/草稿编辑**（加一行、改一行）。
- 布局：**左侧文本文件列表 + 右侧编辑区**；Context 为文件信息、语言与操作。
- 语言（SQL / Java / JSON…）通过 Context 芯片或 Actions 设置，存在每个文件元数据里（`language`）。
- 文件列表本地持久化（`localStorage`）；Esc：重命名 → 清空搜索 → launcher。

Settings：

- Extensions → Installed 的每个模块行在尾部直接显示启停 Toggle，并保留 Lucide 详情按钮；
  内置模块与外部插件使用同一交互。关闭内置模块后，Launcher、快捷入口、模块搜索和对应后台
  worker 必须共同遵循 `builtin_modules`，不能只把入口隐藏。

- 使用 `visual="elevated"`。
- Esc / Close → 关闭设置面板。
- Appearance 的应用图标选择保留原版与云月两个内置选项；切换只影响应用/窗口图标，菜单栏与系统托盘图标始终保持独立。
- 托盘菜单配置归入 Settings → General。列表本身就是可见内容：加入即显示、移除即隐藏，拖动决定顺序，不再提供重复的可见性开关或托盘专用快捷键。“添加项目”统一搜索内置托盘操作、已注册模块与插件命令；模块点击后走 Qx 导航目标，命令点击后走插件命令端口。模块与插件命令的全局快捷键仍在对应模块/插件详情中配置。插件只能贡献原生 action/status 行与可选子菜单分组；不得把 Web CSS、颜色或自绘控件带入 macOS / Windows 系统菜单。
- 菜单栏 / 系统托盘图标按平台使用不同呈现：macOS 使用 template 图标让系统自动
  着色；Windows 使用有前景/背景层次的彩色非 template 图标，确保浅色和深色任务栏
  都可辨认。不得把 macOS 单色 template 标志直接当作 Windows tray 图标。
- 面板结构、设计令牌、**线性分区**（`SettingsCard` 实为 section + hairline `Row`，非营销大卡片）、响应式与新增页步骤见 [docs/settings-panel.md](docs/settings-panel.md)。

### Settings · Extensions / 已安装模块（成熟小卡片）

实现：`src/modules/settings/plugins/`（`PluginManager` → Installed / Plugin Store）。视觉在 `settings-actions.css` 的 `.qx-plugin-module-card*`。

Plugin Store 工具栏保持单行：市场搜索为主列，仓库筛选与“仓库源”弹窗入口紧邻搜索框右侧，
刷新位于尾部；不得把仓库源单独换成第二行。窄宽度优先压缩筛选宽度并把仓库源入口
图标化，Top/toolbar 高度不变。

Plugin Store 详情必须展示插件库提供的版本说明与历史版本（最新在前）。当
`min_app_version` 高于当前 Qx 时，列表显示紧凑的“需要 Qx x”警告徽章，详情说明
不兼容原因并提供前往 About 升级的入口；安装、升级、重装和其他来源库按钮全部禁用。
后端安装命令必须再次校验最低版本，不能只依赖前端按钮状态。

插件管理 Badge 只使用五种稳定语义：`neutral`（版本、作者、来源、权限）、
`accent`（有更新、当前版本、内置）、`success`（已安装、已启用、兼容）、
`warning`（最低版本不满足、部分兼容）、`danger`（加载/来源失败、不支持）。
同一状态在列表、详情和来源状态中颜色必须一致；不按插件品牌随机分配颜色。

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
- Settings 右侧导航使用连续的原生列表行层级，不得继承通用按钮的悬浮阴影或毛玻璃；主题切换后背景、边框与选中态必须立即使用当前主题变量。扩展详情中的卸载操作保持为右对齐的紧凑危险按钮，不得拉伸为整行底栏。
- Settings → System → Storage Management 只展示按模块登记的可重建存储，使用紧凑表格行对齐模块、大小、项目数和清理操作。不得再把同一目录按 Cache / Files / Databases 等物理桶重复展示；“清理全部缓存”只能遍历宿主注册的可重建目标，不得删除设置、数据库、剪贴板历史、已保存截图/录屏或插件持久数据。
- Storage 统计和清理必须使用同一后端缓存目标注册表，覆盖应用/RSS 图标、剪贴板派生预览、V2EX、天气、插件市场归档、更新包、OCR、文件搜索索引和录屏临时目录。清理端口拒绝未知 target、存储根目录和符号链接目录穿透；插件 `plugin-data` 独立统计为持久数据，不得伪装成 Cache。

**Tabs：**

- Installed / Browse 用 `Tabs`（不是顶栏 `SegmentedControl` 代替主切换）
- 首行保持单层紧凑工具条：Tabs 在左；Raycast Actions 开关、Import、Rescan 在右；窄宽度可换行但不得扩成说明卡片。已安装插件列表使用内存缓存，禁止定时扫描插件目录；Rescan 是用户触发完整异步扫描的唯一常规入口。执行插件命令或打开面板时若注册项缺失，宿主可通过统一注册表解析端口异步补刷一次并重试，不得在渲染或输入线程同步遍历插件文件。
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

Settings → System → Storage Management 同时展示宿主静态缓存和插件 manifest
登记的可重建缓存。插件目标显示插件名、target 文案、精确占用和 records 数量；清理
按钮只删除声明的 persist keys / key prefixes 匹配项。未登记的 Plugin Data 不进入 Cache 总量，也不能被
“Clear All Caches”删除。

社区评论命中缓存后立即显示，TTL 到期刷新时保留旧评论；indeterminate 评论加载只投影到
Bottom Island，不在 `detail.replies.status` 重复显示 loading。刷新失败保留缓存并在评论区
显示局部错误，不替换列表或清空已加载评论。

Workbench 与内置阅读模块的图片统一进入共享 `QxMediaViewer`；社区详情的多图动态使用宿主 `detail.images` 胶片/网格和全尺寸预览；
插件不得自绘轮播。详情回复统一使用底部 `detail.replies` → `QxReplyList`，每行按
`#楼号 / 作者 / 回复对象 / 可选点赞数 / 楼主标记 / 时间 / 正文` 排列，点赞数紧跟作者右侧且不重复出现在正文；`parentId / depth / replyToAuthor` 是统一回复树端口，宿主按父级稳定排序、最多显示 8 层缩进并提供分支折叠，自引用、循环或缺失父项安全降级；内置 V2EX 与插件 Workbench 共用同一
组件和样式，插件不得自绘评论树。回复中的包内行内图片按约 1.45em 紧凑显示、随文字基线对齐，不进入全尺寸媒体预览；资源不可用时保留可读替代文本。全尺寸预览的左右边缘提供固定感应区：鼠标接近对应边缘或键盘聚焦时才
显示切换按钮，按下时不得位移；无 hover 设备保持按钮可见。预览舞台内无修饰键滚轮
直接缩放并阻止背景滚动，缩放尺寸必须使用 WebView 支持的标准 CSS 百分比，放大后
保持完整二维滚动范围。缩放控制与比例固定在右下角，图片序号放在左下角，二者不得遮挡。

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
- 打开 macOS 系统设置、权限页或文件选择器等 OS-owned surface 时，Qx 主面板保持可见但临时降为普通窗口层级，
  不得强制压在系统窗口上；外部 surface 关闭后，用户点击回 Qx，主面板恢复浮窗层级且不得因失焦自动隐藏。

**B. 可见按钮 · `escapeAction`**

- 最右侧 Esc 按钮的 `onClick` 等于当前级联的**最终一级**（与 `launcher` / 上一级 `goBack` 相同）。
- 级联的中间层（关详情、清搜索）只由键盘 `useEscBack` 处理；不要把中间层绑到最右侧按钮，以免单击 Esc 胶囊跳过中间层语义混乱。若模块需要「按钮也关闭详情」，应把当前视图的返回目标设为「关详情后的父级」，而不是跳过父级直接 launcher。

**C. Shell 兜底**

- 模块 `onKeyDown` 未消费的 `Escape`，由 `QxShell` 调用可见 `escapeAction.onClick`。
- 因此 `escapeAction.onClick` 不得省略；省略时最右侧可能只显示不可用的 Esc 外观。

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

**列表加载态**以 V2EX 为规范样例，统一用 `QxListLoading`（`src/components/QxListLoading.tsx`）：

| 条件 | UI |
|---|---|
| `loading && count === 0` | 骨架行（icon + 双行文案 + 可选 meta）+ 下方 `LoadingLabel` |
| `loading && count > 0` | **保留旧列表**（不闪白）；Island / 计数可显示 Searching / `...` |
| `!loading && count === 0` | `qx-empty-state` 文案，不用骨架 |

禁止在空列表时只转圈、或刷新时清空已有行再画骨架。

**模块搜索框**统一用 `QxModuleSearch`（`src/components/QxModuleSearch.tsx`）：

```tsx
search={
  <QxModuleSearch
    value={query}
    autoFocus
    onChange={setQuery}
    placeholder={t("…", "…")}
  />
}
```

- 结构固定：`.qx-search-wrap` + `.qx-search-icon` + `.qx-plugin-search`（样式在 `toolbar.css`）。
- `autoFocus` 是显式的一次性意图；省略时默认 `false`，且后续 pointer 操作不会触发重聚焦。
- 业务逻辑（改选中、拉数据）留在父组件 `onChange`；不要再手写三层 div/input。
- Launcher 主搜索仍用 `SearchBar`（召唤聚焦 / store），但其内部已复用 `QxModuleSearch` 同一套 chrome。
- 顶栏若只是标题（Weather / Macro），不要硬塞假搜索框。

**左列表 + 中间内容（master–detail）** 统一用 `useQxMasterDetail`（`src/hooks/useQxMasterDetail.ts`）：

| 区域 | id 约定 | 焦点内按键 |
|------|---------|------------|
| 列表 | `{module}-list` | ↑↓ / Page / Home / End → 选中（`navigation.regionId`） |
| 内容 | `{module}-detail` | ↑↓ / Page / Space → **滚动正文**（`data-qx-region-scroll`） |
| 动作 | `{module}-actions` | 可选；←→ 与列表/内容切换 |

交互约定：

1. **← / →** 在可见 region 间移动焦点（Shell 已实现）。
2. 列表上 **Enter** / `navigation.onOpen` 打开内容并 `focusDetail`。
3. 内容为空时 `aria-hidden="true"`，←→ 跳过该 region。
4. 打开后把 `data-qx-region-initial` 切到 detail；关闭后回到 list。
5. 列表选中外观继续用 `useQxListSelection`；**禁止**在内容区仍用 ↑↓ 切列表。
6. 主内容宽度降到单栏断点（当前 `760px`）后，master–detail 不再压缩成破碎双栏：
   未打开详情时只显示列表；点击条目、Enter 或 `navigation.onOpen` 后只显示详情；
   Esc / `navigation.onClose` 只退回列表，不直接离开模块。Clipboard、RSS、Documents、
   V2EX、Screen Capture 与 Workbench 都复用 `.qx-content-split` /
   `.qx-content-list` / `.qx-content-detail` / `.has-detail`，不得各自硬隐藏详情。

左右内容分区如果需要调整宽度，统一使用 `QxResizableSplit`（`src/components/QxResizableSplit.tsx`）：
传入两个直接子节点（左列表、右详情），由宿主统一提供 8px 拖拽手柄、`col-resize` 指针、
键盘 ←/→ 微调、Home/End 到边界、双击恢复默认值、`role="separator"` 无障碍语义和可选
`localStorage` 持久化；截图/录屏 toast 等浮层通过 `overlay` 传入，不参与分区计算。模块只负责
`className`、最小宽度、响应式单栏规则和分区内容；不得再
复制 pointermove、body cursor/user-select、键盘微调或宽度持久化逻辑。跨模块的 Shell Context
由 `QxContextSplit` 独立控制，不得用 `QxResizableSplit` 或模块样式覆盖。

参考：`V2exPanel`、`ArticleList`（RSS）、`DevTxtTool`。

**模块壳 chrome** 统一用 `useQxModuleShell`（`src/hooks/useQxModuleShell.ts`）：

| 输出 | 用途 |
|------|------|
| `escapeAction` | 最右侧 Esc（`label/kbd: Esc`，`onClick: leave`） |
| `onKeyDown` | Esc 级联 + 模块附加键 |
| `island` | 来自 `island` 或 `islandState`（loading → error → idle） |
| `actions` / `primaryActionId` | 右下主动作与 Actions 菜单；Shell 拥有菜单触发器 |

内置与 **扩展 PluginHost** 共用。纯函数 `buildModuleIsland` / `qxEscapeAction` 可供非 React 适配层调用。  
`QxShell.islandKey` 必须是稳定、非本地化的 route identity，禁止从可见标题推导。普通 `island` prop 只由 shim 写入 session store，底栏只由 `QxIslandDockSlot` 读取并渲染 winner；模块不得同时直接渲染 props 和写 store。`customIsland` 仅保留无法表达为标准岛内容的分类例外，并抑制普通 docked winner；录屏 HUD 已迁移到捕获专用受保护工具栏，不得再使用该入口。
内置模块与 custom panel 仍自管 `actions` / `primaryActionId` / `navigation` / 内容区；声明式插件 Workbench 只发布纯数据，由 PluginHost 按同一 QxShell 契约渲染列表、Gallery、详情、导航和 Actions。List 使用 Raycast 式图标 / 两行文字 / trailing accessory 三轨布局，选中态为带内边距的圆角整行高亮；标题与副标题只能在文字轨内省略，badge / meta 不得覆盖正文。Gallery 使用宿主网格、图片懒加载、同一选中/滚动协议与 item Actions，不允许插件复制自绘图库 chrome。Workbench 的 Context Panel 只呈现动作，不复制详情。
第三方插件作者的最小布局、明暗对比度、Custom Panel token 与 Action 层级规范见
[`public/doc/plugin-ui-guidelines.md`](public/doc/plugin-ui-guidelines.md)。插件 iframe 必须由
宿主同步 resolved Light/Dark、`.dark` 与公开语义 token；Custom Panel 不得依赖只适合
单一主题的硬编码 fallback。

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
- 全局召唤分为两个可独立配置的动作：**Launcher Search** 显示 Qx、进入 Launcher 并聚焦搜索，再按一次隐藏；**Toggle Current Window** 只切换窗口显隐，再次显示时必须保留原模块、route 和子界面。后者默认开启：macOS 为 `Option+Space`，Windows 为 `Ctrl+Alt+Space`（避开系统窗口菜单及 PowerToys Run 常用的 `Alt+Space`）；Launcher Search 对应 Shift 组合默认关闭。
- **禁止**把 host 的 Space 组合（macOS `Option+Space`、Windows `Ctrl+Alt+Space`）或系统级 `Cmd/Meta+Space` 绑成模块 Action；Shell 匹配层必须放行这些宿主级组合键，不得 `preventDefault`。Windows 全局快捷键设置允许 `Ctrl+Space`，它不属于 Windows 系统保留组合。
- 剪贴板等模块的删除应使用 `Cmd/Ctrl+Backspace`（或 `Delete` 等价），不得使用 Space 系全局键。
- 多栏编辑模块应给列表、编辑器、动作面板设置稳定 `data-qx-region`；列表的
  `navigation.regionId` 指向列表区域。编辑器获得焦点后，方向键、PageUp/PageDown、
  Home/End 和带 Shift 的选区移动不得触发列表选择或区域滚动。

## Responsive

- 宽屏可以使用两栏或三栏。
- Home Dashboard 使用 Main Area 容器宽度而非窗口物理宽度断点：宽时为置顶应用 + 指标列，
  中等宽度时指标改为双列，窄时改为单列。卡片字号和控件尺寸不做连续缩放；Main Area
  高度不足时独立纵向滚动。普通点击态只改变语义背景/边框，不做 translate、scale 或抖动反馈。
- `max-width: 860px` 时通用 QxShell 隐藏 Context Panel；模块若需要保留详情，必须提供进入详情页、Dialog 或 Drawer 的明确入口，不使用未实现的“自动下移”假设。
- `max-width: 760px` 时主从内容切换为单页模式：列表与详情任一时刻只显示一个，
  详情页必须保留底部 Esc 返回，并保持当前选择、列表滚动与详情阅读位置。
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
- **快捷键与键盘符号不翻译**：`kbd`、`formatQxShortcut`、Shell 最右侧 Esc 胶囊、Actions 菜单里的 `⌘` / `Ctrl` / `Esc` / `↵` 等保持平台原样。只翻译动作名称（如 “复制”“关闭”），不翻译按键本身。
- 最右侧 `escapeAction` 显示 **Back/返回** 或 **Hide/隐藏** + `kbd: "Esc"`；文案走 i18n（`common.back` / `shell.hide`）。
- 日期、时间、数字、百分比和文件大小使用 **resolved locale** 的 `Intl` formatter（`useLocale()`），不在组件内硬编码 `"zh-CN"` 或手写语言相关拼接。
- 布局按中英文长文案验收；固定高度区域单行截断，完整内容用 Tooltip 或详情。

### 实现清单（模块作者）

```tsx
const t = useT();
const locale = useLocale();

// ✅ 文案
t("clipboard.title", "Clipboard History")

// ✅ 快捷键：不走 t()
escapeAction={{ id: "escape", label: "Back", kbd: "Esc", onClick: goBack }}
actions={[{ id: "copy", label: t("common.copy", "Copy"), kbd: "↵", onClick: copy }]}
primaryActionId="copy"

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

- 透明无边框主窗口必须使用平台原生外阴影：macOS 使用 AppKit `NSWindow`，Windows
  使用 Tao undecorated-shadow / DWM。WebView 画布只保留语义 border + inset highlight，
  不得在 WebView 边界内模拟会被裁切的 CSS 外阴影。Windows 10/11 与 RDP 必须实测
  四边阴影、1px 顶边、圆角和透明合成，不得因某一环境回退而全局关闭 native shadow。
- Windows 窗口按 Per-Monitor V2 处理 DPI。显示器 work area 与 resize payload 的物理像素
  必须先按当前 scale factor 转为逻辑像素再用于尺寸持久化；收到 scale change 后应使用
  事件的新比例解释后续 resize。不得叠加 WebView/CSS zoom。紧凑工作区允许响应式收起
  Context Panel，首窗尺寸不得以固定宽高下限占满 1280×720 桌面。
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
- 最右侧 Esc 可见且可点；Top Bar **无**返回箭头（除非显式 `leading`）。
- 键盘 Esc 与点击 Esc 胶囊在同一模块根视图下行为一致。
- 小窗口、默认窗口、宽屏无横向滚动、无文字挤压。

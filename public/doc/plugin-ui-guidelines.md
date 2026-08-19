# Qx 插件 UI、Workbench 与 Actions 规范

这是插件界面协议的唯一权威文档。业务插件发布结构化数据和动作；QxShell 负责固定窗口
结构、控件、主题、焦点与键盘行为。

## 1. 固定窗口结构

所有面板遵循：

```text
Top Bar
├─ 主搜索 / 模块标题
└─ 内容筛选（宿主固定 Select）

Main Area
├─ 列表 / 内容
└─ 可选 Context Panel

Bottom Bar
├─ 可选 Home
├─ Bottom Island
└─ 主动作 + Actions + Esc（Esc 始终最右）
```

- 插件不得自行绘制第二套 Top Bar、筛选 tabs、Bottom Bar 或 Actions 入口。
- Top Bar 右侧只用于内容筛选。发布稳定 `id`、当前值、选项和变更事件，宿主统一绘制
  下拉框；需要在当前面板执行的普通命令声明为 Workbench action。
- Bottom Island 相对整个窗口居中，不相对内容列或 Context Panel 居中。
- Context Panel 是辅助信息和非主业务动作的投影，不是第二个主界面。

插件 Workbench 的 Context 顺序由宿主固定：当前对象标题、非主业务 Actions、可选后台状态，
最后是可选的「关于」。只要 Manifest 提供描述，宿主就在「关于」中依次显示本地化插件名、
作者（存在时）和本地化描述。插件不得通过 Workbench detail、action 或自定义 HTML 再复制
一套 About，也不能改变该区的样式和顺序。

名称和描述来自 Manifest 的 `name` / `description` 原始文本，以及 `names` / `descriptions`
本地化映射。市场插件必须提供 `en` 与 `zh-CN`；宿主按当前语言选择，缺失时仅显示包内
原始文本。旧插件也必须在重新发布前补齐两种语言，宿主不维护按插件 ID 分散的兼容翻译。

`panel.title` 只作为 Shell 标题的英文回退，推荐省略或与 Manifest `name` 相同；插件不能
通过自定义 panel title 绕过 `names` 的本地化。Panel 销毁时必须释放计时器、订阅、请求、
媒体缓存和 Island/Tray 会话。

## 2. 选择 Workbench 模式

| 内容 | 模式 |
|---|---|
| 同构结果、可筛选条目 | List |
| 图片或媒体为主 | Grid |
| 选中项长内容 | List + Detail |
| 参数输入并提交 | Form |
| 只显示说明或结果 | Detail |

优先声明式 Workbench。只有无法表达的遗留界面才使用自定义 HTML；自定义内容仍不得覆盖
Shell chrome。

### Launcher Home 组件

Home 组件不是缩小版 Custom Panel。插件通过 `manifest.homeWidgets[]` 将宿主支持的语义
系统数据源关联到自己的 Panel；如果要让宿主直接绘制 Home 信息卡片，则使用
`manifest.surfaceProviders[]` 的已登记语义源（当前包括 `rss.unread-latest`）。Qx 统一绘制
卡片、读取共享异步采样或 RSS 快照缓存、处理窗口缩放、焦点和主题。插件不得提交 Home
HTML/CSS、像素尺寸、轮询计时器、任意 JSON 或点击位移动画。完整字段见
[`plugin-marketplace.md`](./plugin-marketplace.md)。

列表应保持原生桌面密度：

- 行内图标、正文列、右侧状态标签各有边界。
- 有 `progress` 的行由宿主添加状态类，插件不自行定位轨道。
- 进度位于正文列内部的底部槽，避开图标、标签和下一行。
- 普通行不因其他行有进度而改变高度。
- 选中框完整包住内容和进度槽。

局部异步状态使用同一数据协议，适用于 `item.status` 和 `detail.status`：

```ts
type WorkbenchStatus = {
  state: "loading" | "success" | "error";
  label?: string;
  error?: string;
  progress?: number;   // 已知百分比时传真实 0–100
  completed?: number;  // 批量任务已完成数量
  total?: number;      // 批量任务总量
  failed?: number;     // 其中失败数量
};
```

`progress` 与 `completed / total` 二选一即可；宿主统一计算并绘制进度。未知进度不传
百分比，也不能用定时器模拟。刷新时保留已有条目、图片与字段，状态只占自己的局部槽位。
图片全尺寸预览和详情回复分别发布 `detail.image(s)` 与 `detail.replies`，由宿主共享的
媒体查看器和回复列表呈现，插件不得复制 lightbox、缩放导航或评论 DOM。
回复点赞数使用 `detail.replies.items[].likeCount` 发布，宿主将其显示在作者名右侧；
不得把 `♥ 数量` 拼进回复正文。
正文或回复需要把包内小图与文字原位混排时，可同时发布纯文本 `body` 回退和有序
`content[]`。Workbench 对正文与回复使用同一个行内内容协议：文本使用
`{ type: "text", text }`，远程行内图片使用 `{ type: "image", image }`，包内表情/贴纸使用
`{ type: "asset-image", assetPath, alt }`。`assetPath` 必须是插件根目录内的相对路径，
由宿主统一解析；行内图片采用紧凑正文尺寸，不进入媒体预览，缺失时显示 `alt`/正文回退。

### 2.1 增量更新与宿主缓存

Workbench 默认启用宿主管理的 stale-while-revalidate 快照。打开插件时，Qx 先显示上次成功
且仍在有效期内的归一化呈现数据，再启动当前 panel；loading 或失败快照只更新状态，不得清空
旧 items/detail。成功的空集合仍是权威结果，会替换旧缓存。需要多个逻辑视图或禁止持久化时：

```ts
cache: {
  key: "latest", // 稳定、非本地化；默认 default
  mode: "stale-while-revalidate", // 敏感/临时面板可用 disabled
  maxAgeMs: 86_400_000,
}
```

网络分页、流式批次和局部详情更新使用 controller 的 keyed mutation，不重发整份集合：

```js
const workbench = context.ui.mountWorkbench(initialState, handlers);
workbench.updateItems({
  revision: 12,
  upsert: changedItems,
  removeIds: deletedIds,
  order: orderedIds,
  selectedId,
});
```

`upsert` 按稳定 `item.id` 浅合并并保留未提供的 detail；`removeIds` 随后删除；`order` 中未列出的
条目按原相对顺序留在末尾。`revision` 可选，但异步并发时应单调递增，旧批次会被宿主忽略。
宿主快照只缓存 Workbench 呈现数据；API 游标、原始响应和可继续分页的领域数据仍由插件存储。

### 2.2 数据图表

需要趋势、时间序列或指标曲线时，插件应发布结构化 `detail.chart`，由宿主使用 Qx 的
shadcn/Radix 语义 token 绘制；不要把自绘 SVG、Canvas、data URI 或硬编码颜色塞进
`detail.images`。当前端口支持折线图：

```js
detail: {
  chart: {
    type: "line",
    title: "Real sampled history",
    subtitle: "07/31 10:00 – 08/01 10:00",
    unit: "CNY / gram",
    valueLabel: "Latest",
    value: "881.88",
    points: [
      { label: "07/31 10:00", value: 879.2 },
      { label: "08/01 10:00", value: 881.88 },
    ],
  },
}
```

`points` 必须来自真实数据源或插件持久化的真实采样；不得用随机值、插值点或定时器动画
伪造历史。数据源只提供当前值时，插件必须在详情中说明历史范围和样本数，并在少于两个
样本时隐藏曲线或显示明确的“等待更多样本”状态。插件负责本地化标题、单位、时间标签和
统计文案，宿主负责尺寸、网格线、颜色、暗色/透明主题、无障碍标签以及最多 240 个点的
渲染上限。

## 3. 单一动作协议

每个动作只有一份描述：

```ts
type WorkbenchAction = {
  id: string;          // 稳定、非翻译、同层唯一
  label: string;
  primary?: boolean;  // 同层最多一个
  menuKey?: string;   // Actions 打开时可直接输入的单字母键
  kbd?: string;
  disabled?: boolean;
  tone?: "normal" | "primary" | "danger";
  command?: string;
};
```

宿主以动作 `id` 连接三个入口：

```text
actions[]
   ├─ primary id → Bottom Bar 主按钮
   ├─ primary id → 未修饰 Enter
   └─ 其余动作 → Context Panel
```

因此：

- 不要为 Bottom Bar 再复制一个动作。
- 不要再写一个语义不同的 Enter handler。
- 标签变化、语言切换或列表选择变化不能改变动作身份。
- 禁用的主动作仍可显示，但 Enter 不执行。
- 子菜单在自己的层级中也必须使用唯一 ID。
- 插件不声明“Actions”空动作，也不要把 manifest 启动命令或后台 interval 复制成面板动作。
- 需要用户在当前面板执行的命令必须由 Workbench action 显式引用。
- 每个可见业务动作必须执行真实操作或切换真实状态；状态说明、无回调占位、与宿主导航重复的
  “打开详情”等伪动作不得进入 Actions。
- 每个可见业务动作必须声明 `menuKey`：一个 ASCII 字母，大小写不敏感，且在当前菜单层级
  唯一。用户打开 `Cmd/Ctrl+K` 后可直接输入该字母执行动作。列表态宿主保留 `D` 给
  “打开详情”，详情态保留 `B` 给“返回列表”；插件不得在对应层级复用它们。
- 有集合与 `detail` 的 Workbench 面板，宿主保留 Enter 作为导航主动作：列表中“打开详情”，
  详情中“返回列表”。插件的“打开原网页”等业务动作不得标记为 primary；它们保留在 Context
  并应使用带修饰键的快捷键。

推荐动作顺序：

1. 主动作；
2. 当前选择的直接操作；
3. 导航、刷新和视图操作；
4. 危险操作。

## 4. 快捷键与 Esc

- Enter 执行当前主动作；有详情的 Workbench 列表/阅读态分别为打开详情/返回列表。
- `menuKey` 只在 Actions 菜单打开时生效；`kbd` 是可选的窗口内完整快捷键，两者用途不同。
- 上下方向键移动选择，左右方向键进入/退出详情。
- 快捷键标签由宿主按平台格式化，不硬编码只有 macOS 可读的符号。
- 文本输入保留复制、粘贴、剪切、全选、撤销、IME 和组合输入。
- 插件不得用单字母动作抢占搜索输入。

Esc 永远不是普通动作：

1. 宿主先关岛上最近浏览切换器（插件不实现）；
2. 关闭弹窗、详情、预览等内层；
3. 清空模块查询；
4. 离开模块；
5. 清空启动器查询；
6. 隐藏窗口。

每次只退一层。插件不要绑定 `kbd: "Esc"`，不要注册进程级 Esc，也不要绘制第二个返回键。

## 5. Bottom Island

Island 用于位置、状态和可恢复的短操作，不替代主内容。

### 布局

- 宿主保持 Island 高度和中心位置稳定；加载状态切换不能引发布局跳动。
- 文本、进度与操作按钮必须占用各自槽位，不能相互遮挡。
- 默认进度样式为浅蓝色背景从左向右覆盖整个 Island，前景文字保持可读。
- 插件可选择宿主公开的其他样式，例如内容列短轨道或图标环形进度；插件只传样式 ID，
  不自行绘制定位。
- 240px 紧凑浮岛、桌面浮岛与停靠岛使用同一语义，宿主决定响应式细节。
- 双击 docked 岛展开最近浏览、动作胶囊弹簧进出是宿主 chrome。插件只发布 slots
  （文案、真实 progress、受限 action）；不得注入图标切换器、`framer-motion`、
  窗口坐标或自动浮出。浮窗只由用户从 Qx 底部岛手动弹出。

### 进度

- `progress` 为真实 `0–100`；未知进度使用 indeterminate 状态。
- 0%、1%、99% 和 100% 都要可辨识，100% 必须进入成功或下一终态。
- 进度动画只改变绘制，不改变 Island 外框尺寸或文本布局。
- 长标题、动作按钮和浮出按钮同时存在时，文本可截断，操作不能被覆盖。

## 6. Top Bar 筛选

插件发布筛选模型，宿主绘制固定 Select：

```js
filters: [
  {
    id: "status",
    label: "Status",
    value: "all",
    options: [
      { value: "all", label: "All" },
      { value: "running", label: "Running" },
    ],
  },
]
```

不要用多个自绘按钮模拟筛选。操作型按钮如 Refresh、Import、New 进入 Actions；主搜索始终
保留标准线条搜索样式。

## 7. 主题与控件

- 使用 Qx 语义 token，不硬编码业务颜色作为容器背景。
- 支持浅色、深色和透明主题；低透明度下仍满足正文和次要文字对比。
- 使用宿主控件，不显示原生 `<select>`、range、checkbox 或 radio 外观。
- 动效只表达状态变化，尊重减少动态效果设置。插件不要引入 `framer-motion`；
  岛与菜单动画由宿主统一处理。
- 错误、空状态、加载和局部刷新不得替换仍可安全使用的缓存内容。

## 8. 焦点与响应

- 打开 Actions 后关闭，应恢复原选择和阅读位置。
- Workbench Detail 的正文位置由宿主按 tab/filter 与稳定 `item.id` 隔离保存；新条目从顶部打开，返回旧条目恢复原进度。插件不要保存或回放宿主 DOM 的 `scrollTop`。
- 刷新时保留选择、滚动与搜索焦点。
- Panel render 快速返回；网络、CLI、下载和解析在后台完成。
- 慢的旧请求不能覆盖新的筛选或选择。
- 每个操作立即产生可见反馈，并提供成功、失败、取消的终态。

## 9. UI 检查表

- [ ] Top Bar / Main Area / Bottom Bar 结构唯一。
- [ ] 右上角筛选使用宿主固定下拉框。
- [ ] 动作有稳定唯一 ID，且最多一个主动作。
- [ ] 每个业务动作都是真实操作/状态切换，并有同层唯一的 `menuKey`。
- [ ] Bottom Bar、Enter 与 Context 引用同一动作集合，且 Context 不重复主动作。
- [ ] Esc 只走宿主阶梯。
- [ ] 带进度列表行不遮挡下一行。
- [ ] Island 进度不遮挡文字且动画不跳动。
- [ ] 浅色、深色、透明和窄窗口均可读。
- [ ] 键盘、IME、焦点恢复和滚动位置正确。
- [ ] Context About 使用 Manifest 元数据并由宿主渲染，没有重复自绘。
- [ ] `panel.destroy` 能停止所有后台工作，不依赖 render 返回值清理。
- [ ] 文案跟随 `context.locale`，未引入 `framer-motion` 或自绘岛切换器。

安装、Manifest 与权限见 [`plugin-marketplace.md`](./plugin-marketplace.md)；开发流程见
[`plugin-development-guide.md`](./plugin-development-guide.md)。

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
└─ 主动作 + Esc（Esc 始终最右）
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

名称和描述来自 Manifest 的 `name` / `description` 英文回退，以及 `names` / `descriptions`
本地化映射。市场插件必须提供 `en` 与 `zh-CN`；宿主按当前语言选择，缺失时回退英文。

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

Home 组件不是缩小版 Custom Panel。插件只能通过 `manifest.homeWidgets[]` 将宿主支持的
语义系统数据源关联到自己的 Panel；Qx 统一绘制卡片、读取共享异步采样、处理窗口缩放、
焦点和主题。插件不得提交 Home HTML/CSS、像素尺寸、轮询计时器或点击位移动画。完整字段
见 [`plugin-marketplace.md`](./plugin-marketplace.md)。

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
回复需要把包内小图与文字原位混排时，可同时发布纯文本 `body` 回退和有序
`content[]`：文本使用 `{ type: "text", text }`，包内图片使用
`{ type: "asset-image", assetPath, alt }`。`assetPath` 必须是插件根目录内的相对路径，
由宿主解析；行内图片采用紧凑正文尺寸，不进入媒体预览，缺失时显示 `alt`/正文回退。

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

1. 关闭弹窗、详情、预览等内层；
2. 清空模块查询；
3. 离开模块；
4. 清空启动器查询；
5. 隐藏窗口。

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
- 动效只表达状态变化，尊重减少动态效果设置。
- 错误、空状态、加载和局部刷新不得替换仍可安全使用的缓存内容。

## 8. 焦点与响应

- 打开 Actions 后关闭，应恢复原选择和阅读位置。
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

安装、Manifest 与权限见 [`plugin-marketplace.md`](./plugin-marketplace.md)；开发流程见
[`plugin-development-guide.md`](./plugin-development-guide.md)。

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
├─ Esc
├─ Bottom Island
└─ 主动作 + Actions
```

- 插件不得自行绘制第二套 Top Bar、筛选 tabs、Bottom Bar 或 Actions 入口。
- Top Bar 右侧只用于内容筛选。发布稳定 `id`、当前值、选项和变更事件，宿主统一绘制
  下拉框；普通命令进入 Actions。
- Bottom Island 相对整个窗口居中，不相对内容列或 Context Panel 居中。
- Context Panel 是辅助信息和同一动作集合的另一投影，不是第二个主界面。

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

列表应保持原生桌面密度：

- 行内图标、正文列、右侧状态标签各有边界。
- 有 `progress` 的行由宿主添加状态类，插件不自行定位轨道。
- 进度位于正文列内部的底部槽，避开图标、标签和下一行。
- 普通行不因其他行有进度而改变高度。
- 选中框完整包住内容和进度槽。

## 3. 单一动作协议

每个动作只有一份描述：

```ts
type WorkbenchAction = {
  id: string;          // 稳定、非翻译、同层唯一
  label: string;
  primary?: boolean;  // 同层最多一个
  kbd?: string;
  disabled?: boolean;
  tone?: "normal" | "primary" | "danger";
  command?: string;
};
```

宿主以动作 `id` 连接四个入口：

```text
actions[]
   ├─ primary id → Bottom Bar 主按钮
   ├─ primary id → 未修饰 Enter
   ├─ 全部动作 → Actions 菜单
   └─ 相同对象 → Context Panel
```

因此：

- 不要为 Bottom Bar 再复制一个动作。
- 不要再写一个语义不同的 Enter handler。
- 标签变化、语言切换或列表选择变化不能改变动作身份。
- 禁用的主动作仍可显示，但 Enter 不执行。
- 子菜单在自己的层级中也必须使用唯一 ID。
- Actions 触发器由宿主生成；插件不声明“Actions”空动作。

推荐动作顺序：

1. 主动作；
2. 当前选择的直接操作；
3. 导航、刷新和视图操作；
4. 危险操作。

## 4. 快捷键与 Esc

- Enter 执行当前主动作。
- `Cmd+K`（macOS）或 `Ctrl+K`（Windows）打开 Actions。
- 上下方向键移动选择，左右方向键进入/退出详情。
- 快捷键标签由宿主按平台格式化，不硬编码只有 macOS 可读的符号。
- 文本输入保留复制、粘贴、剪切、全选、撤销、IME 和组合输入。
- 单字母动作只在 Actions 菜单打开时使用，不能抢占搜索输入。

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
- [ ] Bottom Bar、Enter、Actions、Context 引用同一动作。
- [ ] Esc 只走宿主阶梯。
- [ ] 带进度列表行不遮挡下一行。
- [ ] Island 进度不遮挡文字且动画不跳动。
- [ ] 浅色、深色、透明和窄窗口均可读。
- [ ] 键盘、IME、焦点恢复和滚动位置正确。

安装、Manifest 与权限见 [`plugin-marketplace.md`](./plugin-marketplace.md)；开发流程见
[`plugin-development-guide.md`](./plugin-development-guide.md)。

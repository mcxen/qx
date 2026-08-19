# Qx 插件开发手册

这份文档负责把作者从“一个业务能力”带到“可安装、可验证的 Qx 插件”。
字段全集与底层实现不在这里重复：UI、CLI、Manifest、Tray 和运行时分别由对应协议文档负责。

AI 记忆兼容性：`context.ai.memory.list()` 返回项包含宿主管理的
`source`、`type`（`core|episodic`）、`importance`（0–100）和
`supersedes` 谱系字段。插件不应改写这些元数据；用户选择 Off 时，
记忆调用暂停，但宿主保留已有数据。

## 1. 心智模型

Qx 插件是业务模块，不是自行绘制窗口的网页：

```text
业务数据 / CLI / HTTP
        ↓
插件 index.js
        ↓
context.* 稳定端口
        ↓
Workbench + Actions + Island
        ↓
QxShell（Top Bar / Main Area / Bottom Bar）
```

- 插件声明数据、筛选项、动作和状态；宿主负责窗口、主题、键盘和固定控件。
- `panel.render()` 返回可用的缓存内容或声明式 Workbench，不阻塞网络与重任务。
- 一个动作只声明一次。稳定 `id` 驱动 Bottom Bar、Enter，并让 Context Panel 投影其余动作。
- Context 末尾的「关于」由宿主从 Manifest 的双语名称、作者和双语描述固定投影；插件不自绘。
- 趋势和时间序列使用 `detail.chart` 结构化数据；宿主统一用 Qx shadcn/Radix 主题绘制，插件不得
  提交自绘 SVG/Canvas 或硬编码业务颜色。历史图表只能展示真实源数据或持久化真实采样。
- 平台差异由宿主端口处理，插件不要判断 macOS/Windows 后自行拼系统命令。
- 文案语言用无权限的 `context.locale.current`（`en` / `zh-CN`），不要读
  `navigator.language`，也不存在 `context.i18n`。

### 1.2 发现、兼容与权限不是同一件事

Qx 对外部插件采用 Manifest 驱动的发现机制，不维护允许安装的插件 ID 白名单：

1. 安装器校验并解包 `.qx-plugin` 到 `~/.qx/plugins/<id>/`；目录名必须与
   `manifest.id` 一致。
2. 启动或用户点击 Settings → Extensions → Rescan 时，Rust 在 blocking worker
   中扫描已安装目录并读取 `manifest.json`。宿主不持续监听文件系统，也不会因为作者
   只把源码目录复制进仓库就自动注册插件。
3. 被发现只表示“出现在已安装列表”。只有插件已启用、`platforms` 匹配当前系统、
   `min_app_version` 被当前 Qx 满足且依赖可解析时，宿主才注册 command / panel、创建
   sandbox iframe、后台任务或全局快捷键。Provider-only 插件可以保持 Manifest-only，
   直到对应 surface 或 command 真正使用时再懒加载。
4. 执行后仍受能力白名单约束。`manifest.permissions` 只申请宿主已经定义的
   `context.*` 能力；危险 Rust 命令要求精确 `invoke:<command>`。被发现或启用都不等于
   获得任意 Tauri、文件系统或网络权限。

内置 React 模块是另一条链：它们随 Qx 编译，不扫描 `src/modules/` 自动发现，必须进入
宿主的静态模块目录、route composition、图标与可用性注册。插件作者通常不需要修改这条链；
核心贡献者应按 [`docs/module-port-inventory.md`](../../docs/module-port-inventory.md) 的
“新内置模块”清单登记，避免模块能打开却无法置顶、搜索或绑定快捷键。

旧包没有 `names` / `descriptions` 时仍可安装，但宿主只显示包内原始 `name` / `description`；
插件仓库的打包校验会拒绝继续发布缺少这些本地化映射的版本。设置偏好使用 `labels` /
`descriptions` / `placeholders`，命令使用 `titles` / `descriptions`，面板使用 `titles`，
并至少提供 `en` 与 `zh-CN`。

### 1.1 一张图看懂布局责任

```text
QxShell（宿主固定）
├─ Top Bar       主搜索 + tabs/filters
├─ Main Area     Workbench List / Grid / Detail / Form
├─ Context       当前对象 → 非主 Actions → 后台状态 → About
└─ Bottom Bar    Home → Island → primary → Actions → Esc
```

插件只发布 Main Area 的数据模型和 Context 所需的 action/status 元数据；Top Bar、Context
容器、About、Bottom Bar、焦点、键盘、主题和宽度都由宿主绘制。插件不得把 Raycast 的
`ActionPanel`、React toolbar 或 HTML sidebar 原样搬进 Qx。

Workbench 的最小事件契约如下；事件必须回到同一个状态源，不能维护第二份选择或查询：

```js
context.ui.mountWorkbench(
  { title: "Example", query, tabs, items, selectedId, detail, actions, island },
  {
    onQuery: (value) => setQuery(value),
    onTab: (id) => setTab(id),
    onSelect: (id, item) => setSelected(item),
    onAction: (id, item) => runAction(id, item),
  },
);
```

`items[].actions` 只描述当前条目的真实业务操作。宿主 Enter 约定：

1. **列表且条目有 `detail`** → Enter 打开详情（阅读）
2. **详情已打开** → Enter 返回列表；Esc 同样可关闭详情
3. **列表且无 detail** → Enter 执行 `primary: true`（或第一个可用动作）

有集合与详情的 Workbench，「打开原文 / 安装 / 设壁纸」等业务动作**不得**标
`primary: true`，也不得用 `kbd: "Enter"` 覆盖宿主导航；它们留在 Context，并用
`CmdOrCtrl+…` 等带修饰键。不要给 open-detail / close-detail 再声明插件 action。
Raycast 的 `ActionPanel` 映射为同一份 `actions[]`，不再额外声明 Bottom Bar 或
Enter handler。

资讯、文章和社区帖子只要在详情发布 `body`、有序 `content[]` 或 `replies.items[]`，宿主就会在
详情态自动加入“保存离线 HTML”。插件不要重复声明导出 Action，也不需要为此申请 `system` 权限；
宿主只序列化已通过 Workbench 信任边界的当前快照，包含正文、图片、字段、分节和当前已加载的
评论树。已有 Data URL、HTTP(S) 图片与包内 `asset-image` 由宿主有界并发读取，请求带文档 Referer
与浏览器 UA，并按文件魔数（优先于 Content-Type）校验；SVG 可能继续引用外部资源，因此不进入严格离线导出。
其余图片转成 Data URL；单图上限 12 MiB、一次导出新增图片总量上限 64 MiB。
内置 RSS 的「下载文章」走同一嵌入端口，把正文 HTML 里的 `img` / 懒加载地址改写成 Data URL，而不是保留在线 `src`。
任一图片无法嵌入时不会生成仍依赖网络的半成品；全部图片完成后才无覆盖地写入用户 Downloads。若评论 `total` 大于当前 `items.length`，HTML 会明确
标注已保存数量；插件若要求全量评论，应先通过自己的分页/加载流程把它们发布到 `items[]`。

## 2. 文档地图

- 布局、Workbench、Actions、Esc、主题：[`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)
- CLI、异步任务、PATH：[`plugin-cli-protocol.md`](./plugin-cli-protocol.md)
- CLI 到 Workbench 的组织模式：[`plugin-cli-gui.md`](./plugin-cli-gui.md)
- Manifest、安装、市场发布：[`plugin-marketplace.md`](./plugin-marketplace.md)
- Tray：[`plugin-tray.md`](./plugin-tray.md)
- 运行时与权限边界：[`plugin-system.md`](./plugin-system.md)
- 内置 React 端口和插件端口映射：[`docs/module-port-inventory.md`](../../docs/module-port-inventory.md)

### 2.1 图标与社区商店资源

社区插件的图标默认使用仓库内的 `skills/imagegen` Skill 生成。它是图标的默认生产流程，
不是把一张参考图直接当成最终 Logo：先读 Skill 和本手册，针对当前插件生成独立的方形图标，
再人工检查主体、边缘、缩放和浅色/深色背景下的可读性。

推荐约定：

- 在 Qx 主仓库的 `skills/imagegen/SKILL.md` 指导下，为每个插件单独生成一个图标；不要把
  多图 Logo 墙或带多个候选图标的拼图作为插件 Logo。
- 最终文件保存为插件目录根部的 `icon-generated.png`，建议为 512×512 方形 PNG；图标中
  不要放难以缩放的长标题、版本号或运行时状态。若插件有必须保留的官方商标，应在 Skill
  生成提示中明确用途，并检查其授权与误导风险。
- 在 `manifest.json` 中声明 `"icon": "icon-generated.png"`。旧的 `icon.svg`、`icon.png`
  可以保留作回退或品牌原稿，但不能让文件名排序决定市场使用哪一张图。
- 预览图使用 `manifest.screenshots` 声明包内相对路径；只放真实的插件界面截图，不把图标
  生成过程或候选 Logo 墙当作产品截图。

插件市场构建会优先读取 `manifest.icon`，将它复制到 Pages 静态站的生成目录，并从同一个
`index.json` 生成列表和详情页。作者不应手工编辑 `store/public/catalog.json`、
`store/public/icons/` 或 `store/public/screenshots/`；这些都是 `npm run store:build` 的
构建产物。

新插件或更新插件的最小商店同步流程（在 `qx-plugins/` 仓库根目录执行）如下：

```bash
npm run package:plugins
npm run store:build
```

发布前应确认 `index.json` 已包含插件、`.qx-plugin` 包包含 `icon-generated.png`，并在本地
打开 `store/dist/` 检查列表页和插件详情页。若修改了图标或 `manifest.screenshots`，重复
执行 `npm run store:build`；合并到 `main` 后，Package Plugins 与 Plugin Store 工作流会
分别更新索引、重新烘焙静态页面并按配置部署 Pages。

显示器亮度插件应使用 `context.system.displayBrightness()` 读取 Qx 提供的内置屏和
外接 DDC/CI 目标，并使用 `context.system.setDisplayBrightness(id, value)` 写入 0–100
亮度。返回值中的 `current` 是百分比，`rawCurrent/rawMax` 是显示器 VCP 的真实值；
不支持或通信失败的外接屏仍会返回，并通过 `error/errorStage/errorCode` 说明失败阶段。
macOS 适配使用 DisplayServices 与内嵌 DDC/CI；Windows 适配使用 WMI 与 Win32
Monitor Configuration。两端保持同一序列化模型，插件不得按平台解析目标 ID。
由于该端口位于 `context.system`，manifest 还需声明 `system`，并添加精确写权限
`invoke:display_brightness_set`；插件不得安装、启动或解析 m1ddc/ddcctl、PowerShell
等外部工具。

## 3. 最小插件

推荐源码结构：

```text
my-plugin/
├── manifest.json
├── index.js
├── lib/
│   └── service.js
└── assets/
```

运行时入口必须是 `index.js`。可以拆分源码，但安装包必须包含入口引用的文件。
入口支持用标准 ESM 的 `./`、`../` 相对路径导入包内 `.js` / `.mjs`，也支持字符串
形式的动态 `import("./detail.js")`；路径不得越过插件根目录。包管理器 bare specifier
和运行时拼接的动态 import 必须在发布前 bundle。

`commands` 是可选的，只用于真实的可搜索操作：例如接收输入并产出结果、写入文件、
刷新外部数据，或由后台 interval 驱动的无界面任务。插件如果已经有 `panel`，不要再
注册仅用于打开面板的 `open-*`、插件名或模块名 command；面板名称本身就是主搜索入口。
面板内的刷新、打开原网页、切换状态等用户操作应声明为 Workbench action。宿主不会再
按命令名称猜测并过滤这类重复入口，清单与运行时入口必须从源头保持正确。

```js
export default {
  commands: [
    {
      name: "refresh",
      title: "Refresh",
      mode: "no-view",
      async run(context) {
        const response = await context.http.fetch("https://example.com/status");
        await context.storage.persist.set("latest", await response.json());
      },
    },
  ],

  panel: {
    async render(container, context) {
      const latest = await context.storage.persist.get("latest");
      context.ui.mountWorkbench({
        title: "Example",
        items: latest?.items ?? [],
        actions: [
          {
            id: "refresh",
            label: "Refresh",
            primary: true,
            menuKey: "r",
            kbd: "CmdOrCtrl+R",
            command: "refresh",
          },
        ],
      });
    },
  },
};
```

Manifest 只声明包元数据、入口、命令、面板、权限与兼容范围。完整字段见
[`plugin-marketplace.md`](./plugin-marketplace.md)。如果声明了 `manifest.panel`，
`index.js` 的默认导出也必须提供 `panel`；否则宿主会报告 `Panel not registered`。
`panel.title` 应省略或与 `name` 保持一致，让宿主使用 `names` 本地化；不要填一个没有
本地化映射的第二个英文产品名。

## 4. 选择正确端口

| 需求 | 使用 | 不要使用 |
|---|---|---|
| 声明列表、详情、表单、筛选 | `context.ui` / Workbench | 插件自绘 Top Bar、Bottom Bar |
| HTTP 请求 | `context.http` | shell 调 curl |
| 持久数据 | `context.storage.persist` | 写插件目录、浏览器 localStorage |
| 临时缓存 | `context.storage.session` | 把缓存当数据库 |
| 已读/收藏时间账本 | `context.state.createReadLedger` | 每个插件复制裁剪、上限与合并代码 |
| 串行最新状态落盘 | `context.state.createLatestWriter` + `storage.persist` | 并发 `set` 让旧快照覆盖新快照 |
| 有预算的内存缓存 | `context.state.createLru` | 无上限保存 Data URL / 大字符串 |
| 丢弃过期异步结果 | `context.state.createGenerationGate` | 让旧请求覆盖新 tab / 新查询 |
| 本机命令 | `context.cli` | `child_process` |
| Finder / Explorer 当前选择 | `context.files.selection()` + `file-selection` | 用剪贴板文本猜测路径 |
| 修改当前选择 | `context.files.performSelectionOperation()` + `file-operations` | 拼 PowerShell / AppleScript 或接受任意未授权路径 |
| 宿主命令 | `context.invoke` | 猜测 Tauri 内部实现 |
| 进度与快捷反馈 | `context.island` | 自建悬浮窗口 |
| Launcher Home 入口 | `manifest.homeWidgets[]`（把宿主源关联到插件 Panel）或 `manifest.surfaceProviders[]`（把受支持轻量信息源透出到 Home） | 自绘首页卡片、私有轮询 |
| 托盘状态 | `context.tray` | 直接调用系统托盘库 |
| Tray/Home 标准控件 | `manifest.surfaceProviders[]`（受支持语义源） | 为常驻展示加载完整 Panel 运行时 |
| 翻译 | `context.locale.current` / `preference` / `onChange` | `navigator.language` 或虚构的 `context.i18n` |

文件管理器输入是唤起前快照，不是实时查询当前焦点窗口：

```js
const selection = await context.files.selection();
if (selection.items.length === 1) {
  await context.files.performSelectionOperation({
    revision: selection.revision,
    operation: "rename",
    path: selection.items[0].path,
    name: "new-name.txt",
  });
}
```

支持的操作为 `rename`、`collect`、`compress`、`extract`。`collect` / `compress` 还需提供 `name`；`extract` 只接受 ZIP。宿主会重新检查 revision、选择成员、名称、目标冲突及归档路径，旧快照必须让用户重新唤起或重新打开模块，插件不得自动改用任意磁盘路径重试。

带 `manifest.panel` 的插件由宿主自动提供“打开插件”全局快捷键录入项，不需要在
`shortcuts[]` 中伪造打开命令。`shortcuts[]` 只声明具体 command 的可选默认键；面板与
命令热键都由 Rust 宿主统一注册，插件不得直接调用 global-shortcut API。

`context.http.fetch` 的 `body` 是 UTF-8 文本。发送 Protobuf、压缩包等原始字节时，
把字节编码为标准 base64 后传入 `bodyBase64`；它会覆盖 `body`。二进制响应继续通过
`response.arrayBuffer()` 或 `response.bodyBase64` 读取。宿主默认将响应限制为 16 MiB，
单次请求最多可申请 32 MiB；图片预览应主动传入更小的 `maxBytes`。

能力必须在 Manifest 中申请最小权限。无权限与能力不可用都应返回可解释错误，
而不是伪造成功或退回危险的通用执行。

`homeWidgets[]` 只负责把宿主系统数据源关联到插件 Panel。若插件希望在 Launcher Home
直接提供一张宿主卡片，应声明 `surfaceProviders[]`，并且只能使用 Qx 已登记的语义源。
`agent.usage` 约定插件把无凭据的归一化快照写入 `agent-usage.snapshot.v1`；Home 只读该缓存，
不启动插件 runtime，也不代替插件执行登录或网络刷新。
当前可用的 Home 信息源包括 `rss.unread-latest` 与 `agent.usage`。前者由宿主读取 RSS
未读快照；后者只读插件已保存的无凭据归一化快照（如 `agent-usage.snapshot.v1`），不启动
插件 runtime、不代替登录或网络刷新。Qx 先画缓存，按主窗口可见性节流，定时/事件/激活
single-flight 合并，慢请求最多一次尾随刷新，失败保留最近快照。插件只声明稳定 id、
双语标题/说明和 `surfaces`，不提交数据请求、DOM、CSS、轮询周期或尺寸。展示 Home/Tray
Provider 不会启动完整插件运行时；点击后才按需进入对应模块或 Panel。新增信息能力必须
先在宿主注册原子适配器，再加入 Manifest 校验，禁止用一个泛化 JSON 卡片端口绕过这个边界。

## 5. Panel 生命周期

插件导出必须是一个 `QxPlugin` 对象（ES module 默认导出）：

```ts
export default {
  commands: [{ name: "open-example", title: "Open Example", run: async (context) => {} }],
  panel: {
    render(container, context) { /* 首帧 + 后台加载 */ },
    destroy(container) { /* 清理 timers、订阅、请求和媒体缓存 */ },
  },
};
```

Manifest 中声明的每个 command 必须在 `QxPlugin.commands` 中提供同名且可调用的
`run`；声明 panel 时必须提供 `panel.render`。宿主加载时会校验这些契约。

`panel.render(container, context)` 应快速完成：

1. 立即挂载首帧 Workbench（通过 `context.ui.mountWorkbench`）；宿主会先恢复上次成功的呈现快照。
2. 读取业务缓存或本地持久状态（游标、原始响应、离线正文等）；不要重复保存同一份 Workbench JSON。
3. 通过命令、后台 interval 或用户动作刷新真实数据。
4. 完成后更新存储、Workbench 或 Island。

`panel.destroy(container)` 必须取消 interval、订阅、未完成请求、媒体缓存和 Island/Tray
会话。不要依赖 `render()` 返回的清理函数：宿主只调用显式的 `destroy` 生命周期。

网络型面板采用 stale-while-revalidate：保留可用旧内容，显示真实刷新状态，
慢请求不得把新选择或新查询覆盖回旧结果。进度必须来自真实阶段或明确标记为
indeterminate，不能 mock 百分比。
分页、流式批次或局部详情完成时使用 controller `updateItems({ upsert, removeIds, order,
selectedId, revision })`；这会通过宿主增量协议合并并更新快照，不要为单个条目重发完整集合。

媒体必须受字节预算约束，但不得用产品级图片数量上限截断上游正常集合：单个列表项
最多 4 张紧凑预览，详情按源顺序发布完整集合；宿主仅在信任边界保留 96 张异常输入
安全阈值。Workbench 单次快照的媒体 URL 总长度不超过 32 MB。插件自己的
Base64/Data URL 缓存应使用 `context.state.createLru({ maxEntries, maxSize, sizeOf })`
（或等价的按最后访问时间淘汰策略），并根据集合数量动态压缩单张预览预算；不要同时
保留原始 bytes、Canvas 与多个 Data URL 副本。详情原图请求建议使用
`maxBytes: 8 * 1024 * 1024`，下载原图才申请更大的上限。

社区列表的正文、评论和图片等 indeterminate 加载应发布到 Workbench 快照的
`island`，使用宿主已有的 `spinner`、`wave`、`dots` 或 `pulse` 动画；不要同时在
`detail.status` 或 `detail.replies.status` 放一条重复的“正在加载”。详情内联状态
只用于错误，或确实属于内容区域且能提供真实 completed/total/failed 的进度。多图请求
应使用有上限的并发队列，完成后按源顺序合并，避免逐张回画、无界 fan-out 或后一次
异步结果覆盖整组图片。

评论缓存采用 stale-while-revalidate：命中缓存后立即回画评论，刷新期间旧评论保持可读，
活动态只进入 `island`；TTL 到期必须真正更新当前 Workbench 快照，不能只在后台覆写磁盘。
逐主题动态 persist key 通过 `storage.cacheTargets[].keyPrefixes` 登记，确保设置页统计、
过期淘汰和清理使用同一范围。

社区列表可在选中项加载完成后，低优先级串行预取相邻 1–3 条正文和评论并写入内容缓存；
不得把预取条目标记为已读，也不要预取整页原图。用户改变选择、tab 或销毁 panel 后，
旧预取队列必须停止继续扩展。

插件面板的 Esc 阶梯由宿主统一处理：先关岛上最近浏览切换器（宿主 chrome，插件不实现），
再关闭内层详情、清空查询、离开插件、清空启动器查询、隐藏窗口。插件不要注册全局 Esc，
也不要调用内部的 `tryModuleEscapeStep` 或 `tryCloseRecentSwitcher`；它们只属于宿主。

## 6. Workbench 与动作

社区回复统一发布为 `detail.replies.items[]` 纯数据树，插件不得自行绘制 Reddit/Tieba
评论 DOM：

```js
{
  id: "reply-42",
  floor: "12.2",
  author: "bob",
  body: "@alice ...",
  parentId: "reply-12",     // 可选：同一 items[] 内稳定父回复 id
  depth: 2,                 // 可选：父项分页缺失时的 0–8 层提示
  replyToAuthor: "alice",  // 可选：宿主本地化显示“回复 alice”
}
```

`author` 与 `replyToAuthor` 应发布去除首尾空白后的真实显示名；只有 `@`、空字符串或
全空白回复对象必须省略 `replyToAuthor`。宿主会在 Workbench 信任边界再次归一化，
不会渲染“回复〔空白〕”。

宿主按 `parentId` 保持同级源顺序并生成父项优先的树，统一负责缩进、分支线、折叠和
无障碍按钮；有效 `parentId` 的派生层级优先于 `depth`。缺失父项、自引用或循环关系必须
安全降级为根回复，视觉深度最多 8 层。分页接口可保留 `parentId + depth`，但不得伪造
未加载的父回复。回复树是 Workbench 公共接口，QxTieba、V2EX、Hacker News 等消费者
只能适配源数据，不得复制宿主树算法或 CSS。

动作对象必须有稳定、非翻译的 `id`。最多一个动作标记 `primary: true`。
下面示例适用于**没有详情**的命令面板；有 List → Detail 时不要把业务动作标成 primary，
也不要把 `kbd` 写成 `Enter`：

```js
actions: [
  {
    id: "open-result",
    label: "Open Result",
    primary: true,
    menuKey: "o",
    kbd: "CmdOrCtrl+O",
  },
  {
    id: "refresh",
    label: "Refresh",
    menuKey: "r",
    kbd: "CmdOrCtrl+R",
    command: "refresh",
  },
]
```

不要再单独声明一个 Bottom Bar 按钮或 Enter handler。宿主会把同一个主动作投影到
Bottom Bar，并让未修饰 Enter 执行它；Context Panel 从同一集合只投影其余业务动作。
manifest 的面板启动命令、后台 interval 和宿主重新加载不会自动出现在当前面板 Actions；
需要用户在面板内执行的命令，必须显式声明为 Workbench action。
Esc 不属于动作快捷键。

Actions 不是说明列表。每个可见业务 action 都必须执行一个真实操作（例如刷新、打开原网页、
导出）或切换一个真实且可观察的状态（例如显示/隐藏 Island）；不得用 action 显示状态、充当
无回调占位，也不得复制宿主已经提供的“打开详情/返回列表”。每个业务 action 必须配置
`menuKey`：单个 ASCII 字母、大小写不敏感、在当前菜单层级唯一。用户打开 `Cmd/Ctrl+K`
后可直接输入该字母执行动作。宿主在列表态保留 `D` 给“打开详情”，在详情态保留 `B` 给
“返回列表”；插件 action 在对应层级不得占用这些字母。

`menuKey` 与 `kbd` 不同：前者仅在 Actions 菜单打开时生效，不会抢走搜索输入；后者是可选的
窗口内完整快捷键，业务动作使用 `CmdOrCtrl+…` 等可移植写法，不能用单字母 `kbd` 抢占输入。
插件 action id 不得使用宿主保留的 `__qx:` 前缀；打开/关闭详情和资讯 HTML 保存等宿主动作
不会进入插件 `onAction`。

无法用 Workbench 表达而保留自定义 HTML 的面板，必须通过 `context.ui.mountActions()` 发布
宿主 Actions，不能在内容区自绘命令工具栏。设置 `primary: false` 的动作只进入 Context / Actions
菜单，不占用 Bottom Bar 主动作：

```js
const actions = context.ui.mountActions([
  {
    id: "refresh",
    label: "Refresh",
    menuKey: "r",
    kbd: "CmdOrCtrl+R",
    primary: false,
  },
], {
  onAction(id) {
    if (id === "refresh") void refresh({ manual: true });
  },
});

// panel.destroy
actions.destroy();
```

面板存活期间需要轮询的数据，应使用 `context.setInterval` 并做静默增量更新：轮询不得反复
清空可用内容、切换整页 loading、重建相同 DOM、抢走焦点或重置滚动位置。仅当数据结构变化
时重绘；普通数值变化应就地更新。Panel 销毁时必须清除 interval。

Top Bar 右侧只发布内容筛选模型，由宿主绘制固定下拉框。Bottom Bar 的左侧 Home、
中间 Island，以及右侧依次排列的主动作与 Esc 也全部由宿主绘制。详细规则见
[`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)。

## 7. 后台工作与 Island

后台命令适合轮询、同步和长任务：

- 声明 `mode: "no-view"`；需要周期执行时设置 Manifest 的 interval。
- 先返回任务或缓存状态，不占用 Panel render。
- 后台任务进度通过 `context.island` 发布；前台 Workbench 内容加载通过快照
  `island` 发布，只有内容内的可量化进度或错误才使用 Workbench status。
- 成功、失败、取消都要形成终态；错误保持在当前操作，不让整个面板失效。
- 任务在 Qx 休眠或关闭期间错过计划时间时，宿主恢复后补执行一次；插件命令必须把失败
  继续抛给宿主，不能 catch 后伪装成成功。

Island 内容必须有稳定会话标识。插件可选择宿主支持的进度样式，默认是浅蓝色从左到右
填充；位置、尺寸、浮出与动画稳定性由宿主管理。双击 docked 岛展开最近浏览、动作胶囊
弹簧进出属于宿主 chrome，插件不得注入图标、Motion 或窗口坐标。协议与示例见
[`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)。

## 8. 真实接口测试（上架门禁）

凡是依赖 HTTP、CLI、宿主 invoke、下载或第三方服务的插件，发布或升级前必须把最终
实现使用的线上接口实际调用至少一次，并确认真实响应能被当前解析逻辑处理。未完成真实
接口测试的版本不得进入市场索引。

- mock、录制响应和合成 fixture 只证明解析器回归，不证明线上接口可用。真实测试必须覆盖
  插件对用户承诺的每条主路径，例如 Feed、详情、评论和翻页应分别触发真实请求。
- 每条主路径至少验证一个成功样本，并验证可实际触发的失败形态，例如非 2xx、超时、空体、
  鉴权失败、限流或风控页。失败时必须保留可用缓存并给出可解释错误，不能把错误体送进正常
  解析器后显示误导性的协议错误。
- 二进制接口必须按插件实现使用 `bodyBase64` / `arrayBuffer()`，并检查状态码、最终 URL、
  `Content-Type`、`Content-Encoding` 和响应前导字节。应覆盖服务端真实可能返回的压缩与未压缩
  数据，以及 HTML/JSON 错误体。使用会自动解压响应的测试工具时，还应检查原始传输头或增加
  未自动解压的测试，避免把工具行为误认为接口行为。

如果上游接口在发布窗口内不可访问，或缺少测试所需的账号/设备，该版本应标记为阻塞并推迟
上架，不能用 mock 通过来替代。

## 9. 本地开发流程

1. 用脚手架或现有插件复制最小目录。
2. 按本手册 §2.1 使用 `skills/imagegen` 生成 `icon-generated.png`，再编写
   `manifest.json` 和 `index.js`。
3. 在设置中启用开发者模式并从本地目录安装。
4. 修改后使用 Reload Panel。
5. 检查插件日志、权限错误和 Workbench 返回结构。
6. 运行 `npm run package:plugins` 与 `npm run store:build`，检查最终安装包和 Pages
   静态站的列表/详情页；接口测试不要求冷安装。

除上一节的真实接口门禁外，建议至少验证：

- 空数据、缓存数据、网络失败和超时；
- 浅色、深色、透明主题；
- 仅键盘完成搜索、上下移动、Enter、Actions、Esc；
- Windows 和 macOS 路径、快捷键标签与不可用能力；
- Panel 快速返回，后台任务不阻塞输入；
- 安装包中无密钥、缓存、构建临时文件。

## 10. 交付检查

- [ ] Manifest 与默认导出命令一一对应。
- [ ] 声明 `manifest.panel` 时实际导出 `panel`。
- [ ] `panel.title` 已省略或与 `name` 一致，没有绕过本地化端口的第二个产品名。
- [ ] 权限是最小集合，危险操作有明确用户动作。
- [ ] Manifest 的 `names` / `descriptions` 同时包含 `en` 与 `zh-CN`，Context「关于」无需自绘。
- [ ] Preferences 的 `labels` / `descriptions` / `placeholders`、commands 的 `titles` /
  `descriptions`、panel 的 `titles` 已提供 `en` 与 `zh-CN`，选项文字也已本地化。
- [ ] Workbench action `id` 稳定且同层唯一。
- [ ] 每个业务 action 都是可执行操作或真实状态开关，没有状态项、空占位或重复宿主导航。
- [ ] 每个业务 action 都有同层唯一的单字母 `menuKey`，且不占用宿主当前层的 `D` / `B`。
- [ ] 只有一个主动作；Enter、Bottom Bar 与 Actions 语义一致。
- [ ] 没有动作使用 Esc。
- [ ] Top Bar 筛选与 Bottom Bar 都交给宿主。
- [ ] 网络、CLI、下载和进度都是真实结果。
- [ ] 已逐条实际调用线上接口主路径；mock/fixture 未被当作上架依据。
- [ ] 二进制接口已验证压缩、响应类型与 HTML/JSON 错误体，不会把错误响应误报为协议解析失败。
- [ ] 已使用 `skills/imagegen` 生成独立的 `icon-generated.png`，且 `manifest.icon` 指向它。
- [ ] `manifest.screenshots` 中的文件存在；已运行 `npm run package:plugins` 和
  `npm run store:build`，确认 Pages 列表与详情页能显示新插件和图标。
- [ ] `panel.render()` 不等待长任务。
- [ ] 用户可从错误状态重试。
- [ ] 可见文案跟随 `context.locale.current`，未使用 `navigator.language`。
- [ ] 未申请 Island 时不调用 `context.island`；未注入最近浏览、Motion 或浮窗坐标。

## 11. 老插件迁移

老插件仍可能返回 HTML、自己画筛选按钮或维护独立主按钮。迁移时先保留业务服务层，
再把呈现改成 Workbench 和稳定动作 ID。不要继续扩展 Raycast converter shim；
转换器已经冻结，维护插件应按业务意图重实现。迁移边界见
[`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md)。

## 12. 版本与兼容

使用 Manifest 的 `min_app_version` 表达宿主最低版本。端口新增字段应保持向后兼容；
插件必须处理能力不可用。协议变更同时更新对应唯一权威文档，不在本手册复制字段表。

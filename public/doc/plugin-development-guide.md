# Qx 插件开发手册

这份文档负责把作者从“一个业务能力”带到“可安装、可验证的 Qx 插件”。
字段全集与底层实现不在这里重复：UI、CLI、Manifest、Tray 和运行时分别由对应协议文档负责。

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
- 平台差异由宿主端口处理，插件不要判断 macOS/Windows 后自行拼系统命令。

## 2. 文档地图

- 布局、Workbench、Actions、Esc、主题：[`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)
- CLI、异步任务、PATH：[`plugin-cli-protocol.md`](./plugin-cli-protocol.md)
- CLI 到 Workbench 的组织模式：[`plugin-cli-gui.md`](./plugin-cli-gui.md)
- Manifest、安装、市场发布：[`plugin-marketplace.md`](./plugin-marketplace.md)
- Tray：[`plugin-tray.md`](./plugin-tray.md)
- 运行时与权限边界：[`plugin-system.md`](./plugin-system.md)
- 内置 React 端口和插件端口映射：[`docs/module-port-inventory.md`](../../docs/module-port-inventory.md)

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

```js
export default {
  commands: [
    {
      name: "refresh",
      title: "Refresh",
      mode: "no-view",
      async run(context) {
        const response = await context.http.get("https://example.com/status");
        await context.storage.persist("latest", response.data);
      },
    },
  ],

  panel: {
    async render(context) {
      const latest = await context.storage.get("latest");
      return {
        kind: "list",
        title: "Example",
        items: latest?.items ?? [],
        actions: [
          {
            id: "open",
            label: "Open",
            primary: true,
          },
          {
            id: "refresh",
            label: "Refresh",
            command: "refresh",
          },
        ],
      };
    },
  },
};
```

Manifest 只声明包元数据、入口、命令、面板、权限与兼容范围。完整字段见
[`plugin-marketplace.md`](./plugin-marketplace.md)。如果声明了 `manifest.panel`，
`index.js` 的默认导出也必须提供 `panel`；否则宿主会报告 `Panel not registered`。

## 4. 选择正确端口

| 需求 | 使用 | 不要使用 |
|---|---|---|
| 声明列表、详情、表单、筛选 | `context.ui` / Workbench | 插件自绘 Top Bar、Bottom Bar |
| HTTP 请求 | `context.http` | shell 调 curl |
| 持久数据 | `context.storage.persist` | 写插件目录、浏览器 localStorage |
| 临时缓存 | `context.storage` 的缓存能力 | 把缓存当数据库 |
| 本机命令 | `context.cli` | `child_process` |
| 宿主命令 | `context.invoke` | 猜测 Tauri 内部实现 |
| 进度与快捷反馈 | `context.island` | 自建悬浮窗口 |
| Launcher Home 入口 | `manifest.homeWidgets[]`（受支持语义源） | 自绘首页卡片、私有轮询 |
| 托盘状态 | `context.tray` | 直接调用系统托盘库 |
| 翻译 | `context.i18n` | 硬编码单一语言 UI |

`context.http.fetch` 的 `body` 是 UTF-8 文本。发送 Protobuf、压缩包等原始字节时，
把字节编码为标准 base64 后传入 `bodyBase64`；它会覆盖 `body`。二进制响应继续通过
`response.arrayBuffer()` 或 `response.bodyBase64` 读取。

能力必须在 Manifest 中申请最小权限。无权限与能力不可用都应返回可解释错误，
而不是伪造成功或退回危险的通用执行。

Home 声明只负责把宿主系统数据源关联到插件 Panel。CPU、内存、电源和网络卡片由 Qx
共享采样并统一渲染；插件不要重复请求数据、注入视觉代码或指定窗口尺寸。

## 5. Panel 生命周期

`panel.render(context)` 应快速完成：

1. 读取缓存或本地持久状态。
2. 返回 Workbench。
3. 通过命令、后台 interval 或用户动作刷新真实数据。
4. 完成后更新存储、Workbench 或 Island。

网络型面板采用 stale-while-revalidate：保留可用旧内容，显示真实刷新状态，
慢请求不得把新选择或新查询覆盖回旧结果。进度必须来自真实阶段或明确标记为
indeterminate，不能 mock 百分比。

插件面板的 Esc 阶梯由宿主统一处理：关闭内层详情、清空查询、离开插件、清空启动器
查询、隐藏窗口。插件不要注册全局 Esc，也不要调用内部的 `tryModuleEscapeStep`；
它只属于宿主模块端口。

## 6. Workbench 与动作

动作对象必须有稳定、非翻译的 `id`。最多一个动作标记 `primary: true`：

```js
actions: [
  {
    id: "open-result",
    label: "Open Result",
    primary: true,
    kbd: "Enter",
  },
  {
    id: "refresh",
    label: "Refresh",
    kbd: "R",
    command: "refresh",
  },
]
```

不要再单独声明一个 Bottom Bar 按钮或 Enter handler。宿主会把同一个主动作投影到
Bottom Bar，并让未修饰 Enter 执行它；Context Panel 从同一集合只投影其余业务动作。
manifest 的面板启动命令、后台 interval 和宿主重新加载不会自动出现在当前面板 Actions；
需要用户在面板内执行的命令，必须显式声明为 Workbench action。
Esc 不属于动作快捷键。

Top Bar 右侧只发布内容筛选模型，由宿主绘制固定下拉框。Bottom Bar 的左侧 Home、
中间 Island，以及右侧依次排列的主动作与 Esc 也全部由宿主绘制。详细规则见
[`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)。

## 7. 后台工作与 Island

后台命令适合轮询、同步和长任务：

- 声明 `mode: "no-view"`；需要周期执行时设置 Manifest 的 interval。
- 先返回任务或缓存状态，不占用 Panel render。
- 进度通过 Island 或 Workbench 状态发布。
- 成功、失败、取消都要形成终态；错误保持在当前操作，不让整个面板失效。
- 任务在 Qx 休眠或关闭期间错过计划时间时，宿主恢复后补执行一次；插件命令必须把失败
  继续抛给宿主，不能 catch 后伪装成成功。

Island 内容必须有稳定会话标识。插件可选择宿主支持的进度样式，默认是浅蓝色从左到右
填充；位置、尺寸与动画稳定性由宿主管理。协议与示例见
[`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)。

## 8. 本地开发流程

1. 用脚手架或现有插件复制最小目录。
2. 编写 `manifest.json` 和 `index.js`。
3. 在设置中启用开发者模式并从本地目录安装。
4. 修改后使用 Reload Panel。
5. 检查插件日志、权限错误和 Workbench 返回结构。
6. 用本地文件安装包完成一次冷启动验证。

建议至少验证：

- 空数据、缓存数据、网络失败和超时；
- 浅色、深色、透明主题；
- 仅键盘完成搜索、上下移动、Enter、Actions、Esc；
- Windows 和 macOS 路径、快捷键标签与不可用能力；
- Panel 快速返回，后台任务不阻塞输入；
- 安装包中无密钥、缓存、构建临时文件。

## 9. 交付检查

- [ ] Manifest 与默认导出命令一一对应。
- [ ] 声明 `manifest.panel` 时实际导出 `panel`。
- [ ] 权限是最小集合，危险操作有明确用户动作。
- [ ] Workbench action `id` 稳定且同层唯一。
- [ ] 只有一个主动作；Enter、Bottom Bar 与 Actions 语义一致。
- [ ] 没有动作使用 Esc。
- [ ] Top Bar 筛选与 Bottom Bar 都交给宿主。
- [ ] 网络、CLI、下载和进度都是真实结果。
- [ ] `panel.render()` 不等待长任务。
- [ ] 用户可从错误状态重试。

## 10. 老插件迁移

老插件仍可能返回 HTML、自己画筛选按钮或维护独立主按钮。迁移时先保留业务服务层，
再把呈现改成 Workbench 和稳定动作 ID。不要继续扩展 Raycast converter shim；
转换器已经冻结，维护插件应按业务意图重实现。迁移边界见
[`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md)。

## 11. 版本与兼容

使用 Manifest 的 `min_app_version` 表达宿主最低版本。端口新增字段应保持向后兼容；
插件必须处理能力不可用。协议变更同时更新对应唯一权威文档，不在本手册复制字段表。

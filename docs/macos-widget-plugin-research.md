# Qx macOS 桌面小组件插件协议：调研、方案与落地指南

> 状态：Research proposal · 当前版本：v0.6.84 · 调研日期：2026-08-12
>
> 本文是设计与实施计划，不表示 WidgetKit 扩展已经随 Qx 发布。当前 Qx
> 已有的 Launcher Home / Tray `homeWidgets`、`surfaceProviders` 协议保持不变；
> 本文新增的是“真正出现在 macOS 桌面小组件图库中的 WidgetKit surface”方案。

## 结论先行

macOS 桌面小组件的官方协议是 **WidgetKit**：小组件是应用中的 Widget Extension，
使用 SwiftUI 绘制，由 `TimelineProvider` / `AppIntentTimelineProvider` 提供时间线数据，
使用 App Groups 与宿主应用共享数据，使用 `WidgetCenter` 请求时间线刷新，使用
`AppIntent` 或 `Link` 提供有限交互和深链接。

这不是一个可以让 Qx 插件运行时注入 HTML、React 或任意 SwiftUI 的协议。Widget Extension
是编译、签名、嵌入 App Bundle 的原生扩展，WidgetKit 由系统在独立进程中按需唤起它；它不会
持续运行，也不能依赖插件 iframe 常驻。

因此 Qx 采用以下边界：

```text
插件 iframe / 内置模块
        │ 结构化 publishSnapshot()
        ▼
Qx Host：权限、校验、节流、最新快照、原子写入
        │ App Group shared container
        ▼
QxWidget.appex：固定的 WidgetKit + SwiftUI 渲染器
        │ WidgetCenter.reloadTimelines()
        ▼
macOS 桌面 / Notification Center
```

插件提供“数据、状态、动作语义”；Qx 原生扩展提供“视图、尺寸、主题、可访问性和系统
生命周期”。进度条可以作为第一种标准语义，实时的秒级进度继续使用 Qx Island / 浮动面板，
桌面小组件负责低频、可恢复、一扫即懂的状态展示。

## 1. Apple 协议调查

| Apple 能力 | 在 Qx 方案中的职责 | 关键限制 |
|---|---|---|
| WidgetKit | 将小组件暴露到 macOS 桌面和 Notification Center | 系统负责布局、生命周期和刷新预算 |
| Widget Extension / `WidgetBundle` | Qx 的固定原生渲染容器 | 必须编译、签名并嵌入 `.app`；不是运行时插件加载器 |
| SwiftUI | 绘制小组件的标准视觉 | Qx 插件不直接提交 SwiftUI、HTML、CSS 或 Canvas |
| `TimelineProvider` | 生成静态或按时间变化的 `TimelineEntry` | 小组件不是常驻进程；时间点不是硬实时保证 |
| `AppIntentTimelineProvider` | 读取用户配置的 provider / instance | 配置类型需要在扩展中预先实现，数据可以动态来自共享容器 |
| `WidgetConfigurationIntent` | 让用户选择“监控哪个插件、哪个目标” | 参数必须是可安全枚举的实体，不能让小组件直接执行任意插件代码 |
| App Groups | App 与 Widget Extension 共享小型快照和配置 | 需要 App 与扩展使用同一 group entitlement |
| `WidgetCenter` | 数据变化后请求刷新某个 widget kind | 刷新受系统动态预算限制，不能当作轮询 API |
| `AppIntent` / `Link` | 交互按钮或打开 Qx 的深链接 | v1 只承诺打开详情；任意插件动作需要后续安全桥接 |

Apple 官方资料：

- [WidgetKit](https://developer.apple.com/documentation/widgetkit/)
- [Creating a widget extension](https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension)
- [Developing a WidgetKit strategy](https://developer.apple.com/documentation/widgetkit/developing-a-widgetkit-strategy)
- [AppIntentTimelineProvider](https://developer.apple.com/documentation/widgetkit/appintenttimelineprovider)
- [Configuring app groups](https://developer.apple.com/documentation/xcode/configuring-app-groups)
- [Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date/)
- [Adding interactivity to widgets and Live Activities](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities)
- [Apple：在 Mac 桌面或通知中心添加小组件](https://support.apple.com/en-euro/guide/mac-help/mchl52be5da5/mac)

### 1.1 刷新模型

WidgetKit 请求的是一个时间线，而不是“每秒调用一次 `render()`”。Timeline provider 可以
返回当前条目和未来条目，并给出 `atEnd`、`after(date)` 或 `never` 策略；当 Qx 数据变化时，
宿主可以调用 `WidgetCenter` 请求刷新，但系统仍会根据可见性、宿主是否前台、最近刷新时间等
因素分配预算。Apple 文档给出的典型活跃小组件预算约为每天 40–70 次，实际间隔由系统学习和
设备状态决定，不能把这个数字当作合同。

这直接决定了产品分工：

- 构建、下载、CI、同步等任务：WidgetKit 展示最近一次真实快照和“更新时间/过期状态”。
- 秒级进度、暂停/取消、实时日志：Qx Island、主窗口或专用浮动窗口。
- 可预测的倒计时：用时间线或 SwiftUI 动态日期显示，不能靠 Widget Extension 常驻计时器。
- 服务器数据：优先由 Qx 主进程或插件后台任务采样并写共享快照；小组件只读快照。

## 2. 对 Qx 当前架构的审计

当前 Qx 是 Tauri v2 + React/TypeScript + Rust，桌面主 App 的 Bundle ID 是
`com.mcx.qx`。目前已经存在可复用的声明式思想，但它们不是 macOS WidgetKit：

- `manifest.homeWidgets[]` 关联 Qx Launcher Home 的宿主卡片；数据源限定为
  `system.cpu`、`system.memory`、`system.power`、`system.network` 和
  `system.display-brightness`。
- `manifest.surfaceProviders[]` 面向 Qx Home / Tray 的轻量宿主数据源；它们可在不加载插件
  iframe 的情况下读取宿主快照。
- 外部插件在 sandboxed iframe 中运行，拥有受权限约束的 `context.*` 端口；它们不能直接创建
  Qx 顶层窗口或安装任意原生扩展。
- `src-tauri/tauri.conf.json` 当前只配置主 Tauri App、资源和外部二进制，没有 Widget
  Extension target、App Group 或 `.appex` 嵌入配置。
- `src-tauri/Entitlements.plist` 当前没有 `com.apple.security.application-groups`。

现有协议与新协议必须保持隔离：

| Surface | 位置 | 数据来源 | 是否加载插件 JS | 方案 |
|---|---|---|---:|---|
| Launcher Home | Qx 主窗口 | Qx host provider | 按需/不加载 | 保持 `homeWidgets` / `surfaceProviders` |
| Tray | 菜单栏 | Qx host provider | 不需要 | 保持 `surfaceProviders` / `context.tray` |
| Island | Qx 原生浮岛 | 任务/插件状态 | 任务期间 | 适合实时进度 |
| macOS Desktop Widget | 系统桌面/通知中心 | App Group 最新快照 | 不加载 | 新增 `widgetProviders` + WidgetKit |

## 3. 推荐的统一插件协议

### 3.1 Manifest：`widgetProviders[]`

不复用 `homeWidgets[]`，因为它们的生命周期、渲染器和刷新语义不同。建议增加一个明确的
macOS surface：`manifest.widgetProviders[]`。它只描述小组件目录中允许使用的语义类型，
不提供视觉代码。

建议的 v1 字段：

```json
{
  "widgetProviders": [
    {
      "id": "build-progress",
      "kind": "progress",
      "title": "Build progress",
      "titles": { "en": "Build progress", "zh-CN": "构建进度" },
      "description": "Monitor the active build",
      "descriptions": { "en": "Monitor the active build", "zh-CN": "监控当前构建" },
      "families": ["systemSmall", "systemMedium"],
      "privacy": "public",
      "defaultEnabled": false
    }
  ]
}
```

字段不变量：

- `id` 在插件内稳定、唯一，只允许安全的短 ID；发布后不可复用为另一种业务含义。
- `kind` v1 只允许 `progress`、`metric`、`status`、`text`；先做 `progress`。
- `families` 只能从 Qx 固定支持的 WidgetKit family 中选择；扩展不为每个插件动态编译新 family。
- `privacy` 至少区分 `public` 与 `private`。`private` 的内容必须支持锁屏/敏感内容隐藏策略，
  不应在桌面长期显示 token、路径、私有日志或 API 响应原文。
- `defaultEnabled` 只影响 Qx 的 provider 目录，不自动替用户把小组件放到桌面。
- `widgetProviders[]` 不声明刷新秒数、CSS、颜色、像素尺寸、远程 URL 或任意 JSON schema。

### 3.2 最新快照：`WidgetSnapshotV1`

插件或内置模块只能通过宿主 API 发布结构化快照。快照是“最新状态”，不是历史数据库；
建议在 App Group 中按 `providerId + instanceId` 原子替换 JSON 文件。初版不让 Widget Extension
直接打开 Qx 的 SQLite，避免把数据库锁、迁移和长查询带入系统扩展。

```ts
type WidgetSnapshotV1 = {
  schemaVersion: 1;
  providerId: string;       // plugin:<pluginId>:<providerId>
  instanceId: string;       // 同一 provider 的不同监控对象
  revision: number;         // 单调递增；旧快照不得覆盖新快照
  updatedAt: number;        // Unix ms，真实采样时间
  expiresAt?: number;       // 超过后宿主显示 stale
  state: "loading" | "ready" | "stale" | "error" | "empty";
  title: string;
  subtitle?: string;
  content:
    | {
        type: "progress";
        value?: number;      // 0–100；未知进度不传
        label?: string;
        completed?: number;
        total?: number;
        detail?: string;
      }
    | {
        type: "metric";
        value: string;
        unit?: string;
        trend?: "up" | "down" | "flat";
      }
    | {
        type: "status";
        label: string;
        tone?: "neutral" | "positive" | "warning" | "critical";
      }
    | {
        type: "text";
        body: string;
      };
  openUrl: string;           // qx:// 深链接，只能打开详情/配置
};
```

快照协议的性能与安全限制建议如下：

- 单个快照上限 16 KiB；文本和 `detail` 各自再设长度上限，禁止塞入完整日志、图片或历史数组。
- 同一个 `providerId + instanceId` 只保留一份 latest；写入使用临时文件 + 原子 rename。
- `revision`、`updatedAt` 必须由真实状态推进；旧的异步请求不得覆盖新快照。
- 进度只能传真实百分比或真实 `completed / total`；未知时使用 indeterminate，不用动画伪造。
- 快照过期后显示 stale，而不是把旧值伪装成当前值；错误状态保留最近一次可读标题。
- `openUrl` 由宿主生成并校验为 `qx://`，插件不能构造 `file://`、脚本或任意外部协议。
- 插件不能通过发布快照绕过已有的 HTTP、system、storage 或 command 权限。

### 3.3 Host API：`context.widgets`

建议的插件端口不是直接暴露 WidgetKit，而是一个窄的宿主端口：

```ts
interface PluginWidgetContext {
  listInstances(providerId: string): Promise<WidgetInstance[]>;
  publishSnapshot(
    providerId: string,
    instanceId: string,
    snapshot: WidgetSnapshotV1,
  ): Promise<{ revision: number; accepted: boolean }>;
  clearSnapshot(providerId: string, instanceId: string): Promise<void>;
  openConfiguration(providerId: string): Promise<void>;
}
```

实现边界：

1. `rpcMethods.ts` 校验插件是否声明 `widget` 权限，并检查 provider 属于当前插件。
2. Host 校验 schema、大小、时间、revision、深链接和 content union。
3. Rust 或专用 host service 负责 App Group 目录、原子写入、过期清理和诊断日志。
4. Host 对同一 widget kind 的 reload 请求做合并和节流；不能每次 `publishSnapshot` 都立即
   调用 `WidgetCenter`。
5. Widget Extension 只读取共享快照和配置，渲染固定 SwiftUI；它不加载 iframe、插件 JS、
   Qx WebView，也不执行插件命令。

### 3.4 Widget 配置与实例

一个固定的 `QxWidget` kind 通过 `AppIntentConfiguration` 让用户选择：

```text
Qx Widget
  ├─ Provider：QxGH / Build Monitor / RSS / 自定义插件
  └─ Instance：项目、任务、仓库或监控目标
```

`AppIntentTimelineProvider` 在扩展进程中根据配置读取对应的共享快照。这样新插件可以在
Qx 中安装并出现在 provider 选择列表，不需要为每个插件重新编译 Widget Extension。代价是
图库中显示的是一个统一的 `Qx Widget`，而不是每个第三方插件各自拥有一个原生 Widget 类型。

“每个插件在图库中显示自己的原生名称和自定义 SwiftUI”属于另一条高成本路线：插件必须携带
原生扩展、签名、entitlements 和兼容的 App Bundle 生命周期，不能直接套用当前 iframe 插件
市场。v1 明确不走这条路线。

## 4. 数据流与线程边界

推荐的数据流：

```text
插件后台任务 / 用户动作
        │
        │ fetch / CLI / invoke（仍受插件权限与超时约束）
        ▼
真实状态 → context.widgets.publishSnapshot()
        │
        ├─ Qx Host 内存 latest cache
        ├─ App Group/widgets/<instance>.json（原子写）
        └─ WidgetCenter.reloadTimelines(ofKind: "com.mcx.qx.widget")（合并后）
                                      │
                                      ▼
                  QxWidget Extension → TimelineEntry → SwiftUI
                                      │
                                      ▼
                  用户点击 → qx://widget/<provider>/<instance>
                                      │
                                      ▼
                  Qx 主窗口打开插件详情或 QxAI/Workbench 目标
```

线程与可靠性要求：

- 插件网络请求、CLI、解析和写快照都不能运行在 UI responder 路径；遵守现有
  `docs/runtime-threading.md` 的 async / blocking 分层。
- App Group 写入必须有单写入队列或按 instance 串行化，使用 latest-wins；不能让较慢的旧请求
  覆盖新数据。
- Widget Extension 读取失败、过期或字段版本未知时显示本地化的 stale/error 状态，不崩溃，
  不删除主 App 的数据。
- Qx 退出或睡眠时，Widget 只能显示上一次已落盘的快照；不能承诺后台任务仍会按秒执行。
- 原始 API key、cookie、私有路径和完整命令输出不进入共享快照。需要敏感信息时只显示脱敏摘要。

## 5. 方案比较与选择

| 方案 | 优点 | 主要问题 | 结论 |
|---|---|---|---|
| 原生 WidgetKit 固定渲染器 | 真正进入桌面 Widget Gallery；系统管理位置、尺寸、生命周期 | 需要 Swift 扩展、签名、App Groups；刷新非实时 | **推荐，作为桌面小组件协议** |
| Qx 透明置顶窗口 | 可动态加载任意插件；秒级进度和完整交互容易 | 不是系统小组件；焦点、位置、权限、耗电和多屏行为都要自己维护 | 继续用于 Island/浮动面板，不替代 WidgetKit |
| Widget Extension 内加载 WebView/插件 iframe | 复用前端 | 生命周期、沙箱、包签名和系统渲染边界不可靠；把不受信任代码带入扩展 | 禁止 |
| 每个插件携带原生 Widget Extension | 插件可拥有完全自定义原生 UI | 不是当前插件模型；包签名、审查、升级和宿主嵌入复杂 | v1 不做，未来单独评估 |

## 6. 分阶段开发计划

### Phase 0：调研与冻结原则（本次）

- [x] 确认 macOS 桌面/通知中心使用 WidgetKit。
- [x] 确认 Widget Extension、Timeline、App Groups、WidgetCenter、App Intents 的职责。
- [x] 确认当前 Qx 没有原生 Widget Extension 和 App Group entitlement。
- [x] 形成“插件发快照，固定扩展渲染”的边界。
- [x] 明确 WidgetKit 不承担秒级实时进度；实时状态走 Qx Island。

### Phase 1：先做纯协议与宿主模拟，不接原生扩展

目标：先让跨端插件和 Qx 主进程拥有稳定端口，避免 Swift 工程先行导致协议返工。

建议工作项：

1. 在 `src/plugin/types.ts` 增加 `PluginWidgetProviderDeclaration`、`WidgetSnapshotV1`、
   `WidgetInstance` 类型；Rust marketplace manifest 做同样的边界校验。
2. 增加 `manifest.widgetProviders[]`，限制 provider 数量、ID、kind、family、双语标题和
   `privacy`；保持与现有 `homeWidgets[]` 分离。
3. 增加 `context.widgets` 与 iframe RPC；先实现内存 latest cache + 开发诊断页，暂不声称
   已经写入 macOS 桌面。
4. 增加 fixture：构建进度 0%、50%、100%、未知进度、过期、错误、旧 revision 和超长 payload。
5. 将 `widget` 权限、发布频率、快照大小和深链接规则写入公开插件协议。

验收：插件可以发布经过校验的快照，旧快照不会覆盖新快照；没有 WidgetKit 的 Windows
开发环境也能运行协议单测。

### Phase 2：加入最小原生 QxWidget.appex

目标：先做一个不依赖第三方插件的固定 `progress` 小组件。

建议目录（最终名称可随 Xcode 工程调整）：

```text
src-tauri/macos-widget/
├── QxWidgetExtension/       # WidgetKit + SwiftUI + AppIntentTimelineProvider
├── QxWidgetShared/          # Codable snapshot/config model 与 App Group reader
└── README.md                # 本地签名、构建、安装和调试
```

需要完成：

- 在主 App 与 Widget Extension 中配置同一个 App Group，例如 `group.com.mcx.qx`；实际 ID
  由 Apple Developer Team / 签名方案确认后冻结。
- 在 Widget Extension 中实现 `QxWidgetBundle`、`QxWidgetConfigurationIntent`、
  `QxWidgetTimelineProvider` 和 `progress` SwiftUI renderer。
- 用 App Group 里的原子 JSON 快照作为读取源；没有快照时使用 placeholder，不访问主 App 的
  SQLite 或 WebView。
- 让小组件点击 `qx://widget/...`，回到 Qx 后打开对应 provider/instance。
- 将 `.appex` 构建产物嵌入 `Qx.app/Contents/PlugIns/`，并在 CI、Developer ID / 本地个人
  Team 签名路径中验证 entitlements 一致性。

验收：从 macOS Widget Gallery 添加 Qx Widget，调整 small/medium 尺寸，显示真实 progress
快照，重启 Qx 后仍能读到上一次快照，点击后可回到正确的 Qx 页面。

### Phase 3：Host bridge 与插件目录

- Host 将安装插件的 `widgetProviders[]` 投影到共享 `widget-catalog.json`。
- AppIntent 的 provider/instance query 只读取经过 Host 签名/校验的目录，不扫描任意插件目录。
- `publishSnapshot()` 写入 `widgets/<provider-id>/<instance-id>.json`，按 instance 串行化。
- 将 reload 请求按 `kind` 合并，保留最近一次错误并输出结构化诊断。
- Qx 设置增加“桌面小组件”入口：查看已发布 provider、隐私等级、最后更新时间和过期状态。

### Phase 4：第一个真实插件与进度条场景

建议用 QxGH/CI 或一个本地 build monitor 做示范，而不是先做复杂的 AI widget：

```text
启动监控 → loading
收到真实任务总量 → progress(completed, total)
任务完成 → 100% + success
任务失败 → error + 最近一次进度
超过 expiresAt → stale
点击 → qx://widget/... → QxGH 详情 / Workbench
```

进度采样由插件已有的 HTTP/CLI/后台任务完成；WidgetKit 只消费快照。正在执行的任务同时
使用 `context.island` 显示即时状态，桌面小组件不承担取消动作，直到 AppIntent action
桥接经过安全审查。

### Phase 5：发布与回归

- macOS 14+ 真机测试：Widget Gallery、桌面、Notification Center、暗色/浅色、桌面 dimming、
  small/medium、锁屏/隐私、睡眠唤醒、多显示器和 App 重启。
- 测量 snapshot 体积、写入耗时、reload 合并率和 stale 比例；不得用“刷新成功”代替用户可见
  内容更新验证。
- 验证 Widget Extension 被系统杀掉后可以重新读取快照；验证主 App 清理缓存不会误删 durable
  App Group widget snapshot。
- 检查本地签名和 Release 签名的 App Group entitlement、Bundle ID、嵌入路径和 notarization。
- 更新 `docs/ipc-catalogue.md`、`docs/module-port-inventory.md`、`public/doc/plugin-marketplace.md`
  和 `public/doc/plugin-development-guide.md`，只有 Phase 1/2 实际落地后才把字段从“计划”改为
  “Current”。

## 7. 明确不做的事情

- 不让插件直接提供 HTML/CSS/React/SwiftUI 作为桌面小组件内容。
- 不把 `homeWidgets[]` 改造成万能 JSON 卡片协议。
- 不在 Widget Extension 中启动插件 iframe、运行用户脚本、执行 shell 或访问 Qx 主 SQLite。
- 不承诺 WidgetKit 秒级刷新、持续网络连接或后台常驻。
- 不把完整日志、密钥、cookie、原始文件路径或任意远程图片放进共享快照。
- 不为每个动态安装插件重新编译、签名和嵌入一个原生扩展。

## 8. 近期可直接执行的任务清单

按实现风险排序：

1. 冻结 `widgetProviders` 和 `WidgetSnapshotV1` 的 TypeScript/Rust schema。
2. 为插件 manifest、权限、快照校验、latest-wins 和过期状态补测试。
3. 做一个 Qx 主进程内的 fake Widget renderer，先验证进度、错误、stale、点击深链。
4. 建立 macOS Widget Extension target 和 App Group shared container。
5. 接入固定的 `Qx Widget` progress renderer 与 AppIntent provider/instance 选择。
6. 接入 Host 快照写入、reload 合并和 `qx://widget` 路由。
7. 用一个真实监控插件完成端到端测试，再开放给插件市场作者。

第 1–3 项完成前，不应修改现有插件的 `homeWidgets` 语义；第 4 项完成并在真实 `.app`
中验证前，不应在市场文档中宣称“支持 macOS 桌面小组件”。

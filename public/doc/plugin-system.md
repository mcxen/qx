# Qx 插件系统架构

这份文档解释公开运行时的边界与依赖方向，不维护第二份 Manifest、Workbench 或 API 字段表。

## 1. 架构

```text
Plugin package
  manifest.json + index.js + assets
                 │
                 ▼
Sandboxed plugin runtime
  context.ui / state / http / storage / cli / system / island / tray
                 │ pure SDK + typed RPC
                 ▼
PluginHost + permission policy
                 │
                 ▼
QxShell / Rust services / platform adapters
```

- 插件依赖 `context.*` 端口，不依赖 iframe、Tauri、Rust 命令或操作系统细节。
- PluginHost 把 Workbench 数据投影到 QxShell；插件不拥有窗口 chrome。
- Rust 服务负责网络、存储、CLI、系统能力和平台适配。
- `surfaceProviders` 由 Tray/Home 直接消费 manifest 元数据和宿主适配器；没有 interval 或
  已启用全局快捷键的 Provider 插件在首次 Panel/command 前不创建 iframe。
- `context.state` 是 direct/iframe 共用的纯 SDK：提供最新快照写入队列、已读时间
  账本、有预算 LRU 和异步 generation gate，不发 RPC，也不需要 Manifest 权限。
- macOS 与 Windows 对插件暴露相同模型；不可用能力以明确错误返回。
- `context.system.displays()` 返回显示器名称、分辨率、刷新率、缩放、旋转、
  主屏/内置屏状态，以及平台可提供的连接协议和 EDID 厂商/产品标识；
  插件不得自行调用 DisplayConfig、CoreGraphics 或 shell 工具重复枚举。

## 2. 包、注册与运行

安装器读取 Manifest，验证包身份、兼容版本、平台、权限、命令和可选 Panel。
运行时加载 `index.js` 的默认导出，并核对：

- Manifest 命令与导出命令一致；
- 声明 Panel 时实际导出 `panel`；
- 命令名、动作 ID 与会话 ID 在各自作用域稳定；
- 入口引用的源码和资源都在包内。

本地文件、URL 和市场安装最终进入同一验证与运行路径。市场字段与安装流程只在
[`plugin-marketplace.md`](./plugin-marketplace.md) 维护。

## 3. 权限模型

权限按能力而不是按实现细节授予：

- 网络：限定 HTTP 端口与请求策略；
- 持久化：限定插件自己的命名空间；
- CLI：区分 argv、shell 与长任务；
- System / Invoke：只开放登记的宿主能力；
- Island / Tray：只允许宿主管理的呈现会话；
- 通知、剪贴板等能力遵循相同最小授权原则。

Manifest 未声明、宿主未实现或平台不支持时，端口必须失败并返回可解释原因。插件不能通过
通用 invoke 或 shell 绕过专用端口。

## 4. 通信

插件与宿主通过请求/响应 RPC 和明确事件通信。稳定要求：

- 请求有方法、参数和关联 ID；
- 成功与错误使用一致返回形状；
- 大任务快速返回 task ID，再 poll 或接收状态；
- 锁不跨网络等待、进程等待或事件发送；
- 旧请求结果不得覆盖更新的 Panel 状态。

CLI 的请求与任务协议见 [`plugin-cli-protocol.md`](./plugin-cli-protocol.md)。
Tray 见 [`plugin-tray.md`](./plugin-tray.md)。

## 5. UI 投影

Workbench 是插件 UI 的声明模型，QxShell 是宿主呈现层：

- Top Bar 筛选由宿主固定 Select 绘制；
- 列表、Grid、Detail 和 Form 使用宿主组件与主题；
- `actions[]` 是唯一动作源，主动作 ID 驱动 Bottom Bar 与 Enter；
- Actions 入口、Context Panel 与 Esc 由宿主统一组织；
- Island 会话由宿主仲裁位置、样式、进度与窗口间迁移；最近浏览与动作弹簧是宿主
  chrome，插件不得注入 Motion 或浮窗几何。
- 语言用无权限 `context.locale`，不是 `context.i18n`。

完整 UI 契约只在 [`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md) 维护。

## 6. 生命周期与后台任务

```text
install → validate → load → render cached Workbench
                              │
                              ├─ user action / command
                              └─ optional background interval
                                      ↓
                         queued → running → terminal state
```

Panel render 不等待长任务。后台任务必须报告真实或 indeterminate 进度，最终进入 succeeded、
failed 或 cancelled。缓存和持久状态属于不同语义；卸载、升级与失败不能破坏其他插件数据。

## 7. 兼容性

- Manifest 使用 `min_app_version` 声明最低宿主。
- 新增可选字段保持旧插件可运行。
- 公开端口变更必须同步对应协议文档与检查门禁。
- 内部命令、iframe 实现与平台适配不属于插件 API。
- Raycast converter 是冻结的历史实验，维护插件应按业务意图重实现。

## 8. 权威文档

| 主题 | 文档 |
|---|---|
| 开发流程 | [`plugin-development-guide.md`](./plugin-development-guide.md) |
| Workbench / Actions / Island | [`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md) |
| CLI | [`plugin-cli-protocol.md`](./plugin-cli-protocol.md) |
| Manifest / 市场 / 安装 | [`plugin-marketplace.md`](./plugin-marketplace.md) |
| Tray | [`plugin-tray.md`](./plugin-tray.md) |
| Raycast 迁移 | [`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md) |

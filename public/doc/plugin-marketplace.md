# Qx 插件市场指南

本文档面向插件开发者，说明如何开发、打包、发布插件到 [github.com/mcxen/qx-plugins](https://github.com/mcxen/qx-plugins) 市场，以及用户如何从市场安装插件。

> **写插件逻辑**请先读 [`plugin-development-guide.md`](./plugin-development-guide.md)。  
> 本文侧重：**打包、Import zip、Browse、上架 `qx-plugins`**。

## 目录结构

一个 Qx 插件是一个目录，包含以下文件：

```
my-plugin/
├── manifest.json     # 插件元数据 + 能力声明
├── index.js          # ESM 入口，导出 commands 和 panel
├── icon.png          # 图标（可选）
└── README.md         # 说明文档（可选）
```

打包时压缩为 `.qx-plugin`（实际是 zip）：

```bash
cd my-plugin
zip -r ../my-plugin.qx-plugin manifest.json index.js icon.png
```

## manifest.json 规范

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A custom plugin for Qx",
  "author": "Your Name",
  "icon": "icon.png",
  "screenshots": ["screenshot-1.png"],
  "platforms": ["macos", "windows"],
  "keywords": ["hello", "test"],
  "permissions": ["open-url", "http", "notifications"],
  "entry": "index.js",
  "preferences": [
    {
      "id": "apiKey",
      "label": "API Key",
      "type": "password",
      "required": true,
      "description": "Your API key for authentication."
    }
  ],
  "commands": [
    {
      "name": "run",
      "title": "Run My Plugin",
      "description": "Execute the main command",
      "keywords": ["run", "execute"]
    }
  ],
  "shortcuts": [
    {
      "command": "run",
      "key": "CommandOrControl+Shift+R",
      "enabled": true
    }
  ],
  "panel": {
    "title": "My Plugin",
    "icon": "icon.png",
    "keywords": ["my plugin"]
  },
  "min_app_version": "0.4.0",
  "pubkey": "",
  "signature": ""
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 唯一标识，建议用小写 + 连字符，如 `v2ex-viewer` |
| `name` | 是 | 显示名称 |
| `version` | 是 | 语义化版本号 |
| `description` | 否 | 简短描述 |
| `author` | 否 | 作者名 |
| `icon` | 否 | 图标文件名，相对路径 |
| `screenshots` | 否 | 截图文件名数组，相对路径 |
| `platforms` | 否 | 支持平台数组：`macos`、`windows`、`linux` |
| `keywords` | 否 | 全局搜索关键词 |
| `permissions` | 否 | 需要的能力权限 |
| `entry` | 否 | 入口文件，默认 `index.js` |
| `preferences` | 否 | 用户可配置的偏好项 |
| `commands` | 否 | 搜索结果中出现的命令 |
| `shortcuts` | 否 | 全局快捷键，`command` 对应命令 `name`，`key` 使用 Tauri global-shortcut 格式 |
| `panel` | 否 | 注册为全屏面板 tab |
| `min_app_version` | 否 | 最低 Qx 版本要求 |
| `pubkey` / `signature` | 否 | ed25519 签名（可选） |

### preferences 类型

| type | 说明 | UI 控件 |
|------|------|---------|
| `string` | 文本 | 输入框 |
| `password` | 密码/令牌 | 密码输入框 |
| `number` | 数字 | 数字输入框 |
| `boolean` | 开关 | Toggle |
| `select` | 下拉选择 | Select |

用户在「设置 → Extensions → Installed」中选择插件后，右侧详情面板会自动渲染 preferences 表单。Installed 列表支持按名称、ID、作者、描述、关键词和权限搜索，也可以用 `All / Built-in / External / Enabled / Disabled` 分段筛选快速定位插件。

## index.js 接口

```js
export default {
  commands: [
    {
      name: "run",
      title: "Run My Plugin",
      async run(context) {
        const name = await context.prompt("What's your name?");
        context.showToast(`Hello, ${name}!`);
      }
    }
  ],
  panel: {
    async render(container, context) {
      container.innerHTML = "<h1>My Plugin</h1>";
    },
    destroy(container) {
      container.innerHTML = "";
    }
  }
};
```

### context API

| API | 说明 | 需要权限 |
|-----|------|----------|
| `context.invoke(cmd, args)` | 调用 Tauri 后端命令 | `invoke:<cmd>` 或 `*` |
| `context.showToast(msg)` | 显示 toast 通知 | 无 |
| `context.prompt(label, defaultValue?)` | 弹出输入框 | 无 |
| `context.openUrl(url)` | 打开外部链接 | `open-url` |
| `context.getPreference(id)` | 读取用户偏好 | 无 |
| `context.clipboard.read()` | 读取系统剪贴板文本 | `clipboard` |
| `context.clipboard.write(text)` | 写入系统剪贴板文本 | `clipboard` |
| `context.http.fetch(url, opts)` | 通过 Rust 后端发起真实 HTTP/HTTPS 请求 | `http` |
| `context.notification.show(input)` | 显示系统通知 | `notifications` |
| `context.ai.providers()` | 读取 QxAI provider/model 目录，自定义 provider 优先通过 API `/models` 获取 | `ai` |
| `context.ai.defaultModel()` | 读取默认 provider/model | `ai` |
| `context.ai.agentSettings()` | 读取 Settings -> AI Agent 的全局开关和工具配置 | `ai` |
| `context.ai.chat(input, opts?)` | 调用 QxAI 文本或图片多模态聊天能力，可指定 provider/model | `ai` |
| `context.ai.stream(input, onChunk, opts?)` | 流式接收 QxAI 文本输出 chunk | `ai` |
| `context.ai.runBash(script, opts?)` | 执行真实 bash 脚本并返回结构化 stdout/stderr/status，受全局 Agent/Bash 开关约束 | `ai-bash` |
| `context.ai.search.grep(query, opts?)` | 使用用户配置的真实 `rg` / `grep` 后端搜索文本，受全局 Agent/Grep 开关约束 | `ai-tools` |
| `context.ai.memory.*` | 读取、新增、删除用户可管理 AI 记忆 | `ai-memory` |
| `context.ai.tasks.*` | 提交和管理 Qx 进程内后台 AI 任务 | `ai-background` |
| `context.system.stats()` | 读取 CPU / MEM / GPU 运行监控 | `system-stats` |
| `context.system.info()` | 读取系统信息 | `system-info` |
| `context.system.storage()` | 读取磁盘存储信息 | `system-info` |
| `context.system.network()` | 读取网络设备信息 | `system-info` |
| `context.invoke("qx_external_displays_driver/list")` | 读取外接显示器 DDC/CI 驱动与显示器参数 | `external-displays` |
| `context.invoke("qx_external_displays_set_control")` | 调节外接显示器亮度/对比度/音量 | `invoke:qx_external_displays_set_control` |
| `context.system.processes.list()` | 读取进程列表 | `processes` |
| `context.system.processes.kill(pid)` | 结束进程 | `invoke:qx_system_information_kill_process` |
| `context.permissions.status()` | 读取 macOS 权限状态 | `permissions` |
| `context.permissions.request(id)` | 申请 macOS 权限 | `invoke:qx_permissions_request` |
| `context.permissions.openSettings(id)` | 打开 macOS 权限设置 | `permissions` |
| `context.apps.search(query)` | 搜索系统应用 | `apps` |
| `context.files.search(query, limit?)` | 搜索文件 | `files` |
| `context.qx.invokeRust(cmd, args)` | 调用受控 Rust/Tauri 命令 | 能力组、`invoke:<cmd>` 或 `*` |
| `context.setTimeout/setInterval` | 面板生命周期定时器，面板销毁/插件卸载时自动清理 | 无 |
| `context.storage.get(key)` | 读取插件持久 KV（兼容旧 API，等同 `persist.get`） | 无 |
| `context.storage.set(key, value)` | 写入插件持久 KV（兼容旧 API，等同 `persist.set`） | 无 |
| `context.storage.delete(key)` | 删除插件持久 KV（兼容旧 API，等同 `persist.delete`） | 无 |
| `context.storage.session.get/set/delete(key)` | 当前 Qx 进程内的临时 KV，适合首屏缓存 | 无 |
| `context.storage.persist.get/set/delete(key)` | 落盘到插件 `data/storage.json` 的长期 KV，适合跨重启缓存 | 无 |

### 权限列表

```
open-url           打开外部链接
clipboard          读写系统剪贴板文本
http               发起真实 HTTP/HTTPS 请求
notifications      显示系统通知
ai                 使用 QxAI provider 目录、模型选择、文本和图片多模态聊天能力
ai-memory          读取、新增、删除用户可管理 AI 记忆
ai-bash            允许 AI/插件执行真实 bash 脚本（危险能力，需谨慎授予）
ai-tools           允许 AI/插件调用非危险工具，例如用户配置的 rg/grep 搜索
ai-background      提交和管理 Qx 进程内后台 AI 任务
system-info        读取系统、存储、网络等静态系统信息
system-stats       读取 CPU / MEM / GPU 运行监控
external-displays  读取外接显示器 DDC/CI 驱动与显示器参数
processes          读取进程列表
apps               搜索系统应用
files              搜索文件
permissions        读取权限状态、打开系统设置
automation         读取录屏/宏等自动化状态
storage-management 读取 Qx 存储概览
invoke:<cmd>       调用指定 Tauri 命令（精确授权）
*                  通配所有权限（仅调试用）
```

危险 Rust 命令必须精确授权，不能只依赖能力组。例如结束进程、申请权限、清空数据、宏回放、录屏启动、文件导出/删除等，需要在 manifest 中写入对应 `invoke:<cmd>`。

Raycast generic 转换插件为了提高兼容性，会使用精确文件桥权限
`invoke:plugin_file_read_base64`、`invoke:plugin_file_write_base64`、
`invoke:plugin_file_exists`、`invoke:plugin_file_ensure_dir`、
`invoke:plugin_file_empty_dir`、`invoke:plugin_file_list`。这些权限允许转换
插件访问真实绝对路径、`~/...` 路径以及 `/qx-plugin-files/<plugin-id>`
虚拟私有路径；清空目录仍会拒绝根目录、用户 Home 和 `/tmp` 等过宽目标。

Raycast 转换插件可带 `raycast.platformCompatibility`，用于 Installed 详情页展示 macOS / Windows / Linux 的 Supported、Partial、Mac Only 或 Unsupported 状态，以及可用、降级和不可用能力列表。

Raycast generic 转换插件的 `ActionPanel` 会默认显示为条目右侧的紧凑动作按钮；用户可在 Extensions → Installed → Display 关闭。窗口左右缩窄时，转换 shim 会优先隐藏这些按钮，避免插件列表内容被挤压。

## 发布到市场

### 1. 准备插件目录

确保插件目录包含 `manifest.json` 和 `index.js`，测试通过后打包：

```bash
cd my-plugin
zip -r ../my-plugin.qx-plugin manifest.json index.js icon.png
```

### 2. Fork qx-plugins 仓库

前往 [github.com/mcxen/qx-plugins](https://github.com/mcxen/qx-plugins)，Fork 仓库。

### 3. 添加插件文件

在 Fork 的仓库中创建插件目录：

```
qx-plugins/
├── index.json              # 市场索引
├── plugins/
│   ├── my-plugin/
│   │   ├── manifest.json
│   │   ├── index.js
│   │   └── icon.png
│   └── another-plugin/
│       └── ...
```

### 4. 更新 index.json

在 `index.json` 中添加你的插件条目：

```json
{
  "schema_version": 1,
  "plugins": [
    {
      "id": "my-plugin",
      "name": "My Plugin",
      "version": "1.0.0",
      "description": "A custom plugin for Qx",
      "download_url": "https://raw.githubusercontent.com/mcxen/qx-plugins/main/plugins/my-plugin/my-plugin.qx-plugin",
      "size_bytes": 0,
      "checksum_sha256": "",
      "required_permissions": ["open-url"],
      "updated_at": "2025-06-25",
      "author": "Your Name",
      "min_app_version": "0.4.0"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `schema_version` | 索引格式版本，当前为 `1` |
| `plugins` | 插件条目数组，字段与上表一致 |

> `download_url` 也可以指向 GitHub Release 的 asset，便于大文件分发。

### 5. 提交 PR

提交 Pull Request 到 `mcxen/qx-plugins`，合并后插件即可在 Qx 的 Extensions → Browse 中被搜索和安装。

## 插件库界面

设置页的 Extensions 是当前插件库入口，分为两个标签：

- `Installed`：管理已安装插件和内置模块。顶部可导入本地 `.zip` / `.qx-plugin`、安装 GitHub URL、安装 Raycast extension tree URL；下方提供搜索、类型/状态筛选、启用/禁用、卸载、权限查看和 preferences 编辑。
- `Browse`：浏览远程市场。左侧是可搜索插件列表，右侧展示选中插件详情、版本、作者、大小、权限、最低 Qx 版本、更新时间和 SHA256。安装按钮会显示安装中、已安装、失败等状态。

内置模块会以 Built-in 标记出现，只能查看和配置，不能禁用或卸载。外部插件安装后默认进入 `~/.qx/plugins/<id>/`，重新扫描可通过顶部 `Rescan` 完成。

## 从市场安装

在 Qx 中：

1. 打开设置（`Cmd+,`）
2. 进入 Extensions
3. 切换到 Browse 标签
4. 搜索或浏览插件列表，选中插件查看右侧详情
5. 点击右侧 Install

Qx 会自动下载 `.qx-plugin` 包并安装到 `~/.qx/plugins/<id>/`。

## 其他安装方式

### 从本地文件安装

在 Extensions → Installed → Import Plugin Archive 中输入本地 `.qx-plugin` 文件路径，然后点击 Install Local。

### 从 URL 安装

输入 GitHub repo、release asset 或 archive ZIP URL，然后点击 Install URL。

### 从 Raycast 扩展安装

输入 Raycast extension tree URL，然后点击 Install Raycast。Qx 会自动下载、转换并安装为 Qx 插件。例如：

```
https://github.com/raycast/extensions/tree/<ref>/extensions/system-information
```

转换后的插件会进入 `~/.qx/plugins/raycast-<extension-name>/`，与常规插件一样可在 Installed 列表中管理。详见 [Raycast 转换文档](./raycast-plugin-conversion.md)。

## 内置模块的偏好设置

内置模块（V2EX、RSS、Clipboard 等）也出现在 Extensions 列表中，标记为 Built-in。

- 选中内置模块后，右侧详情面板会显示该模块的偏好设置
- 内置模块不可禁用或卸载，只能查看和配置
- 内置模块的偏好存储在 `~/.qx/settings.json` 中，与全局设置一起持久化

## 签名（可选）

签名使用 ed25519，确保插件完整性：

```bash
# 在 Qx 中调用签名命令（需要本地私钥）
# 返回格式: pubkey|signature
```

将 `pubkey` 和 `signature` 写入 `manifest.json`。安装时 Qx 会自动验证签名，验证失败则拒绝加载。

签名不是必须的，但建议发布到市场时启用。

## 开发调试

### 文件结构

```
~/.qx/plugins/
├── my-plugin/
│   ├── manifest.json
│   ├── index.js
│   ├── icon.png
│   └── data/
│       ├── storage.json       # 插件私有 KV
│       └── preferences.json   # 用户偏好（外部插件）
```

### 热重载

在 Extensions 页面点击 Rescan 按钮可以重新扫描插件目录，无需重启应用。Installed 列表会保留当前搜索/筛选条件，并在插件增删后自动修正右侧选中项。

### 开发者模式

设置 → Advanced → Developer Mode 可以开启开发模式，插件文件变更时自动刷新。

## 完整示例

参见：

- [插件开发指南（业务上手）](./plugin-development-guide.md)
- [hello-world 示例](./plugin-system.md#十二、示例插件：hello-world)
- [Raycast 转换文档](./raycast-plugin-conversion.md)

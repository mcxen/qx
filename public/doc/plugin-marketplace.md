# Qx 插件市场指南

本文档面向插件开发者，说明如何开发、打包、发布插件到 [github.com/mcxen/qx-plugins](https://github.com/mcxen/qx-plugins) 市场，以及用户如何从市场安装插件。

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
  "keywords": ["hello", "test"],
  "permissions": ["open-url"],
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
| `keywords` | 否 | 全局搜索关键词 |
| `permissions` | 否 | 需要的能力权限 |
| `entry` | 否 | 入口文件，默认 `index.js` |
| `preferences` | 否 | 用户可配置的偏好项 |
| `commands` | 否 | 搜索结果中出现的命令 |
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

用户在「设置 → Extensions」中选择插件后，右侧详情面板会自动渲染 preferences 表单。

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
| `context.storage.get(key)` | 读取插件 KV 存储 | 无 |
| `context.storage.set(key, value)` | 写入插件 KV 存储 | 无 |
| `context.storage.delete(key)` | 删除插件 KV 存储 | 无 |

### 权限列表

```
open-url           打开外部链接
invoke:<cmd>       调用指定 Tauri 命令（精确授权）
*                  通配所有权限（仅调试用）
```

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

> `download_url` 也可以指向 GitHub Release 的 asset，便于大文件分发。

### 5. 提交 PR

提交 Pull Request 到 `mcxen/qx-plugins`，合并后插件即可在 Qx 的 Extensions → Browse 中被搜索和安装。

## 从市场安装

在 Qx 中：

1. 打开设置（`Cmd+,`）
2. 进入 Extensions
3. 切换到 Browse 标签
4. 搜索或浏览插件列表
5. 点击 Install

Qx 会自动下载 `.qx-plugin` 包并安装到 `~/.qx/plugins/<id>/`。

## 其他安装方式

### 从本地文件安装

在 Extensions → Installed → Import Plugin Archive 中输入本地 `.qx-plugin` 文件路径。

### 从 URL 安装

输入 GitHub repo、release asset 或 archive ZIP URL。

### 从 Raycast 扩展安装

输入 Raycast extension tree URL，Qx 会自动转换安装。例如：

```
https://github.com/raycast/extensions/tree/<ref>/extensions/system-information
```

## 内置模块的偏好设置

内置模块（V2EX、RSS、Clipboard 等）也出现在 Extensions 列表中，标记为 Built-in。

- 选中内置模块后，右侧详情面板会显示该模块的偏好设置
- 例如 V2EX 的 Access Token 和 Nodes 配置在此设置，不再单独占用设置页分类栏
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

在 Extensions 页面点击 Rescan 按钮可以重新扫描插件目录，无需重启应用。

### 开发者模式

设置 → Advanced → Developer Mode 可以开启开发模式，插件文件变更时自动刷新。

## 完整示例

参见 [hello-world 示例](./plugin-system.md#十一、示例插件：hello-world) 和 [Raycast 转换文档](./raycast-plugin-conversion.md)。

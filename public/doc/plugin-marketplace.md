# Qx 插件包、Manifest 与市场指南

这是插件打包、安装、兼容和分发的唯一权威文档。运行时 API 和 Workbench 不在这里重复。

## 1. 包结构

```text
my-plugin/
├── manifest.json
├── index.js
├── icon.png
├── README.md
├── lib/
└── assets/
```

`.qx-plugin` 是保留上述相对路径的 zip。入口默认为 `index.js`；入口 import 的本地文件都
必须包含在包中。不要打包密钥、缓存、日志、依赖下载目录和系统生成文件。

## 2. Manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A focused Qx module",
  "author": "Your Name",
  "icon": "icon.png",
  "screenshots": ["screenshot-1.png"],
  "platforms": ["macos", "windows"],
  "keywords": ["example"],
  "permissions": ["http", "storage"],
  "entry": "index.js",
  "preferences": [
    {
      "id": "apiKey",
      "label": "API Key",
      "type": "password",
      "required": true
    }
  ],
  "commands": [
    {
      "name": "refresh",
      "title": "Refresh"
    }
  ],
  "shortcuts": [
    {
      "command": "refresh",
      "key": "CommandOrControl+Shift+R",
      "enabled": false
    }
  ],
  "panel": {
    "title": "My Plugin",
    "keywords": ["dashboard"]
  },
  "storage": {
    "cacheTargets": ["feed-cache"]
  },
  "homeWidgets": [
    { "id": "cpu", "source": "system.cpu" }
  ],
  "min_app_version": "0.6.28",
  "pubkey": "",
  "signature": ""
}
```

| 字段 | 必填 | 说明 |
|---|---:|---|
| `id` | 是 | 全局唯一、稳定的小写连字符 ID |
| `name` | 是 | 显示名称 |
| `version` | 是 | SemVer |
| `description`, `author` | 否 | 市场与设置页信息 |
| `icon`, `screenshots` | 否 | 包内相对路径 |
| `platforms` | 否 | `macos`、`windows`、`linux` 的去重数组 |
| `keywords` | 否 | 搜索别名 |
| `permissions` | 否 | 最小能力集合 |
| `entry` | 否 | ESM 入口，默认 `index.js` |
| `preferences` | 否 | 宿主设置表单 |
| `commands` | 否 | 可搜索命令 |
| `shortcuts` | 否 | 用户可启用的全局命令快捷键 |
| `panel` | 否 | 注册面板入口 |
| `storage.cacheTargets` | 否 | 可重建缓存的精确 persist key 白名单 |
| `homeWidgets` | 否 | 将宿主支持的语义系统数据源关联到本插件 Panel；不提供视觉代码 |
| `min_app_version` | 否 | 最低 Qx 版本 |
| `pubkey`, `signature` | 否 | 可选 ed25519 签名 |

### Preferences

支持 `string`、`password`、`number`、`boolean`、`select`。宿主统一绘制控件，插件不要另做
设置页来保存同一字段。密码值不得写入日志或市场索引。

### 导出一致性

- Manifest 中每个 command 必须在 `index.js` 默认导出的 `commands` 中存在，反之亦然。
- `manifest.panel` 存在时默认导出必须包含 `panel`。
- command name、preference id 和插件 id 发布后保持稳定。
- 全局快捷键默认应关闭，由用户明确启用。

### Home Widgets

`homeWidgets[]` 当前只接受 `system.cpu`、`system.memory`、`system.power`、
`system.network`。`id` 在插件内稳定且唯一。该声明表示用户激活对应 Home 卡片时可打开
插件 Panel；数据采样、缓存、布局、主题、键盘和点击反馈都由 Qx 宿主负责。插件不能通过
该字段注入 DOM、CSS、颜色、刷新周期或固定像素尺寸。未安装插件时基础系统卡片仍可使用。

默认导出和 Workbench 最小示例见
[`plugin-development-guide.md`](./plugin-development-guide.md)。

## 3. 权限

只申请业务实际使用的能力。常见类别包括 HTTP、storage、CLI、system、invoke、Island、
Tray、通知、剪贴板和打开 URL。确切权限名以当前脚手架、宿主能力提示和安装确认页为准。

权限声明不等于无限访问：

- 存储限定插件命名空间；
- HTTP 仍受宿主请求策略约束；
- CLI 与 system 使用专用端口；
- invoke 只能调用登记命令；
- 平台不支持时返回 unavailable。

端口安全语义见 [`plugin-system.md`](./plugin-system.md)。

## 4. 市场仓库

标准仓库同时托管索引和包：

```text
index.json
plugins/
  my-plugin/
    my-plugin-1.0.0.qx-plugin
```

索引条目至少包含插件身份、版本、说明、平台、兼容版本和 `download_url`。URL 可以是绝对
HTTPS 地址，也可以是相对索引的包路径。镜像应保持 `index.json` 与包版本原子同步。

建议发布流程：

1. 本地冷安装 `.qx-plugin` 并验证 Manifest/导出一致性。
2. 生成包并计算仓库要求的摘要或签名。
3. 把不可变版本包上传到插件仓库。
4. 更新 `index.json` 的版本、兼容范围和下载地址。
5. 提交 PR，附跨平台与权限说明。
6. 合并后从真实市场源安装一次。

不要覆盖已经发布的同版本包；修复后递增版本。

## 5. 多源与下载回退

Qx 可配置官方源、镜像源或自托管索引。一个源可以填写：

- 指向 `index.json` 的 HTTPS URL；
- 能解析到索引的仓库/镜像根地址；
- 开发时的本地索引路径。

安装器按已配置源解析包地址，并在允许的镜像之间回退。回退只改变下载来源，不跳过包
身份、兼容、权限、摘要或签名校验。

## 6. 安装方式

- 市场安装：读取索引并显示权限与兼容信息。
- 本地文件：选择 `.qx-plugin`，走同一验证路径。
- URL 安装：下载后走同一验证路径。
- 开发目录：仅用于开发者模式，支持 Reload Panel。
- Raycast 导入：仅用于冻结转换器的历史实验，见
  [`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md)。

升级应保留兼容的 preferences 与持久数据。卸载是否清理数据必须是显式用户选择。

## 7. 签名

签名是可选的来源真实性证明，不能替代权限和运行时隔离。私钥只保存在发布者环境；
仓库只保存公钥和签名。签名输入应覆盖发布包的确定性字节或仓库规定摘要。

## 8. 发布检查

- [ ] 包结构完整，入口可从冷安装加载。
- [ ] Manifest 与导出命令、Panel 一致。
- [ ] id 稳定，版本和 `min_app_version` 合法。
- [ ] platforms 无重复且真实验证。
- [ ] 权限最小，快捷键默认关闭。
- [ ] 包内无密钥、缓存和临时文件。
- [ ] 索引下载地址指向不可变版本包。
- [ ] 市场源与镜像都执行相同校验。

插件界面规范见 [`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)；CLI 协议见
[`plugin-cli-protocol.md`](./plugin-cli-protocol.md)。

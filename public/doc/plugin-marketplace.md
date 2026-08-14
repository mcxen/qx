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
  "names": {
    "en": "My Plugin",
    "zh-CN": "我的插件"
  },
  "version": "1.0.0",
  "description": "A focused Qx module",
  "descriptions": {
    "en": "A focused Qx module",
    "zh-CN": "一个专注的 Qx 模块"
  },
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
      "labels": { "en": "API Key", "zh-CN": "接口密钥" },
      "type": "password",
      "required": true,
      "descriptions": { "en": "Key used for the API.", "zh-CN": "用于访问 API 的密钥。" }
    }
  ],
  "commands": [
    {
      "name": "refresh",
      "title": "Refresh",
      "titles": { "en": "Refresh", "zh-CN": "刷新" },
      "descriptions": { "en": "Refresh the data.", "zh-CN": "刷新数据。" }
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
    "titles": { "en": "My Plugin", "zh-CN": "我的插件" },
    "keywords": ["dashboard"]
  },
  "storage": {
    "cacheTargets": [{
      "id": "feed-cache",
      "label": "Feed cache",
      "keys": ["feed.latest.v1"],
      "keyPrefixes": ["feed.thread.v1."],
      "retentionDays": 7
    }]
  },
  "homeWidgets": [
    { "id": "cpu", "source": "system.cpu" }
  ],
  "surfaceProviders": [
    { "id": "brightness", "source": "system.display-brightness", "surfaces": ["tray", "home"], "presentation": "standard" },
    { "id": "rss", "source": "rss.unread-latest", "surfaces": ["home"], "titles": { "en": "Unread RSS", "zh-CN": "未读 RSS" }, "descriptions": { "en": "Latest unread feed posts", "zh-CN": "订阅源中的最新未读帖子" } }
  ],
  "min_app_version": "0.6.28",
  "pubkey": "",
  "signature": ""
}
```

| 字段 | 必填 | 说明 |
|---|---:|---|
| `id` | 是 | 全局唯一、稳定的小写连字符 ID |
| `name` | 是 | 默认显示名称；市场插件必须同时提供 `names.en` 与 `names.zh-CN` |
| `names` | 市场插件是 | 本地化名称；至少包含 `en` 与 `zh-CN` |
| `version` | 是 | SemVer |
| `description`, `author` | 否 | 默认描述与作者；市场插件提供描述时必须同时提供 `descriptions.en` 与 `descriptions.zh-CN` |
| `descriptions` | 市场插件是 | 本地化描述；至少包含 `en` 与 `zh-CN` |
| `icon`, `screenshots` | 否 | 包内相对路径 |
| `platforms` | 否 | `macos`、`windows`、`linux` 的去重数组；空或省略表示全平台。非空时宿主会从市场列表隐藏不匹配的包（例如 Windows 不展示 macOS-only 的 Homebrew），并拒绝安装与运行 |
| `keywords` | 否 | 搜索别名 |
| `permissions` | 否 | 最小能力集合 |
| `entry` | 否 | ESM 入口，默认 `index.js` |
| `preferences` | 否 | 宿主设置表单 |
| `commands` | 否 | 可搜索命令 |
| `shortcuts` | 否 | 用户可启用的全局命令快捷键；仅作默认声明，宿主将用户 override 存入 `settings.shortcuts` 的 `plugin:<pluginId>:<command>` |
| `panel` | 否 | 注册面板入口；`title` 应省略或与 `name` 相同，以便宿主使用 `names` 本地化 |
| `storage.cacheTargets` | 否 | 可重建缓存的 persist `keys` / `keyPrefixes` 白名单；用于固定列表和逐主题动态缓存 |
| `homeWidgets` | 否 | 将宿主支持的语义系统数据源关联到本插件 Panel；不提供视觉代码 |
| `surfaceProviders` | 否 | 声明宿主登记的轻量 Tray/Home 数据源；当前 Home 支持 `rss.unread-latest`，可用 `presentation` 选择 `compact` / `standard` / `wide`，不加载插件入口、不提供视觉代码 |
| `min_app_version` | 否 | 最低 Qx 版本 |
| `pubkey`, `signature` | 否 | 可选 ed25519 签名 |

### Preferences

支持 `string`、`textarea`、`password`、`number`、`boolean`、`select`、`segmented`、`slider`。
宿主统一绘制控件，插件不要另做设置页来保存同一字段。密码值不得写入日志或市场索引。

`label`、`description`、`placeholder` 是英文回退文本；对应的 `labels`、`descriptions`、
`placeholders` 可提供 `en` 与 `zh-CN` 映射。`options[]` 中的每项也可通过 `labels` 映射
本地化选项文字。例如：

```json
{
  "id": "region",
  "label": "Region",
  "labels": { "en": "Region", "zh-CN": "地区" },
  "type": "select",
  "options": [
    {
      "label": "Global",
      "value": "global",
      "labels": { "en": "Global", "zh-CN": "全球" }
    }
  ]
}
```

命令支持 `titles` / `descriptions`，面板支持 `titles`。社区插件发布前必须为每个实际
使用的字段提供 `en` 与 `zh-CN`；宿主不会维护按插件 ID 分散的兼容翻译，旧包缺字段时
只显示包内原始文本。

### 导出一致性

- Manifest 中每个 command 必须在 `index.js` 默认导出的 `commands` 中存在，反之亦然。
- `manifest.panel` 存在时默认导出必须包含 `panel`。
- command name、preference id 和插件 id 发布后保持稳定。
- 全局快捷键默认应关闭，由用户明确启用。插件 command 的快捷键可在 **设置 → 扩展 → 已安装 →
  插件 → Shortcuts** 中 Toggle、录制或恢复 manifest 默认值。它们属于插件 command，不是
  `app_shortcuts`，也不会把插件伪装成原生应用。

### Home Widgets

`homeWidgets[]` 当前接受 `system.cpu`、`system.memory`、`system.power`、
`system.network`、`system.display-brightness`。`id` 在插件内稳定且唯一。该声明表示用户激活对应 Home 卡片时可打开
插件 Panel；数据采样、缓存、布局、主题、键盘和点击反馈都由 Qx 宿主负责。插件不能通过
该字段注入 DOM、CSS、颜色、刷新周期或固定像素尺寸。未安装插件时基础系统卡片仍可使用。

### Home Surface Providers

`surfaceProviders[]` 是不启动插件运行时的宿主数据端口。当前登记的 `rss.unread-latest` 返回
RSS 未读总数和有界的最新帖子投影；`agent.usage` 读取插件保存的归一化配额快照，只接受
服务商、剩余百分比、重置时间和更新时间，不读取 token、认证文件或原始响应。Qx 负责
本地缓存读取、节流、空态和卡片绘制。
插件可以声明 `surfaces: ["home"]` 让用户在 Home 三点菜单中选择该卡片；`titles`、
`descriptions` 必须同时提供 `en` 与 `zh-CN`，旧包缺少这些元数据时宿主不会按插件 id 维护
内置中文映射。Provider 不得携带命令、私有轮询、HTML/CSS 或任意数据结构；需要新的信息
能力时，先向 Qx 增加一个有界、可缓存、跨平台的宿主适配器和对应 manifest source。

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

1. 检查 `.qx-plugin` 包结构并验证 Manifest/导出一致性。
2. 逐条实际调用插件依赖的线上接口主路径，确认真实响应能被当前实现处理；不得用 mock
   或 fixture 结果替代。详细门禁见
   [`plugin-development-guide.md`](./plugin-development-guide.md#8-真实接口测试上架门禁)。
3. 生成包并计算仓库要求的摘要或签名。
4. 把不可变版本包上传到插件仓库。
5. 更新 `index.json` 的版本、兼容范围和下载地址。
6. 提交 PR，附跨平台与权限说明。
7. 合并后确认市场索引与插件包下载可用。

不要覆盖已经发布的同版本包；修复后递增版本。

## 5. 多源与下载回退

Qx 可配置官方源、镜像源或自托管索引。一个源可以填写：

- 指向 `index.json` 的 HTTPS URL；
- 能解析到索引的仓库/镜像根地址；
- 开发时的本地索引路径。

安装器按已配置源解析包地址，并在允许的镜像之间回退。回退只改变下载来源，不跳过包
身份、兼容、权限、摘要或签名校验。

### 5.1 GitHub 与 CNB 示例

在 **设置 → 扩展 → 插件库** 中配置（商店站「源配置」页同内容）：

| 源 | 名称示例 | index_url |
| --- | --- | --- |
| GitHub（默认） | `Qx Official` | `https://raw.githubusercontent.com/mcxen/qx-plugins/main/index.json` |
| CNB（国内） | `Qx CNB` | `https://cnb.cool/v.ip/qx-plugins/-/git/raw/main/index.json` |

CNB 也可填仓库根 `https://cnb.cool/v.ip/qx-plugins`，宿主会尝试 `raw/main/index.json`。
配置非 GitHub 索引后，若条目 `download_url` 仍指向 GitHub，安装器会 **优先尝试索引旁同名包路径**，再回退原地址。

### 5.2 已安装插件自动升级

设置中的「自动更新」默认开启。Qx 启动后的后台更新任务会刷新所有已启用的插件库，按插件
ID 汇总来源，并为每个已安装插件选择当前 Qx 版本和当前操作系统支持的最高版本。选择条件包括
`min_app_version`、`platforms`、严格递增的插件版本号和可用的包地址；不兼容、无法解析版本或
没有可验证更新包的插件保持原版本，不会降级。

下载后宿主会校验索引中的大小和 SHA256（若提供），再校验包内 Manifest 的插件 ID 与版本，最后
走与手动安装相同的 Qx 安装边界。插件偏好、持久数据和启用/禁用状态会保留；某个插件的索引、
下载或安装失败只记录在该插件的自动更新结果中，不会阻塞 Qx 本体更新或其他插件。用户明确关闭
「自动更新」后，Qx 和插件都不再执行这条后台更新链。

## 6. 安装方式

- 市场安装：读取索引并显示权限与兼容信息。
- 本地文件：选择 `.qx-plugin`，走同一验证路径。
- URL 安装：下载后走同一验证路径。
- **浏览器一键安装（deep link）**：网页通过自定义协议唤起 Qx，用户确认后走同一
  URL 安装路径。
- 开发目录：仅用于开发者模式，支持 Reload Panel。
- Raycast 导入：仅用于冻结转换器的历史实验，见
  [`raycast-plugin-conversion.md`](./raycast-plugin-conversion.md)。

### 6.1 浏览器 deep link

安装后的 Qx 注册自定义 scheme `qx://`（macOS `Info.plist` / Windows·Linux 运行时
注册）。商店页或任意网页可用：

```text
qx://plugins/install?url=https://raw.githubusercontent.com/mcxen/qx-plugins/main/brew.qx-plugin
qx://plugins/install?id=brew
qx://plugins/install?id=brew&index=https://raw.githubusercontent.com/mcxen/qx-plugins/main/index.json
```

短别名：`qx://install?url=…`、`qx://install-plugin?url=…`。

约束：

- `url` 必须是 **https** 包地址；Qx 仍执行包结构、兼容版本、权限与摘要校验。
- `id` 从当前已配置市场源的 `index.json` 解析 `download_url`。
- 安装前弹确认框（含权限列表，若索引中有）；取消不下载。
- 成功后打开 **设置 → 扩展** 并聚焦该插件。

本地调试（macOS，需已安装或 `tauri dev` 注册协议后）：

```bash
open 'qx://plugins/install?id=weather'
```

升级应保留兼容的 preferences 与持久数据。卸载是否清理数据必须是显式用户选择。

## 7. 签名

签名是可选的来源真实性证明，不能替代权限和运行时隔离。私钥只保存在发布者环境；
仓库只保存公钥和签名。签名输入应覆盖发布包的确定性字节或仓库规定摘要。

## 8. 发布检查

- [ ] 包结构完整，入口与 Manifest/导出一致。
- [ ] Manifest 与导出命令、Panel 一致。
- [ ] id 稳定，版本和 `min_app_version` 合法。
- [ ] platforms 无重复且真实验证。
- [ ] 权限最小，快捷键默认关闭。
- [ ] 已实际调用每条线上接口主路径；fixture/mock 仅用于回归测试。
- [ ] HTTP 已验证真实成功与错误响应；二进制协议额外验证压缩、Content-Type/Encoding 和前导字节。
- [ ] 包内无密钥、缓存和临时文件。
- [ ] 索引下载地址指向不可变版本包。
- [ ] 市场源与镜像都执行相同校验。

插件界面规范见 [`plugin-ui-guidelines.md`](./plugin-ui-guidelines.md)；CLI 协议见
[`plugin-cli-protocol.md`](./plugin-cli-protocol.md)。

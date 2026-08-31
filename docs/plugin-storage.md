# 插件存储当前契约

> 状态：Current · 适用版本：v0.6.103 · Owner：Core · 最后复核：2026-08-31
>
> 本文说明宿主目录、生命周期和清理边界。插件作者的 API 用法以 [`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md) 为准；迁移方案历史见 [`archive/plugin-storage-design-history.md`](./archive/plugin-storage-design-history.md)。

## 1. 物理目录

插件的可执行包与可持久数据必须分开：

```text
~/.qx/
├── plugins/<id>/              # 安装包：manifest、入口和静态资源
└── plugin-data/<id>/          # 用户/插件持久数据
    ├── preferences.json       # 宿主管理的插件偏好
    ├── storage.json           # context.storage.persist + 宿主 Workbench 快照
    └── files/                 # 插件受控文件区
```

`~/.qx/plugins/<id>/data/` 是旧版位置，只用于兼容读取和一次性迁移。新写入始终选择 `plugin-data/<id>`；代码不得重新把数据库或缓存放回包目录。

## 2. 逻辑表面

| 数据 | 当前端口 | 生命周期 |
|---|---|---|
| 用户偏好 | manifest preferences + 宿主 Settings | 跨升级保存，可在 Storage 中单独清理 |
| 业务持久状态 | `context.storage.persist` | 跨进程、跨升级保存，JSON key/value |
| 临时进程缓存 | `context.storage.session` | 只在当前 runtime 存活，不落盘 |
| Workbench 呈现快照 | 宿主自动管理 | 按插件与 cache scope 持久化，可重建 |
| 插件文件 | 受限 files 端口 | 位于 `plugin-data/<id>/files/`，不等于任意文件系统权限 |

插件不得直接写安装目录、猜测 `~/.qx` 路径或使用浏览器 localStorage 代替宿主端口。沙箱、直接 runtime 和 unavailable context 必须暴露相同的逻辑 API 形状。

## 3. 持久键与并发

持久值集中保存在 `storage.json`。宿主按插件 id 使用短时互斥锁，并以原子写替换文件；文件 I/O 在 blocking worker 中执行，不占用 React 或 Tokio 核心线程。

插件仍需保证业务顺序：

- 用稳定、带领域前缀的 key；不要把整个上游响应无限追加到一个对象。
- “最新快照”使用 `context.state.createLatestWriter` 串行落盘，防止慢旧请求覆盖新结果。
- 页面缓存使用 stale-while-revalidate、TTL 和明确上限；持久状态不能伪装成可随意清理的 cache。
- Workbench 自动快照只负责呈现恢复，业务原始响应、游标、已读状态和可操作文件仍由插件定义。

## 4. 可重建缓存登记

插件只可在 manifest 的 `storage.cacheTargets[]` 登记能安全重建的 `persist` key：

- `id`、`label` 标识设置页中的目标；
- `keys[]` 精确匹配固定键；
- `keyPrefixes[]` 覆盖按主题、帖子等生成的有界动态键；
- `retentionDays` 声明插件自己的自动淘汰窗口。

宿主校验声明、统计匹配值的 JSON 字节数和记录数，并只删除被登记的键。宿主管理的 Workbench 快照作为独立目标显示。未知 target、未声明 key、插件整个数据根和符号链接穿透必须被拒绝。

Settings → System → Storage Management 的“清理缓存”只遍历这些可重建目标，不删除 preferences、未登记的 persist、files 或其它插件数据。

## 5. 安装、升级与卸载

| 操作 | 包目录 | `plugin-data/<id>` |
|---|---|---|
| 首次安装 | 原子展开并校验包 | 创建独立数据目录 |
| 升级 / 重装 | 替换包 | 先迁移/暂存，再原样恢复 |
| 禁用 | 保留 | 保留 |
| 清理已登记缓存 | 保留 | 只删命中的可重建键 |
| Storage 中清理 scope | 保留 | 按 `preferences` / `persist` / `files` / `all` 明确执行 |
| 卸载 | 删除 | 当前默认一并删除，恢复为干净状态 |

安装路径会调用 `ensure_plugin_data_migrated`：若现代目录不存在而旧 `plugins/<id>/data` 存在，则整体移动到 `plugin-data/<id>`。升级包时使用临时 staging 保护数据；任何失败都不能把数据落在半覆盖的包目录里。

卸载会删除持久数据，因此 UI 必须把它作为明确的用户操作，不得把普通 Rescan、禁用或升级错误走成卸载。

## 6. 宿主管理接口

当前 Rust 边界位于 `src-tauri/src/marketplace/mod.rs`：

- `plugin_storage_get/set/delete/list/clear`：persist map；
- `plugin_preferences_get/set`：偏好；
- `plugin_data_usage`：preferences / storage / files / total 统计；
- `plugin_data_clear`：按明确 scope 清理；
- `registered_plugin_cache_targets` 与 `clear_registered_plugin_cache_target`：设置页缓存注册表；
- `install_plugin_*` / `uninstall_plugin`：包与数据生命周期。

前端和插件不要直接 invoke 这些内部命令绕过 `context.storage`、Settings 或权限适配；稳定公共表面是 `context.*`。

## 7. 变更检查

修改存储契约时必须同时核对：

- 安装、升级失败回滚、旧目录迁移、禁用与卸载；
- sandboxed/direct/unavailable plugin context 的替代一致性；
- Storage Management 的统计与清理使用同一 target 注册表；
- 并发 set、旧请求晚到、超大 JSON 与损坏文件的失败边界；
- `public/doc/` 的作者协议、IPC 基线以及 `npm run check` / `npm run build`。

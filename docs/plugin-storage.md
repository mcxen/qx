# 插件存储系统设计

> 状态：Current · 适用：Qx ≥ 0.5.26+ · Owner：Core  
> 作者侧端口摘要见 [`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md) §存储。  
> 本文定义**宿主如何存放、升级、清理**插件数据，便于长期维护。

---

## 1. 目标

| 目标 | 说明 |
|------|------|
| **代码与数据分离** | 重装 / 升级包**不丢** preferences 与 KV / 文件缓存 |
| **端口清晰** | 插件只见 `context.storage.*` / `getPreference` / 虚拟文件路径，不见盘符细节 |
| **可管理** | 宿主能列出占用、按插件清空、卸载时策略明确 |
| **可维护** | 单写路径、原子写、按插件加锁；禁止散落 localStorage 当持久库 |

### 非目标

- 跨设备同步  
- 加密保险箱（密钥由插件自行决定是否放 preferences）  
- 无限大 blob 对象存储（大文件用 `files/` 目录，不进 JSON KV）

---

## 2. 现状与问题

| 层 | 现状 | 问题 |
|----|------|------|
| 包目录 | `~/.qx/plugins/<id>/` 含 `manifest` + `index.js` + **`data/`** | 安装 `remove_dir_all` 整目录 → **升级抹掉用户数据** |
| Persist KV | `data/storage.json` 整文件读写 | 全局一把锁，插件互堵；无 list/clear |
| Preferences | `data/preferences.json` 整表覆盖 | 升级同样被删 |
| Session | 前端进程内 `Map` | 卸载插件未清 session 桶（泄漏可忽略） |
| 虚拟文件 | `plugin_file_*` → `…/data/files`（及 `/qx-home`） | 与 package 同树，升级风险同上 |
| Raycast Cache / background | iframe `localStorage` | 与插件 id 弱关联；难管理、难清 |

---

## 3. 目标布局（逻辑）

```text
~/.qx/
├── plugins/                      # 包（Package）— 可随时被 zip 覆盖
│   └── <plugin-id>/
│       ├── manifest.json
│       ├── index.js
│       ├── icon.png / assets…
│       └── .enabled
│
└── plugin-data/                  # 数据（Durable）— 升级保留
    └── <plugin-id>/
        ├── preferences.json      # 用户设置（schema 由 manifest.preferences 定义）
        ├── storage.json          # 插件 persist KV（JSON object）
        ├── meta.json             # 可选：schemaVersion、lastAccess、quota 提示
        └── files/                # 二进制 / 缓存文件（context 虚拟路径）
```

**兼容期**：若 `plugin-data/<id>` 不存在，继续读 `plugins/<id>/data/`；写入时优先写 **`plugin-data/<id>`**，并在升级路径迁移旧目录。

虚拟路径（插件侧不变）：

| 虚拟前缀 | 物理根 |
|----------|--------|
| `/qx-plugin-files/<id>/…` | `plugin-data/<id>/files/…` |
| `/qx-home/…`、`~/…` | 用户主目录（已有） |

---

## 4. 存储命名空间（端口）

插件作者只认 **四个命名空间**，不要混用：

```text
┌──────────────────────────────────────────────────────────┐
│ context.getPreference / Settings UI                      │  preferences
│  → 用户显式配置（token、路径、开关）                         │
├──────────────────────────────────────────────────────────┤
│ context.storage.persist                                  │  persist KV
│  → 业务状态、列表缓存元数据、跨重启标记                       │
├──────────────────────────────────────────────────────────┤
│ context.storage.session                                  │  session KV
│  → 进程内内存：首屏缓存、分页游标（重启即失）                  │
├──────────────────────────────────────────────────────────┤
│ plugin_file_* / 虚拟路径                                 │  files
│  → 图片、下载、墙纸缓存等大对象                              │
└──────────────────────────────────────────────────────────┘
```

| 命名空间 | 生命周期 | 建议用途 | 不建议 |
|----------|----------|----------|--------|
| **preferences** | 用户控制；卸载默认删 | API key、目录、开关 | 高频写计数器 |
| **persist** | 跨重启；卸载默认删 | 同步游标、小 JSON 状态 | 数 MB 的 base64 图 |
| **session** | 进程内 | UI 临时态 | 当持久库 |
| **files** | 跨重启；卸载默认删 | 二进制 | 密钥明文无加密 |

**Raycast shim**：`LocalStorage` / `Cache` 应映射到 **persist**（或 files），禁止依赖浏览器 `localStorage` 作为唯一持久层（宿主升级清站数据会丢）。

---

## 5. 生命周期

| 事件 | Package (`plugins/`) | Data (`plugin-data/`) |
|------|----------------------|------------------------|
| **首次安装** | 解压 zip | 创建空目录 |
| **升级 / 重装同 id** | 整包替换 | **保留**；可选 `meta.schemaVersion` 迁移 |
| **禁用** | 保留 | 保留 |
| **卸载** | 删除 | **默认删除**；高级选项「保留数据」可后续做 |
| **清除数据** | 不动 | 按 scope 清空（UI / API） |

### 升级算法（必须）

```text
1. validate id, parse manifest
2. backup = move plugin-data/<id> OR plugins/<id>/data  aside (if any)
3. remove plugins/<id>  package tree only
4. extract zip → plugins/<id>
5. restore backup → plugin-data/<id>  (never extract zip over data)
6. write .enabled
```

---

## 6. 宿主 API（管理与插件）

### 6.1 插件端口（作者）

```ts
context.storage.persist.get/set/delete(key)
context.storage.persist.keys?()          // 可选：列举
context.storage.persist.clear?()         // 可选：清空本插件 persist
context.storage.session.get/set/delete
context.getPreference(id)                // 单键；宿主从 preferences.json
// 批量写 preferences 仅 Settings UI / plugin_preferences_set
```

### 6.2 管理端口（设置页 / 诊断）

| Command | 作用 |
|---------|------|
| `plugin_storage_get/set/delete` | 已有 KV |
| `plugin_storage_list` | 列出 key + 近似字节 |
| `plugin_storage_clear` | 清空 persist KV |
| `plugin_preferences_get/set` | 已有 |
| `plugin_data_usage` | preferences + storage + files 占用 |
| `plugin_data_clear` | `scopes: ["preferences"\|"persist"\|"files"\|"all"]` |

前端 Settings → 插件详情可展示 **占用** 与 **清除数据**（后续 UI）。

### 6.3 并发

- **按 plugin id 加锁**（不要全局一把锁堵所有插件）。  
- 写 `storage.json` / `preferences.json` 使用 **atomic_write**（先写临时文件再 rename）。

### 6.4 配额（软限制，可演进）

| 项 | 建议默认 |
|----|----------|
| persist JSON 总大小 | 2–8 MB 警告 |
| 单 key 值 | ≤ 512 KB（更大走 files） |
| files 目录 | 按插件声明或全局 soft cap |

超限：写失败返回明确错误字符串，不静默截断。

---

## 7. 键名约定（插件侧）

```text
<domain>.<name>           例：sync.cursor、ui.selectedTab
cache.<resource>.v1       可整体 clear 的缓存前缀
raycast-cache:<ns>:<key>  转换 shim 专用前缀（若落 persist）
```

避免无前缀的 `a`/`tmp`；便于 `keys().filter(k => k.startsWith("cache."))` 局部清理。

---

## 8. 实现分期

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | 重装/升级**保留** `data/`（及将来的 `plugin-data/`） | **本变更实现** |
| **P0** | 设计文档 + 作者手册存储章节 | **本变更** |
| **P1** | `plugin_storage_list/clear`、`plugin_data_usage/clear` | **本变更 API** |
| **P1** | 数据根迁移到 `~/.qx/plugin-data/<id>`，读路径双查 | 后续 |
| **P2** | Settings UI 展示占用 / 一键清除 | 后续 |
| **P2** | Raycast Cache → persist 映射，去掉 iframe localStorage 依赖 | 后续 |
| **P3** | 配额强制、export/import 用户数据 zip | 可选 |

---

## 9. 测试清单

- [ ] 安装插件 → 写 preference + storage key → 再装同 id 新 zip → 数据仍在  
- [ ] 卸载 → package 与 data 均删除（默认）  
- [ ] 两插件并发 `storage.set` 不互相丢键  
- [ ] `plugin_data_usage` 数字合理  
- [ ] `plugin_data_clear({ scopes: ["persist"] })` 不动 preferences  

---

## 10. 相关代码

| 区域 | 路径 |
|------|------|
| 安装 / 存储命令 | `src-tauri/src/marketplace/mod.rs` |
| 虚拟文件 | `src-tauri/src/plugin_api.rs`（`plugin_file_*`） |
| RPC | `src/plugin/rpcMethods.ts` |
| Context | `src/plugin/context.ts` / `runtime.ts` / `types.ts` |
| 作者文档 | `public/doc/plugin-development-guide.md` |

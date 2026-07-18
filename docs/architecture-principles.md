# 架构与接口原则（SOLID）

> 状态：Current · 适用版本：v0.5.18+ · Owner：Core · 最后复核：2026-07-15

本文约定 Qx 在**抽象边界、接口形状、模块依赖**上的长期标准。  
实现功能时优先满足这些原则；文档与代码同级演进——改边界时同步改文档，禁止文档落后成「历史实现说明」。

## 1. 文档义务

| 变更类型 | 必须更新 |
|---|---|
| 新增/调整公共接口（TS type、Rust command、RPC method、plugin context） | 对应架构文档 + `ipc-catalogue` / plugin doc |
| 新增抽象层（session store、host API、converter shim） | 本文件相关条目 + 领域文档（island / plugin / shell…） |
| 权限、manifest、市场契约 | `public/doc/plugin-development-guide.md`（作者）+ `plugin-cli-protocol.md` + `plugin-architecture` |
| 仅内部重构且接口不变 | 可不改文档；但不得悄悄扩大 public surface |

原则：**接口是契约，文档是契约的可读副本。** 抽象要稳，文档要比实现更「意图清晰」，而不是堆实现细节。

## 2. SOLID 在本项目中的落点

### S — Single Responsibility（单一职责）

一个模块/类型只做一个变化理由。

| 层 | 只负责 | 不负责 |
|---|---|---|
| `QxShell` | 窗体 chrome、键盘/Actions 呈现 | 业务状态、领域数据 |
| Feature view（Launcher / RSS / Settings） | 该功能状态与内容 | 全局 Esc 级联、平台 API |
| `src/plugin/rpcMethods.ts` | RPC 方法分发与权限断言 | UI 渲染 |
| Rust feature module | 领域行为 + 序列化模型 | App 生命周期编排（归 `lib.rs`） |
| Platform adapter | OS 专有调用 | 跨端业务规则 |

新增文件时先问：它的「唯一变化原因」是什么？说不清就拆。

### O — Open/Closed（对扩展开放，对修改封闭）

通过**注册与适配**扩展，而不是改核心 switch 长尾。

- 内置模块：`catalog` / `builtin` 注册，避免在 `App.tsx` 堆业务分支。
- Home 灵动岛模式：`home-island/registry` + content-only modes。
- Island session：producer 推 session / 注册 action；surface 只订阅。
- Raycast 转换器处于 Frozen 状态，仅保留历史入口；正式插件从上游源代码出发，直接依赖 Qx host ports，不继续扩展 converter shim。
- 设置页：tab 导航 + 独立 `*Settings.tsx`，不要把所有表单塞进一个文件。

允许在 composition root（`lib.rs`、`App.tsx`、converter entry）做有限组装；禁止在领域深处为「再加一个 case」无限膨胀。

模块拆分以领域边界和变更原因优先，不为压缩行数制造碎片文件。单个源文件不得超过 1000 行；被多个功能消费或属于 Qx 产品基础设施的能力应提升为根级核心服务，功能模块只保留自身工作流与呈现语义。

### L — Liskov Substitution（可替换性）

同一抽象的实现必须可互换且不破坏调用方约定。

- 前后端：同一 Tauri command 在 macOS / Windows 返回**同一 JSON 形状**；差异收敛在 adapter 内部。
- 插件 context：真实 context 与 `createUnavailableContext` 在方法集上对齐；不可用实现失败方式可预期（throw / reject），不默默 no-op 关键契约。
- Island Surface：`docked` / float 消费同一 `IslandSession` 语义，不因 placement 改变 action 含义。
- HTTP / file / AppleScript 等 host 能力：版本升级只**扩展**字段（如 `bodyBase64`），不悄悄改成功路径语义。

### I — Interface Segregation（接口隔离）

调用方只依赖它需要的窄接口。

- 插件：权限按能力拆分（`http`、`invoke:…`），不给「超级 context」。
- Frontend host API：shell / island / plugin 各自最小 surface，避免一个 `GodHost` 包办一切。
- Rust：public command 参数只含该命令所需字段；内部 helper 不要泄漏到 `invoke` 签名。
- Converter shim：按包隔离（`@raycast/api`、`fs-extra`、`node-fetch`），禁止巨型万能 polyfill 绑死所有扩展。

新增 API 时默认**最窄可用**；需要更宽能力时显式加接口，而不是给所有人放大权限。

### D — Dependency Inversion（依赖倒置）

高层策略依赖抽象，不依赖低层细节。

```text
  Feature / Agent / Plugin runtime     （高层）
              │
              ▼  stable ports
  commands · context · session hostApi · i18n useT
              │
              ▼
  Rust services · OS adapters · iframe RPC · marketplace
```

- 前端不 `cfg` 选 Win32/AppKit；只 `invoke` 稳定命令。
- 业务代码不直接 `fetch` 外网装插件；走 market/host 管线。
- Island content 不依赖 shell DOM 结构；只依赖 session + action registry。
- 设置文案依赖 `useT(key, fallback)`，不散落硬编码中文/英文分支。

## 3. 抽象层次（从稳到变）

由稳到变，依赖只能**向下或向侧向 port**，禁止上层细节倒灌：

1. **契约层**：manifest schema、RPC method 名、command 入参/出参、权限字符串  
2. **领域层**：session、插件生命周期、搜索结果模型、设置 store 形状  
3. **应用层**：各 Settings 页、Launcher orchestration、Agent 任务编排  
4. **适配层**：platform `#[cfg]`、Raycast shim、asset URL、path rewrite  
5. **呈现层**：React 组件、CSS token、动画  

文档描述优先写 1–2 层的**意图与不变量**；5 层细节留给 UI_SPEC / 组件注释。

## 4. 接口设计检查清单

合并前对新增 public surface 自问：

- [ ] **命名**表达能力，不表达实现（`plugin_http_fetch` 而非 `reqwest_get`）  
- [ ] **入参/出参**可版本化；破坏性变更有 `min_app_version` 或 schema_version  
- [ ] **错误**可区分权限失败 / 用户取消 / 系统不可用  
- [ ] **副作用**写在文档（写盘、弹系统面板、改全局快捷键）  
- [ ] **测试/验证**路径：至少一种手动或脚本复核  
- [ ] **文档**已更新且索引页可检索  

## 5. 与现有子系统的对照

| 子系统 | 文档 | SOLID 要点 |
|---|---|---|
| Shell / 快捷键 | `shell-and-shortcuts.md`, `shortcut-registry.md` | S：键盘策略集中；O：注册表扩展动作 |
| Island | `qx-island-architecture.md` | D：session 倒置；I：slot/action 窄接口 |
| 插件 | `plugin-architecture.md`, `public/doc/raycast-plugin-conversion.md` | O：host+converter 扩展；L：跨端 command 同形 |
| 设置 / i18n | `settings-panel.md`, `src/i18n.ts` | I：按页拆分；D：文案依赖 key 而非组件内写死语言 |
| IPC | `ipc-catalogue.md` | 契约单一事实来源 |
| **系统能力** | `display.rs` · `desktop_windows.rs` · `media/` · `clipboard` · `runtime/` · FE `src/system/*` | S：发现/媒体/剪贴板/线程调度各管一责；D：feature 只依赖端口；禁止在 screencap/OCR 内复制 xcap 枚举 |
| **Runtime 线程** | [runtime-threading.md](./runtime-threading.md) | UI 只在主线程；重活 `blocking`；async command 用 `runtime::ui` 一次事务 |

### 系统能力提升规则（与 AGENTS Module Decomposition 对齐）

凡属 **多功能复用** 或 **产品基础设施** 的能力，必须落在 `src-tauri/src/` 根级服务 + 可选 `src/system/` 前端端口，而不是功能模块私有实现：

| 能力 | 根级服务 | 公共 IPC / 端口 |
|---|---|---|
| 显示器枚举与映射 | `display` | `display_list` / `src/system/display.ts` |
| 顶层窗口清单与几何 | `desktop_windows` | `desktop_windows_list` / `src/system/desktopWindows.ts` |
| 区域 still-frame 抓帧 | `display::capture_region` | 内部 API（工作流封装） |
| 磁盘图写剪贴板 | `clipboard` | `clipboard_write_image_file` / `src/system/clipboard.ts` |
| 视频/GIF 编解码 | `media/` | 既有 convert 命令 |
| 主线程 UI / 后台算力 | `runtime/` | `runtime::ui` · `runtime::blocking` · `runtime::install`（见 runtime-threading.md） |

Feature（如 `screencap`）只保留：**session / 工作流 / 历史 / UI 语义**。旧名 `screencap_list_*` 可作为薄门面保留，新代码必须走系统命令。

## 6. 反模式（禁止）

- 为「一个插件」在 host 写死业务分支，而不是能力端口  
- 把 Raycast runtime/shim 结构继续带入正式插件，而不是提取业务意图后按 Qx 协议重写
- God Object：`App.tsx` / 单文件 Settings 无限增长  
- 前端 `if (mac) … else if (win) …` 实现业务差异  
- 文档只贴代码片段、不写不变量与边界  
- 接口「先 any 再说」或 RPC 载荷无类型文档  

## 7. 变更系统（禁止「一个一个单独改」）

问题要在**端口 / 注册表 / 字典 / 转换器**上一次性解决，再让消费者受益。

| 错误做法 | 正确做法 |
|---|---|
| 每个插件私建一套下载实现 | 修 `plugin_http_fetch`，再让所有第一方插件直接消费该 Qx port |
| 设置页逐行硬编码中文 | `useT(key, enFallback)` + `src/i18n.ts` zh 表；`npm run check:i18n` |
| 每个模块复制 Esc / 快捷键逻辑 | `useEscBack` / shortcut registry / shell ports |
| 文档随口补一段、与代码脱节 | 契约与实现同 PR；`npm run check` |

### 标准流水线

```text
1. 定位端口（host command / context / session / i18n key 前缀 / converter shim）
2. 更新契约文档（本文件 + 领域 doc）
3. 在端口实现一次
4. npm run check          # architecture + docs + i18n + shell + island
5. 需要时 tsc / cargo check
6. 发版前 docs README 版本头
```

### 统一检查入口

```bash
npm run check                 # 全部闸门
npm run check:architecture    # SOLID 文档链接、host 二进制 port、settings useT…
npm run check:i18n            # 全 src 静态 t("key") 必须在 zh 字典
npm run docs:check            # 版本一致、IPC baseline、链接、禁原生控件
```

Agent 与贡献者：**默认跑 `npm run check`**，不以「改了一个文件看起来好了」收工。  
评审以契约与 SOLID 检查清单为准，而不是以「能跑」为唯一标准。

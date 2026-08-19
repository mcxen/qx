# Module Surfaces — 主搜索直达模块子界面

> 状态：Current · 适用版本：v0.6.97 · Owner：Core · 最后复核：2026-08-19
> 事实来源：`src/search/moduleSurfaces.ts`、`src/components/QxShell.tsx`、`src/App.tsx`、`src/modules/settings/store.ts`、`src/modules/*`

## 1. 目标

用户在 **主搜索（Launcher）** 里不仅能打开模块根界面，还能直接命中模块内暴露的 **子界面 / 对象**，例如：

- 搜订阅源名 → 进入该源文章列表
- 搜剪贴板内容 → 由 Launcher 剪贴板 Provider 定位历史项
- 搜 AI 会话名 → 打开该会话
- 搜宏名称 → 播放宏

并在 **Settings → General → Module Search** 按模块开关是否接入主搜。

## 2. Raycast 对照

| Raycast | Qx |
|---|---|
| Extension | 内置模块 / 插件 |
| Command（manifest） | **仅真实动作**；纯「打开面板」不注册 command（panel 关键词已可搜） |
| Command arguments | `ModuleLaunch.params` |
| Deeplink | `__qx:launch:<json>` + 进程内 pending |
| 根搜索动态行 | `searchModuleSurfaces(query)`（深链动作 / 动态对象，不含 root open） |
| useNavigation push | 模块 store 的 `view` / `openFeed` 等 |

Raycast **不会**把 List 每一行动态行默认塞进根搜索；动态对象需要 provider 或 arguments command。Qx 用 **Module Surface provider** 表达同一意图。

**不冗余原则：** 已有 panel 的模块/插件（如 sysinfo、剪贴板）不得再暴露仅用于打开 panel 的 `open-*` command；主搜命中 panel 名称即可进入。插件作者必须在 manifest 和运行时入口中遵守这一约束，宿主不再维护按名称猜测的兼容过滤。

## 3. 核心类型

```ts
type ModuleLaunch = {
  tab: string;       // "rss" | "clipboard" | "qx-ai" | ...
  surface: string;   // "root" | "feed" | "chat" | "play" | ...
  params?: Record<string, string | number | boolean | null>;
};

type ModuleSurfaceHit = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  score: number;
  launch: ModuleLaunch;
  moduleId: ModuleSearchModuleId;
};
```

### 路径

```text
__qx:launch:<url-encoded JSON ModuleLaunch>
```

兼容别名：`__qx:rss:feed:<id>`。

### 打开协议

```text
openItem(path)
  → parseModuleLaunchPath
  → setPendingModuleLaunch(launch)
  → setTab(launch.tab)
  → 模块 mount：takePendingModuleLaunch(tab)
  → 落地 surface（openFeed / selectConversation / …）
```

Pending 是 **一次性** 的，避免陈旧参数。

## 4. QxShell 与模块的关系

QxShell **不负责** 主搜索引，只负责模块打开后的：

- Esc 级联
- Actions 菜单（`Cmd+K` / `Ctrl+K`）
- 列表 navigation
- 焦点恢复

模块接入主搜时：

1. 在 `moduleSurfaces.ts` 增加 provider（打分 + 返回 `ModuleSurfaceHit`）
2. 在模块入口 `useEffect` 中 `takePendingModuleLaunch` 并应用
3. （可选）在模块 Actions 中暴露与 surface 同名的能力，保证键盘与搜索语义一致

## 5. 已接入模块

| 模块 | 动态 surface | 静态 / 命令 surface | Pending 落地 |
|---|---|---|---|
| **RSS** | 订阅源 title/url/folder | Open / Add Feed / Import OPML | `openFeed`；add/import 打开对话框 |
| **Clipboard** | Launcher 专用慢 Provider：历史项文本/文件名 | Open Clipboard | 选中对应项 |
| **QxAI** | `QxAiSession` 持久化会话名 | Open / New Chat / Settings | `selectConversation` / `createConversation` / settings；活动会话可并发后台运行 |
| **Macros** | 已保存宏 | Open Macro Recorder | `playMacro(id)` |
| **Screencap** | GIF 历史文件名 | Open / Start Recording | `setPreview` / `startRecording` |
| **Documents** | — | Open / Clean / Markdown / JSON | 切换 mode |
| **Weather** | 设置中的地点 | Open Weather | 打开模块 |
| **V2EX** | — | Open / Hot / Latest | `setMode` + 拉列表 |

### 并发 / 禁止阻塞（硬性）

主搜必须保持可输入、可导航；surfaces **不得**挡在 `search_apps` 前面。

```text
doSearch (fast path)
  ├─ sync: plugin/builtin command 打分
  ├─ await search_apps          ← 关键结果尽快 applyResults
  └─ void loadModuleSurfaceProviders  ← fire-and-forget
        ├─ Promise.all(rss, macros, screencap, …)  // 并行 IPC
        └─ seq 校验后 merge 进当前 results（不覆盖 files 慢路径）
```

规则：

1. Provider 触达 Rust **只能** `await invoke`，禁止同步读盘 / 网络 / 大循环在主线程。
2. `searchModuleSurfaces` 内部用 `Promise.all` 并行，单模块失败/变慢不影响其它。
3. 调用方 **不得** `await searchModuleSurfaces` 再 `search_apps`。
4. 用 `searchSeq` 丢弃过期结果；慢结果不得盖掉新 query。
5. 与 files/clipboard 慢路径一样：先出快结果，再增量合并。
6. 模块开关是所有 Launcher 结果生产者的统一边界：provider 启动前检查一次，异步
   merge / 排序提交前再检查一次；sticky pin 与 30 天使用频率召回也必须经过同一
   `moduleSearchPolicy`，不能因为结果不是由 `moduleSurfaces.ts` 产生就绕过开关。
7. Clipboard 历史只能由 `App.tsx` 的专用慢 Provider 查询；Module Surfaces 只贡献
   Open Clipboard 根命令，避免同一次输入读取两次历史并生成重复候选。

主搜合并顺序（`App.tsx.doSearch`）：

1. **快路径**：sync synthetics（command/panel/calc）+ `search_apps` → 立即 `applyResults`
2. **并行增量**：module surfaces（void，不 await）
3. **防抖慢路径**：files / clipboard history（既有 260ms）

## 6. 设置：按模块开关

设置路径：**Settings → Search Settings → Launcher Search Sources**

```ts
module_search: {
  enabled: boolean;                          // 总开关；**新装默认 false**
  modules: Partial<Record<ModuleId, boolean>> // 总开关打开后，缺省 = true
}
```

行为：

| 开关 | 效果 |
|---|---|
| 总开关 off（**默认**） | 所有内置模块 command / panel / surface 不出现在主搜（剪贴板历史等不会污染搜索） |
| 某模块 off | 该模块的静态 command、panel、动态 surface、独立慢 Provider、sticky pin 与使用频率召回全部隐藏；模块本体和 Quick Entry 不受影响 |
| 插件（非 builtin） | **不受** 此开关影响（仍走插件注册表） |

Rust：`ModuleSearchSettings`（`settings/mod.rs`），`enabled` 的 serde 缺省为
`false`（新装 / 字段缺失）；已保存为 `true` 的用户配置升级后保持开启。

前端：`useSettingsStore().settings.module_search`；模块判定用
`isModuleSearchEnabled(moduleId)`，所有 Launcher entry 统一经过
`src/search/moduleSearchPolicy.ts`。总开关关闭时子开关保留各自真实值并禁用交互，
重新打开总开关后恢复此前逐模块选择。

## 7. 新增模块 checklist

1. `MODULE_SEARCH_MODULE_IDS` + `MODULE_SEARCH_LABELS`（`settings/store.ts`）
2. Rust `ModuleSearchSettings::default` 的 modules 列表补 id
3. `moduleSurfaces.ts` 写 provider + 尊重 `isModuleSearchEnabled`
4. 模块入口处理 `takePendingModuleLaunch`
5. General Settings 自动渲染 Toggle（由 ids 驱动）
6. 更新本文件表格

## 8. 与 QxShell Actions 的分工

| 入口 | 场景 |
|---|---|
| 主搜 surface | 从 **Launcher 冷启动** 直达对象 |
| 模块内 Actions（⌘K） | 已在模块内时的上下文操作 |
| `actions[]` + `primaryActionId` | 底栏高频主动作、Enter 与 Actions |

两者 label 尽量一致，但 **不要** 把主搜 provider 写进 QxShell。

## 9. 验证

- [ ] 搜 RSS 源名 → 进入该源文章列表
- [ ] Settings 关闭 RSS Module Search → 源与 Open RSS 都不再出现
- [ ] Settings 关闭 Clipboard Module Search → All / Clipboard scope、旧异步请求、
      sticky pin 和常用召回均不出现剪贴板历史；Quick Entry 与剪贴板模块仍可打开
- [ ] 总开关关闭 → 全部内置模块搜索结果消失
- [ ] 剪贴板 / AI 会话 / 宏 / GIF 历史 / Documents 模式 / V2EX Hot 可搜
- [ ] Esc 从深链落地后仍符合模块 `useEscBack` 级联

## 10. 后续

- QxAI surface 从 `~/.qx/QxAiSession/index.json` 与各 session 文件夹恢复，跨重启可用；附件由同一会话协议托管。
- 插件 API：`context.search.contribute(hits)`
- 文章级 RSS surface（注意噪声与上限）
- 文件夹拖拽管理 UI

# Module Surfaces — 主搜索直达模块子界面

> 状态：Current · 适用版本：v0.5.8 · Owner：Core
> 事实来源：`src/search/moduleSurfaces.ts`、`src/components/QxShell.tsx`、`src/App.tsx`、`src/modules/settings/store.ts`、`src/modules/*`

## 1. 目标

用户在 **主搜索（Launcher）** 里不仅能打开模块根界面，还能直接命中模块内暴露的 **子界面 / 对象**，例如：

- 搜订阅源名 → 进入该源文章列表
- 搜剪贴板内容 → 定位历史项
- 搜 AI 会话名 → 打开该会话
- 搜宏名称 → 播放宏

并在 **Settings → General → Module Search** 按模块开关是否接入主搜。

## 2. Raycast 对照

| Raycast | Qx |
|---|---|
| Extension | 内置模块 / 插件 |
| Command（manifest） | `plugin/builtin` 静态 command + panel 关键词 |
| Command arguments | `ModuleLaunch.params` |
| Deeplink | `__qx:launch:<json>` + 进程内 pending |
| 根搜索动态行 | `searchModuleSurfaces(query)` |
| useNavigation push | 模块 store 的 `view` / `openFeed` 等 |

Raycast **不会**把 List 每一行动态行默认塞进根搜索；动态对象需要 provider 或 arguments command。Qx 用 **Module Surface provider** 表达同一意图。

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
| **Clipboard** | 历史项文本/文件名 | Open Clipboard | 选中对应项 |
| **QxAI** | 当前会话名（内存列表） | Open / New Chat / Settings | `selectConversation` / `createConversation` / settings |
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
        ├─ Promise.all(rss, clipboard, macros, screencap, …)  // 并行 IPC
        └─ seq 校验后 merge 进当前 results（不覆盖 files 慢路径）
```

规则：

1. Provider 触达 Rust **只能** `await invoke`，禁止同步读盘 / 网络 / 大循环在主线程。
2. `searchModuleSurfaces` 内部用 `Promise.all` 并行，单模块失败/变慢不影响其它。
3. 调用方 **不得** `await searchModuleSurfaces` 再 `search_apps`。
4. 用 `searchSeq` 丢弃过期结果；慢结果不得盖掉新 query。
5. 与 files/clipboard 慢路径一样：先出快结果，再增量合并。

主搜合并顺序（`App.tsx.doSearch`）：

1. **快路径**：sync synthetics（command/panel/calc）+ `search_apps` → 立即 `applyResults`
2. **并行增量**：module surfaces（void，不 await）
3. **防抖慢路径**：files / clipboard history（既有 260ms）

## 6. 设置：按模块开关

设置路径：**Settings → General → Module Search**

```ts
module_search: {
  enabled: boolean;                          // 总开关
  modules: Partial<Record<ModuleId, boolean>> // 缺省 = true
}
```

行为：

| 开关 | 效果 |
|---|---|
| 总开关 off | 所有内置模块 command / panel / surface 不出现在主搜 |
| 某模块 off | 该模块的静态 command、panel 命中、动态 surface 全部隐藏 |
| 插件（非 builtin） | **不受** 此开关影响（仍走插件注册表） |

Rust：`ModuleSearchSettings`（`settings/mod.rs`），`#[serde(default)]`，旧配置文件可缺省升级。

前端：`useSettingsStore().settings.module_search`；判定用 `isModuleSearchEnabled(moduleId)`。

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
| secondaryAction Paste/Open | 底栏高频主/次操作 |

两者 label 尽量一致，但 **不要** 把主搜 provider 写进 QxShell。

## 9. 验证

- [ ] 搜 RSS 源名 → 进入该源文章列表
- [ ] Settings 关闭 RSS Module Search → 源与 Open RSS 都不再出现
- [ ] 总开关关闭 → 全部内置模块搜索结果消失
- [ ] 剪贴板 / AI 会话 / 宏 / GIF 历史 / Documents 模式 / V2EX Hot 可搜
- [ ] Esc 从深链落地后仍符合模块 `useEscBack` 级联

## 10. 后续

- QxAI 会话持久化后 surface 才跨重启可用
- 插件 API：`context.search.contribute(hits)`
- 文章级 RSS surface（注意噪声与上限）
- 文件夹拖拽管理 UI

# QxAI Chat UI Spec

> 状态：Current · 适用版本：v0.6.83+ · Owner：Frontend · 最后复核：2026-08-31
> **结构标杆**：[AI Elements](https://elements.ai-sdk.dev/)（Conversation / Message / Reasoning / Tool / PromptInput / Queue）  
> **视觉标杆**：[Beautiful UI](https://www.beautifului.dev/)（field 气泡、Thinking 时间线、stream caret、ink 发送方钮）  
> 实现落点：`src/modules/qx-ai/**`、`src/styles/qx-ai.css`  
> 与壳层关系：只约束 **对话工作台内容**；主壳仍以 [`UI_SPEC.md`](./UI_SPEC.md) 为准。

## 0. 原则（必须）

| 层 | 标杆 | 做法 |
|---|---|---|
| **结构 / 状态机** | AI Elements | 按零件拆：会话列、消息、思考、工具、输入、队列；思考默认收起为活动摘要，用户可展开完整时间线 |
| **视觉 / 密度** | Beautiful UI | 中性 field 用户气泡、轻时间线思考、竖线 caret、field 输入栏 + 28px ink 发送 |
| **主题** | Qx tokens | 只用 `--qx-*`；禁止暗色硬编码 fallback |
| **宿主** | QxShell | Top / Main / Bottom / Context；Esc 级联；不引入 Vercel AI SDK 运行时依赖 |

**禁止**整库安装 Beautiful UI 或 AI Elements runtime。可抄「协议与布局」，CSS/组件落在本仓库。

实现与本文冲突时：以代码为据并回写本文件。

---

## 1. 零件映射

| AI Elements | Beautiful UI 感觉 | Qx 实现 |
|---|---|---|
| Conversation | 居中阅读列 | `.qx-ai-conversation` + `.qx-ai-message-list` |
| ConversationContent | max ~760 列 | `.qx-ai-message-column` |
| Message | 用户 field 胶囊 / 助手裸文 | `.qx-ai-message` + `.qx-ai-message-bubble` |
| Reasoning | Thinking 触发条 + 时间线 | `.qx-ai-reasoning`（兼容 `.qx-jan-cot`） |
| Tool | 紧凑 chip → 展开卡片 | `.qx-ai-tool`（兼容 `.qx-jan-tool`） |
| PromptInput | field 底 + 方发送钮 | `.qx-ai-prompt` / `.qx-jan-composer` |
| Queue | 输入上方 chips | `.qx-ai-message-queue` |
| — | stream caret | `.qx-stream-caret` |

助手消息标题显示该回复生成时持久化的模型快照；修改默认模型或切换会话后续模型，不得把历史回复统一重标为当前模型。

DOM 上应同时带 **Elements 语义类** 与现有 jan 类（过渡期），例如：

```html
<div class="qx-ai-message is-assistant">
  <div class="qx-ai-reasoning qx-jan-cot is-streaming">…</div>
  <div class="qx-ai-message-bubble is-assistant">…</div>
</div>
<div class="qx-ai-prompt qx-jan-composer">…</div>
```

---

## 2. Workbench 布局（必须）

```text
QxShell (qx-qxai-chat-shell qx-content-shell is-workbench)
  Top: 会话搜索
  Main: .qx-ai-workbench
          QxResizableSplit
            ├─ 左: .qx-ai-conversation-list  (titles: fallback → AI 生成)
            └─ 右: .qx-ai-chat-detail
                    .qx-ai-conversation
                      ├─ .qx-ai-message-list (scroll)
                      │    └─ .qx-ai-message-column  (min(760px, 100%))
                      └─ .qx-ai-prompt-dock.is-docked-flow  (in-flow，禁止 absolute 盖消息)
  Context: 模型 / Reasoning / Tools / Actions
  Bottom: 主操作 | New | … | Esc
```

硬性规则：

1. `.qx-shell-content`：`flex` 列 + `min-height:0` + `overflow:hidden`（`qx-content-shell`）。
2. 高度链：`workbench → split → detail → conversation → message-list(flex:1)` 不断裂。
3. Composer **in-flow dock**，禁止 absolute 叠 transcript。
4. 消息列 `min(760px, 100%)` 居中。
5. 左列表默认 ~280px（持久化 `qx-ai.workbench.listWidth`），min ≥ 220；标题单行 ellipsis。
6. 发送、附件、模型能力、API key 与工具运行错误统一进入 Bottom Island `error` 状态；Composer、消息正文和工具收起行下方不得临时增长错误行。工具历史中的失败详情只在用户主动展开该步骤后显示。

### Esc

| 层 | 行为 |
|---|---|
| query | 清搜索 / 输入 / 附件错误 |
| leave | Launcher |
| Settings 子页 | 回 Workbench |

---

## 3. Message（气泡）

### 用户

- 右对齐，`width: fit-content`，列内 **≤ 80%**。
- **Beautiful UI**：`bg` ≈ field（`bg-component-2/3` mix），圆角 ~12px，细边框，轻阴影；**不是**实心 accent 块。
- 字号 ~13px / line-height 1.4；明暗均用 token。

### 助手

- 满列、无卡片壳；markdown 代码块限制最大高度并可独立滚动，头部保留语言、复制与长行换行操作，切换换行不得改写原始代码。
- 流式：内容末 **竖线 caret**（`.qx-stream-caret`），不用 `|` 字符硬编码。
- 完成后可显示 tokens/sec（仅完成态）。
- 消息日期使用 Qx resolved locale 的短格式和弱化的 10px 元信息样式；助手日期跟随左侧阅读流，用户日期贴合气泡右侧。日期常驻，操作按钮在 hover / focus 时于日期旁显示且不得引起正文或日期位移。
- 重新生成保留旧回复为同一条助手消息的候选版本；页脚左右切换时，正文、推理、工具步骤、附件和用量必须一起切换。发送给模型的上下文只包含当前候选，不携带候选版本元数据。重新生成失败或应用在生成中退出时恢复原消息，不允许用半截分支覆盖旧回复。

### 附件

- 不得 `min-width: 460px` 撑破气泡；`min-width: 0; max-width: 100%`。
- 多附件使用紧凑的可换行文件条；图片使用小缩略图，打开/定位/复制操作在 hover 或键盘焦点进入时显示。

---

## 4. Reasoning（思考）

对齐 Elements `Reasoning` + BUI Thinking：

1. 折叠触发：Sparkles + 标题（流式 shimmer「Thinking…」/ 完成「Thought for N seconds」）。
   完成态优先显示运行时记录的思考阶段耗时；旧消息没有该字段时才退回「Thought for a few seconds」。
2. 流式与完成态默认收起为一行；折叠行保持透明，只允许 hover / focus 出现轻量反馈；shimmer 只裁切在状态标题字形内，不得生成动画卡片背景。流式行在状态标题后显示最新一行思考或工具活动，超宽时裁切并跟随最新内容。活动变化用约 300ms 的有界纵向替换动画且采用 latest-wins；`prefers-reduced-motion` 下直接替换并停止 shimmer。用户可手动展开完整时间线，状态更新不得强制改写用户的展开选择。
3. 展开：左侧 **1px 时间线** + 步骤行（thought / tool / observation）；active 步骤使用
   accent 脉冲，complete/error 使用稳定状态图标，并尊重 reduced-motion。
4. 时间线内每条 thought / error 与每次 tool execution 都是独立折叠项，默认收起；
   运行中只更新状态和 spinner，不得强制展开参数、结果或长错误。用户展开某一项时不影响其它项。
5. 不要厚边框大卡片包住整块思考（避免 web 营销卡）。
6. 连续的 tool execution 可折叠为一个工具组摘要；展开后必须保留原始顺序、每项状态、参数和结果。

实现：`ReasoningPanel`（原 `JanChainOfThought`）+ `AgentStepsView`。

---

## 5. Tool

- 收起：与思考时间线一致的一行摘要（工具类别 + 状态 + 关键参数或结果摘要），超宽单行裁切；不使用独立厚卡片或 pill。命令、搜索、文件、网页、系统和模块工具使用稳定类别图标及语义字段（如 `command`、`query`、`path`、`url`），不直接倾倒 JSON。
- JSON 输入/结果只有在能提取语义字段时才进入折叠摘要；`{}`、`}`、`]`、逗号等结构字符不得单独显示在工具行右侧。完整结构化结果保留在展开内容中。
- 展开：轻边框参数/结果 pre。
- 嵌在 Reasoning 列表内时避免双重标题噪音。
- 连续两次及以上工具调用收成单个组行；组行展示数量、综合状态和最新活动，展开后仍逐项查看。
- 折叠箭头默认隐藏，仅在 hover、键盘焦点或已展开时显示；隐藏不能影响键盘可达性。

---

## 6. PromptInput（输入栏）

对齐 Elements `PromptInput` + BUI Prompt Bar：

1. 容器：~12px 圆角、field 底、hairline 边 + 轻阴影；focus 时 border 略加深（非重彩色光晕）。
2. 文本：13px / 1.4，placeholder tertiary。
3. 发送：**28×28** 方角钮；就绪 = `text-primary` 底 + 上箭头；禁用 = 中性灰底；排队中 = accent + ListPlus。
4. 附件按钮 ghost icon；队列在 composer **上方**。
5. token 占用与发送按钮组成右侧紧凑动作簇，垂直居中；不得让 token 按钮占据整条弹性中栏或漂在发送按钮上方。

---

## 7. Queue

- 在 prompt 上方，不进消息流。
- 点击文案 → 回填 composer 并离队；X 删除。
- 多条可滚，max-height 限制，避免顶破输入。
- 行内编辑/删除动作只在 hover 或 `focus-within` 显示，保留稳定列宽，避免出现时推动文案。

---

## 8. 会话标题（列表）

| 时机 | 行为 |
|---|---|
| 首条用户消息 | 本地兜底截断标题（`titleMode: auto`） |
| 首轮助手结束 | 后台 `g4f_chat` 生成短标题（失败保留兜底） |
| 用户手动改名 | `titleMode: manual`，不再覆盖 |

列表行：`grid minmax(0,1fr)` + `.qx-list-title-text` ellipsis；spinner 不挤标题。

---

## 9. 主题

- 只用 `--qx-text-*` / `--qx-border-*` / `--qx-bg-component-*` / `--qx-accent` / `--qx-shadow`。
- 禁止 `#12161f`、`#0f131a`、纯黑大阴影、仅暗色可用的 fallback。
- 用户气泡在 light/dark 下均需足够对比。

---

## 10. 验收清单

- [x] 左列表标题 ellipsis；首条消息后有兜底名，助手完成后可换成 AI 标题
- [x] 用户 field 气泡右对齐 ≤80%；助手满列裸文
- [x] 思考流式摘要 + shimmer；手动展开后时间线步骤可读
- [x] 流式 caret 为竖线
- [x] 输入 field 风格；发送 28px 方钮 + 箭头，附件/队列位于输入上方
- [x] Token Usage 显示上下文占用、输入/输出/总量，并优先使用供应商真实用量
- [x] 缺少 API Key 等启动前可判定错误直接阻止请求；失败运行只显示一次错误，不保存为助手正文
- [x] 旧会话中“错误 step 与 assistant 正文完全相同”的历史伪回复在加载时安全清理，正常消息不受影响
- [x] 自动标题必须含 Unicode 字母或数字；`???` / `�` 等损坏结果保留或恢复本地兜底标题
- [x] 思考步骤、执行步骤与错误步骤逐项独立折叠，包含运行态在内均默认收起
- [x] 思考活动按 latest-wins 单行滚动，reduced-motion 下不动画；连续工具调用可成组展开
- [x] 工具摘要按命令/搜索/文件/网页/系统/模块分类并优先显示语义参数
- [x] function-calling 多轮消息完整保留 `tool_calls` / `tool_call_id`，流式与兼容回退使用同一消息协议
- [x] 消息下显示日期，并提供复制、编辑、删除；助手末条支持重新生成
- [x] 消息日期按 resolved locale 以弱化短格式常驻，助手左对齐、用户右对齐；操作图标按 hover/focus 显示且不造成位移，使用无阴影、无毛玻璃的扁平 ghost 样式
- [x] 重新生成保留可切换候选；失败/中断恢复旧消息，候选元数据不发送给模型
- [x] 代码块可复制、切换长行换行并在最大高度内独立滚动
- [x] 已发送附件使用紧凑文件条/小缩略图，动作按 hover/focus 显示
- [x] 队列在输入上，点击回填或直接编辑
- [x] 亮色 / 暗色均正常，无死黑块
- [x] Esc / Bottom Bar 符合 UI_SPEC

---

## 11. 边界

| 归属 | 文件 |
|---|---|
| 壳、Esc、Bottom Island、token 色板 | `UI_SPEC.md` |
| 对话阅读 / 输入 / 队列 / 思考 / 标题 | **本文件** |
| Agent 运行时、记忆 SQLite、会话文件夹 | `docs/ai-agent-runtime.md` |

### 内容助手投影

RSS 等阅读表面可以把 QxAI 会话投影为右侧极简助手，但不得复制完整 QxAI Workbench。
入口必须来自当前对象的统一 Action；面板只保留标题、摘要/翻译/改写快捷入口、消息流、
输入框和草稿视图。上下文作为 system message 写入新建的后台会话，用户消息与助手回复继续
使用同一个持久会话协议，因此可从完整 QxAI Workbench 打开和续聊。关闭助手只关闭投影，
不得删除会话。

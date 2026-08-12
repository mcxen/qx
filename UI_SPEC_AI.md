# QxAI Chat UI Spec

> 状态：Current · 适用版本：v0.6.83+ · Owner：Frontend · 最后复核：2026-08-12
> **结构标杆**：[AI Elements](https://elements.ai-sdk.dev/)（Conversation / Message / Reasoning / Tool / PromptInput / Queue）  
> **视觉标杆**：[Beautiful UI](https://www.beautifului.dev/)（field 气泡、Thinking 时间线、stream caret、ink 发送方钮）  
> 实现落点：`src/modules/qx-ai/**`、`src/styles/qx-ai.css`  
> 与壳层关系：只约束 **对话工作台内容**；主壳仍以 [`UI_SPEC.md`](./UI_SPEC.md) 为准。

## 0. 原则（必须）

| 层 | 标杆 | 做法 |
|---|---|---|
| **结构 / 状态机** | AI Elements | 按零件拆：会话列、消息、思考、工具、输入、队列；流式时思考展开、结束可收 |
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

- 满列、无卡片壳；markdown 可滚动代码块。
- 流式：内容末 **竖线 caret**（`.qx-stream-caret`），不用 `|` 字符硬编码。
- 完成后可显示 tokens/sec（仅完成态）。

### 附件

- 不得 `min-width: 460px` 撑破气泡；`min-width: 0; max-width: 100%`。

---

## 4. Reasoning（思考）

对齐 Elements `Reasoning` + BUI Thinking：

1. 折叠触发：Sparkles + 标题（流式 shimmer「Thinking…」/ 完成「Thought for N seconds」）。
   完成态优先显示运行时记录的思考阶段耗时；旧消息没有该字段时才退回「Thought for a few seconds」。
2. 流式时 **默认展开**；完成后可保持用户操作结果。
3. 展开：左侧 **1px 时间线** + 步骤行（thought / tool / observation）；active 步骤使用
   accent 脉冲，complete/error 使用稳定状态图标，并尊重 reduced-motion。
4. 时间线内每条 thought / error 与每次 tool execution 都是独立折叠项，默认收起；
   运行中只更新状态和 spinner，不得强制展开参数、结果或长错误。用户展开某一项时不影响其它项。
5. 不要厚边框大卡片包住整块思考（避免 web 营销卡）。

实现：`ReasoningPanel`（原 `JanChainOfThought`）+ `AgentStepsView`。

---

## 5. Tool

- 收起：圆角 pill chip（工具名 + 状态）。
- 展开：轻边框参数/结果 pre。
- 嵌在 Reasoning 列表内时避免双重标题噪音。

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
- [x] 思考流式展开 + shimmer；时间线步骤可读
- [x] 流式 caret 为竖线
- [x] 输入 field 风格；发送 28px 方钮 + 箭头，附件/队列位于输入上方
- [x] Token Usage 显示上下文占用、输入/输出/总量，并优先使用供应商真实用量
- [x] 缺少 API Key 等启动前可判定错误直接阻止请求；失败运行只显示一次错误，不保存为助手正文
- [x] 旧会话中“错误 step 与 assistant 正文完全相同”的历史伪回复在加载时安全清理，正常消息不受影响
- [x] 自动标题必须含 Unicode 字母或数字；`???` / `�` 等损坏结果保留或恢复本地兜底标题
- [x] 思考步骤、执行步骤与错误步骤逐项独立折叠，包含运行态在内均默认收起
- [x] function-calling 多轮消息完整保留 `tool_calls` / `tool_call_id`，流式与兼容回退使用同一消息协议
- [x] 消息下显示日期，并提供复制、编辑、删除；助手末条支持重新生成
- [x] 消息日期常驻，操作图标按 hover/focus 显示；图标使用无阴影、无毛玻璃的扁平 ghost 样式
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

# QxAI Chat UI Spec（Jan 对齐标杆）

> 状态：Current · 适用版本：v0.6.80+ · Owner：Frontend · 最后复核：2026-08-12
> 标杆来源：本地 Jan 源码 `Documents/OpenSpring/jan`（`ChatInput.tsx` / `MessageItem.tsx` / `QueuedMessageBubble.tsx` / `TokenSpeedIndicator.tsx` / `routes/threads/$threadId.tsx`）
> 实现落点：`src/modules/qx-ai/**`、`src/styles/qx-ai.css`
> 与壳层关系：本文件只约束 **对话工作台内容**；主壳仍以 [`UI_SPEC.md`](./UI_SPEC.md) 为准。

QxAI 的对话区目标：在 **QxShell 桌面工具壳** 内，复现 Jan 聊天窗口的 **阅读节奏、气泡层次、输入区一体感与队列交互**，同时不破坏 Qx 的 Top/Main/Bottom 与 Context 协议。

实现与本文冲突时：以代码为据并回写本文件；**视觉/交互新改动必须先满足本标杆**。

---

## 1. 参考：Jan 窗口解剖

Jan 线程页（`threads/$threadId.tsx`）本质是：

```text
┌ Header（模型切换） ─────────────────────────────┐
│  Messages（flex-1，绝对填满可滚动）               │
│    ConversationContent: mx-auto w-full           │
│      md:w-4/5  xl:w-4/6  （阅读列收窄）           │
│      MessageItem × N                             │
│  ChatInput（底部，圆角大卡片，内嵌队列/附件）     │
└──────────────────────────────────────────────────┘
```

关键组件语义：

| Jan | 职责 | Qx 对应 |
|---|---|---|
| 左侧 Thread 列表（sidebar） | 会话发现 | Workbench **左栏** `.qx-ai-conversation-list` |
| `ConversationContent` | 消息阅读列 | `.qx-ai-message-column`（max **760px** 居中） |
| `MessageItem` | 用户气泡 / 助手流式 / CoT / tools | `.qx-ai-message.is-jan` + `AiMessageContent` |
| `TokenSpeedIndicator` | 完成后 tokens/sec | `TokenSpeedBadge` |
| `ChatInput` | 圆角输入壳 + 附件 + 队列 chip | `.qx-jan-composer-dock` + `.qx-jan-composer` |
| `QueuedMessageChip` | 队列紧凑 chip，点击回填输入 | `.qx-ai-message-queue` 芯片 |

**不要**把 Jan 的整页 sidebar/header 照搬进 Qx：会话列表进左栏，模型/工具进 Context，Esc/Actions 进 Bottom Bar。

---

## 2. Qx Workbench 布局（必须）

### 2.1 壳与主从

```text
QxShell (qx-qxai-chat-shell qx-content-shell is-jan is-workbench)
  Top: 会话搜索
  Main: .qx-ai-workbench
          QxResizableSplit (.qx-ai-split)
            ├─ 左: 会话列表 (region qx-ai-list)
            └─ 右: .qx-ai-chat-detail (region qx-ai-detail)
                    .qx-ai-conversation.is-jan
                      ├─ .qx-ai-message-list (scroll)
                      │    └─ .qx-ai-message-column
                      └─ .qx-jan-composer-dock.is-docked-flow  （文档流底部，禁止 absolute 盖消息）
  Context: 模型 / Reasoning / Tools 紧凑行 / Actions
  Bottom: Send | New | … | Esc
```

硬性规则：

1. **`.qx-shell-content` 必须** `display:flex; flex-direction:column; min-height:0; overflow:hidden`（用 `qx-content-shell`）。
2. 高度链：`workbench → split → detail → conversation → message-list(flex:1)` 不断裂。
3. Composer **禁止** `position:absolute` 叠在 transcript 上（队列/附件一长必遮挡）。使用 **in-flow 底部 dock**。
4. 消息列宽度 **`min(760px, 100%)` 水平居中**，对标 Jan `md:w-4/5 xl:w-4/6` 的「窄阅读列」。
5. 左列表默认宽约 **280px**（可拖，持久化 `qx-ai.workbench.listWidth`），min ≥ 220。

### 2.2 Esc（Workbench 时代）

| 层 | 行为 |
|---|---|
| query | 清会话搜索 / 输入 / 附件错误 |
| leave | **Launcher**（不再 `setView("list")`） |
| Settings 子页 | `setView("chat")` 回 Workbench |

---

## 3. 消息排版（Jan MessageItem）

### 3.1 角色

| 角色 | 对齐 | 容器 | 背景 |
|---|---|---|---|
| **user** | 右 | `max-width: min(80%, 列宽)` 的气泡 | 淡 accent 底 + 细 accent 边（Qx 映射 Jan `bg-secondary` / 可选 primary） |
| **assistant** | 左 | 近全列宽，**无重气泡底** | 透明底；正文 Markdown 直接铺 |

禁止：

- 助手消息再套厚卡片底（Jan 助手是「裸 Markdown + 脚注」）。
- 用户/助手混用同一气泡皮肤。
- 流式中在消息脚注刷 tokens/sec（见 §4）。

### 3.2 间距与字号

| 元素 | 规范 |
|---|---|
| 消息间距 | 列内 `gap: 16–18px`；用户消息块上方可略疏（Jan `mt-8` 给非首条 user） |
| meta（You / model） | 11–12px，`text-tertiary`，字重 600，气泡上 4–6px |
| 用户气泡内文 | 13–14px，`line-height: 1.45–1.55`，padding `8–12px` |
| 助手正文 | Markdown 默认 14px，段落间距克制 |
| 脚注操作行 | 12px，`text-muted`；user 可用 hover 才显操作（Jan `group-hover`） |

### 3.3 思考 / 工具

- CoT / tools 用可折叠时间线（`.qx-jan-cot` / `.qx-jan-tool`），**插在正文之前或按步骤交错**，不得把整段思考塞进用户气泡。
- 工具名可读化（`web_search` → 展示层可 humanize）；状态：running / complete / error 三色轨。
- 流式中：轻量「活动」指示即可，不伪造进度条百分比。

### 3.4 错误

- 助手失败：左边框 + 浅红底条（Jan `border-destructive/30 bg-destructive/5` 映射到 Qx `--qx-danger-*`）。
- 文案完整、可换行；提供 Regenerate 入口时走 Actions，不抢 Bottom 主按钮语义。

---

## 4. Token 速率（Jan TokenSpeedIndicator）

源码契约（`TokenSpeedIndicator.tsx` + `custom-chat-transport.ts`）：

```text
tokenSpeed = outputTokens / durationSec
display  = Math.round(tokenSpeed) + " tokens/sec"
count    = outputTokens   // "(N tokens)"
streaming === true  →  组件返回 null（消息上不显示）
```

Qx 对齐：

| 项 | 规则 |
|---|---|
| 计量起点 | **首个正文/推理 delta**（`firstTokenAt`），不是点发送时刻 |
| 空闲剔除 | 连续 delta 间隔 **> 1.5s** 不计入 `generationMs`（工具等待） |
| 计数文本 | **completion 正文**（`estimateTokens ≈ chars/4`，无 tokenizer 时） |
| 消息脚注 | **仅完成后**显示 Gauge + `N tokens/sec` + `(N tokens)` |
| 流式 | 消息脚注不显示 TPS；可选 live 速率只放 **composer 工具条** |
| 展示 | 整数 tok/s；内部可保留 2 位小数再 round |

禁止：把整轮 Agent 工具耗时算进 TPS 导致「几 tok/s」的假慢。

---

## 5. Composer（Jan ChatInput）

### 5.1 外形

Jan：`rounded-3xl` + `border-input` + 浅半透明底；聚焦 `ring-1 ring-ring/50`；流式时外圈可有动效描边（Qx 可用静态 accent 边，不强求 MovingBorder）。

Qx：

- 容器 `.qx-jan-composer`：`border-radius: 16–18px`，模糊玻璃底，内边距 `10–12px`。
- 网格：`[工具] 1fr [发送]`，工具与发送贴底对齐。
- 宽度：`min(720px, 100%)` 与消息列视觉同轴。
- 输入：`textarea` 自适应 1→~8 行；Enter 发送、Shift+Enter 换行；IME `isComposing` 不截获 Enter。

### 5.2 内部栈（上→下）

1. 附件缩略图行（可选）
2. **队列 chips**（可选，§6）
3. Skill 条 / 状态（可选）
4. 主输入 + 发送

生成中：发送钮文案 **「加入队列」**；有 Stop 能力时优先 Stop（未来）。

### 5.3 Context 工具列表

- Context 内 **一行摘要**（`N enabled`），点击 **Popover 悬浮** 展开芯片列表。
- 禁止在 Context 常驻展开整表芯片占满滚动区。

---

## 6. 排队消息（Jan QueuedMessageChip）

Jan 交互：

```ts
// 点击文案 → 回填输入框并移出队列
setPrompt(queued.text)
removeQueuedMessage(queued.id)
focus textarea
// X → 仅删除
```

视觉：单行 chip — `rounded-lg`、`bg-secondary/80`、`border`、时钟图标 pulse、`truncate` 文案。

Qx 必须：

1. 队列在 **composer 上方**，不进消息流。
2. **点击文案 = 回填编辑**（写入 composer 并移出队列）——与 Jan 一致。
3. 删除按钮独立；图标 Lucide，**无 emoji**。
4. 多条时纵向紧凑列表，整体 max-height 可滚，避免顶破输入区。
5. 串行执行：当前会话 streaming 时新提交只入队。

可选增强（非 Jan 默认）：铅笔内联改写；若保留，不得默认展开多行表单挤爆 dock。

---

## 7. 会话列表（左栏）

对标 Jan ThreadList 的紧凑度：

| 项 | 规范 |
|---|---|
| 行高 | 接近 Qx list tall/default，双行：标题 + `provider · model` |
| 选中 | `is-active` / list selection 端口 |
| 流式 | 标题旁小 spinner，不整行闪 |
| 空态 | 居中短文案 + 引导 New Chat |
| 搜索 | Top Bar `QxModuleSearch` 过滤左列表 |

---

## 8. 颜色与主题

- **只用 Qx CSS 变量**（`--qx-text-*`、`--qx-border-*`、`--qx-bg-component-*`、`--qx-accent`）。
- 映射 Jan token：
  - `text-muted-foreground` → `--qx-text-tertiary` / secondary
  - `bg-secondary` → `--qx-bg-component-2`
  - `border-input` → `--qx-border-1/2`
  - `primary` → `--qx-accent`
- 深色玻璃：composer 可用 `color-mix` + blur，**不得**硬编码纯黑/纯白大块。
- 用户气泡：淡 accent，保持可读，非营销渐变。

---

## 9. CSS 类契约（实现检查表）

| 类名 | 必须 |
|---|---|
| `.qx-qxai-chat-shell.is-workbench` | 配合 `qx-content-shell` |
| `.qx-ai-workbench` / `.qx-ai-split` | 100% 高、flex/min-height 0 |
| `.qx-ai-chat-detail` | column flex，overflow hidden |
| `.qx-ai-message-column` | max 760px 居中 |
| `.qx-ai-message.is-jan.is-user\|is-assistant` | 角色皮肤 |
| `.qx-jan-composer-dock.is-docked-flow` | 文档流底部 |
| `.qx-jan-composer` | 圆角输入壳 |
| `.qx-jan-token-speed` | 完成后脚注 |
| `.qx-ai-message-queue` | 队列芯片容器 |
| `.qx-ai-tool-trigger` / `.qx-ai-tool-popover` | Context 工具展开 |

样式源文件：`src/styles/qx-ai.css`。**业务组件不写行内色值。**

---

## 10. 交互与无障碍

- 发送：Enter；换行：Shift+Enter；IME 合成不发送。
- `/` Skill 选择器：↑↓ Enter Esc（见 UI_SPEC 通用 QxAI 条）。
- 队列 chip、工具 Popover：键盘可聚焦；Popover `modal={false}` 避免抢 shell 焦点。
- 区域：`qx-ai-list` / `qx-ai-detail` / `qx-ai-actions` 走 master-detail 端口。
- 流式时 Bottom Island：`activity: "dots"`，禁止假进度百分比。

---

## 11. 明确不做（相对 Jan）

| Jan | Qx |
|---|---|
| 独立应用侧栏 + 全屏聊天 | 嵌入 QxShell + Context |
| MovingBorder 流式炫光 | 可选，非必须 |
| 消息 hover 全套 Continue/Regenerate 工具条 | 优先 Bottom Actions / 后续增量 |
| TokenCounter 输入字数统计 | 可选后续 |
| 分支版本 `< n/m >` | 未做 |

---

## 12. 验收清单（改样式必跑）

- [ ] 左列表 + 右聊天：窄窗与宽窗高度填满，无双重滚动条争抢
- [ ] 输入区在底部，加 3 条队列仍不遮挡最后一条消息
- [ ] 用户右气泡 / 助手左裸文，列宽约 760
- [ ] 完成后显示 `N tokens/sec (M tokens)`；流式消息脚注无 TPS
- [ ] 队列 chip 点击文案 → 回填输入并离队；X 删除
- [ ] Context 工具一行 + 悬浮列表
- [ ] Esc：清输入/搜索 → 回 Launcher；Settings → 回 Workbench
- [ ] `npx tsc --noEmit`、`npm run check`

---

## 13. 与 UI_SPEC.md 的关系

- **壳、Esc 胶囊、Bottom Island、token 色板** → `UI_SPEC.md`
- **QxAI 对话阅读/输入/队列/token 速率/工作台主从** → **本文件**
- Agent 能力与 hooks → `docs/ai-agent-runtime.md`

新增 QxAI 视觉改动：先改本文件条款，再动 `qx-ai.css` / `QxAiChat.tsx`。

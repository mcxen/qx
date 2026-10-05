// Production QxAI renderer with synthetic steps; no user session or provider traffic.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentStepsView } from "../../src/modules/qx-ai/message-rendering";
import { QxAiModelSwitcher } from "../../src/modules/qx-ai/QxAiModelSwitcher";
import {
  QxAiScrollToLatestButton,
  useQxAiConversationScroll,
} from "../../src/modules/qx-ai/conversation-scroll";
import type { AgentStep } from "../../src/modules/qx-ai/contracts";
import { useSettingsStore } from "../../src/modules/settings/store";
import "../../src/App.css";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "zh" ? "zh-CN" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const runKey = `${locale}-${theme}`;
const liveStartedAt = Date.now() - 6_700;
const settings = useSettingsStore.getState().settings;
useSettingsStore.setState({
  settings: { ...settings, general: { ...settings.general, language: locale } },
});
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.style.background = "var(--qx-bg-100)";
document.body.style.background = "var(--qx-bg-100)";
document.body.style.color = "var(--qx-text-primary)";

const singleSteps: AgentStep[] = [
  {
    id: `single-${runKey}`,
    kind: "action",
    tool: "search",
    input: JSON.stringify({ query: "QxAI result contract" }),
    output: JSON.stringify({ items: 2, source: "fixture" }, null, 2),
    state: "completed",
  },
];

const emptySteps: AgentStep[] = [
  {
    id: `empty-${runKey}`,
    kind: "action",
    tool: "bash",
    input: JSON.stringify({ command: "true" }),
    output: "",
    state: "completed",
  },
];

const groupSteps: AgentStep[] = [
  {
    id: `group-one-${runKey}`,
    kind: "action",
    tool: "files",
    input: JSON.stringify({ query: "UI_SPEC_AI.md", root: "/workspace" }),
    output: "/workspace/UI_SPEC_AI.md",
    state: "completed",
  },
  {
    id: `group-two-${runKey}`,
    kind: "action",
    tool: "read_file",
    input: JSON.stringify({ path: "/workspace/UI_SPEC_AI.md" }),
    output: "Reasoning and Tool contracts loaded",
    state: "completed",
  },
];

const thoughtTexts = locale === "zh-CN"
  ? [
      "### 查询已安装的软件\n读取系统注册表，保留软件名称与版本。",
      "按类别整理软件清单。保留重复安装的信息供用户核对。",
      `**核对软件来源**\n${"核对软件名称与版本。".repeat(30)}`,
      "\n---\n```text\n代码不是标题\n```\n",
      "逐项核对软件名称、版本和安装来源，保留系统组件和用户应用的区别，避免把重复安装、已卸载残留和缺失版本的软件条目误判为同一种安装状态。".repeat(6),
    ]
  : [
      "### Inspect installed applications\nRead the registry, keeping application names and versions.",
      "Group the installed applications. Keep duplicate installations for review.",
      `**Verify application sources**\n${"Check names and versions. ".repeat(30)}`,
      "\n---\n```text\nCode is not a title\n```\n",
      "Verify application names, versions and installation sources before grouping the installed applications. ".repeat(6),
    ];

const modelProviders = [
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      { id: "gpt-4.1", name: "GPT-4.1", vision: true, vision_known: true, context_length: 128_000 },
      { id: "claude-sonnet", name: "Claude Sonnet", reasoning: true, context_length: 200_000 },
      { id: "gemini-pro", name: "Gemini Pro", vision: true, vision_known: true },
      { id: "qwen-max", name: "Qwen Max" },
      { id: "mistral-large", name: "Mistral Large" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", context_length: 64_000 },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner", reasoning: true, context_length: 64_000 },
      { id: "deepseek-vl", name: "DeepSeek VL", vision: true, vision_known: true },
    ],
  },
];

function Fixture() {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [modelSelection, setModelSelection] = useState({
    providerId: "openrouter",
    modelId: "gpt-4.1",
  });
  const [transcriptConversation, setTranscriptConversation] = useState("a");
  const [transcriptRows, setTranscriptRows] = useState(() =>
    Array.from({ length: 12 }, (_, index) => `Message ${index + 1}`),
  );
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([
    {
      id: `live-${runKey}`,
      kind: "action",
      tool: "http",
      input: JSON.stringify({ url: "https://example.test/result" }),
      state: "running",
    },
  ]);
  const [thoughtSteps, setThoughtSteps] = useState<AgentStep[]>(thoughtTexts.map((text, index) => ({
    id: `thought-${index}-${runKey}`,
    kind: "thought",
    text,
    state: index === 0 ? "running" : "completed",
  })));
  const transcriptScroll = useQxAiConversationScroll({
    conversationId: `fixture-${runKey}-${transcriptConversation}`,
    revision: transcriptRows.join("\0"),
  });

  Object.assign(window, {
    qxAiDisclosureFixture: {
      appendTranscript() {
        setTranscriptRows((rows) => [...rows, `Message ${rows.length + 1}`]);
      },
      switchTranscriptConversation(id: string) {
        setTranscriptConversation(id);
      },
      completeLive() {
        setLiveSteps((steps) => steps.map((step) => ({
          ...step,
          output: "Live result returned",
          state: "completed" as const,
        })));
      },
      appendThought() {
        setThoughtSteps((steps) => steps.map((step, index) => index === 0
          ? { ...step, text: `${step.text}\nAdditional streamed detail.`, state: "completed" }
          : step));
      },
    },
  });

  return (
    <main
      className="qx-ai-disclosure-fixture"
      style={{ display: "grid", gap: 18, margin: "0 auto", maxWidth: 680, padding: 20 }}
    >
      <section
        className="qx-shell-content"
        data-fixture="layout"
        data-conversation={transcriptConversation}
        style={{ display: "flex", height: 360, minHeight: 0, overflow: "hidden" }}
      >
        <div className="qx-ai-conversation is-jan" data-qx-ai="conversation">
          <div
            ref={transcriptScroll.viewportRef}
            className="qx-ai-message-list is-jan"
            data-qx-ai="conversation-content"
            data-following={transcriptScroll.showJumpToLatest ? "false" : "true"}
            onScroll={transcriptScroll.onScroll}
          >
            <div ref={transcriptScroll.contentRef} className="qx-ai-message-column">
              {transcriptRows.map((row, index) => (
                <div
                  key={row}
                  className={`qx-ai-message is-jan is-${index % 2 === 0 ? "user" : "assistant"}`}
                >
                  <div className="qx-ai-message-body">
                    <div className="qx-ai-message-meta">
                      {index % 2 === 0 ? "You" : "QxAI"}
                    </div>
                    <div
                      className={`qx-ai-message-bubble is-jan is-${index % 2 === 0 ? "user" : "assistant"}`}
                    >
                      {row} · This line verifies stable transcript width and reading rhythm.
                    </div>
                  </div>
                </div>
              ))}
              <div className="qx-ai-message-list-end" />
            </div>
          </div>
          <div className="qx-ai-prompt-dock qx-jan-composer-dock is-docked-flow">
            <QxAiScrollToLatestButton
              visible={transcriptScroll.showJumpToLatest}
              label={locale === "zh-CN" ? "回到最新消息" : "Jump to latest"}
              onClick={transcriptScroll.scrollToLatest}
            />
            <div className="qx-ai-prompt qx-jan-composer">
              <textarea
                ref={composerRef}
                className="qx-jan-composer-input"
                data-fixture="composer-input"
                rows={1}
                readOnly
                placeholder={locale === "zh-CN" ? "输入消息…" : "Type a message…"}
              />
              <div className="qx-jan-composer-toolbar">
                <div className="qx-jan-composer-tools">
                  <QxAiModelSwitcher
                    providers={modelProviders}
                    providerId={modelSelection.providerId}
                    modelId={modelSelection.modelId}
                    favorites={["openrouter|gpt-4.1"]}
                    capabilities={{}}
                    composerRef={composerRef}
                    onChange={(providerId, modelId) => setModelSelection({ providerId, modelId })}
                    onManageModels={() => {
                      document.documentElement.dataset.modelManage = "true";
                    }}
                  />
                </div>
                <div className="qx-jan-composer-actions">
                  <button className="qx-jan-composer-send" type="button" aria-label="Send">
                    ↑
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="qx-ai-message-bubble is-jan is-assistant" data-fixture="single">
        <AgentStepsView steps={singleSteps} />
      </section>
      <section className="qx-ai-message-bubble is-jan is-assistant" data-fixture="empty">
        <AgentStepsView steps={emptySteps} />
      </section>
      <section className="qx-ai-message-bubble is-jan is-assistant" data-fixture="group">
        <AgentStepsView steps={groupSteps} />
      </section>
      <section className="qx-ai-message-bubble is-jan is-assistant" data-fixture="live">
        <AgentStepsView steps={liveSteps} streaming reasoningStartedAt={liveStartedAt} />
      </section>
      <section className="qx-ai-message-bubble is-jan is-assistant" data-fixture="thoughts">
        <AgentStepsView steps={thoughtSteps} />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

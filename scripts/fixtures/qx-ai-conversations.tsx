// Production conversation list, synthetic catalog only; no provider or user data.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QxAiConversationList from "../../src/modules/qx-ai/QxAiConversationList";
import { filterQxAiConversations } from "../../src/modules/qx-ai/conversation-model";
import { QxModuleSearch } from "../../src/components/QxModuleSearch";
import { qxMasterDetailIds } from "../../src/hooks/useQxMasterDetail";
import { useQxListSelection } from "../../src/hooks/useQxListSelection";
import { useSettingsStore } from "../../src/modules/settings/store";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import QxAiChat from "../../src/modules/qx-ai/QxAiChat";
import { useG4fStore } from "../../src/modules/qx-ai/store";
import QxShell from "../../src/components/QxShell";
import PluginWorkbenchView from "../../src/plugin/PluginWorkbenchView";
import { normalizePluginWorkbenchState } from "../../src/plugin/workbenchTypes";
import { ThemeProvider } from "../../src/ThemeProvider";
import { parseQuestionRequest, parseSuggestions } from "../../src/modules/qx-ai/interaction";
import type { AgentStep } from "../../src/modules/qx-ai/contracts";
import PzaiAssistantPanel from "../../src/modules/p-zai/PzaiAssistantPanel";
import { usePzaiStore } from "../../src/modules/p-zai/store";
import "../../src/App.css";

const params = new URLSearchParams(location.search);
const language = params.get("locale") === "zh" ? "zh-CN" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const settings = useSettingsStore.getState().settings;
useSettingsStore.setState({ settings: { ...settings, general: { ...settings.general, language } } });
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");
const providers = [{ id: "custom:mutgy9fkna1v8n0", name: "小红书", models: [{ id: "dots3-note-prev", name: "我的模型" }, ...Array.from({ length: 9 }, (_, index) => ({ id: `model-${index}`, name: `Model ${index} with a longer display name`, reasoning: true, context_length: 128_000 }))] }];
const conversations = [{ id: "chat", name: "电脑软件列表", provider: providers[0].id, model: "dots3-note-prev", createdAt: 1, messages: [] }];
const mode = params.get("mode");
mockWindows("main");
mockIPC((command) => command === "get_settings" ? { appearance: { theme } } : command === "qxai_list_skills" ? [
  { id: "software", name: "Software inventory", description: "Inspect installed applications", path: "fixture", mode: "full" },
] : command === "plugin:event|listen" ? 1 : null);
useG4fStore.setState({
  providers, currentConversationId: "chat", loading: false, sessionsLoaded: true,
  messageQueue: [{ id: "queued", conversationId: "chat", content: "继续核对软件的版本和安装来源" }],
  conversations: [{ ...conversations[0], messages: [
    { role: "user", content: "看看电脑上安装的软件", createdAt: Date.now() },
    { role: "assistant", model: "dots3-note-prev", content: "### 已安装的软件\n按类别整理的软件清单。\n\n```text\nApplication name    Version\nQx                  0.6.117\n```", createdAt: Date.now(), reasoningDurationMs: 24_000,
      steps: [{ id: "fixture-thought", kind: "thought", state: "completed", text: "### 查询已安装的软件\n读取系统注册表中的应用名称与版本。" }] },
  ] }],
});
document.documentElement.style.background = "var(--qx-bg-100)";

const interactionMode = params.get("interaction");
if (interactionMode) {
  const question = parseQuestionRequest({ questions: [
    { header: "Scope", question: "Which applications should I inspect?", multiSelect: interactionMode === "multi",
      options: [{ label: "All applications", description: "Include system and user apps", recommended: true }, { label: "Games only", description: "Inspect game installations" }] },
    ...(interactionMode === "multi" ? [{ header: "Output", question: "How should I show the result?", options: [{ label: "Brief list" }, { label: "Detailed report" }] }] : []),
  ] });
  const suggestions = parseSuggestions({ suggestions: [
    { label: "Check versions", prompt: "Check the versions of the installed applications.", recommended: true },
    { label: "Group by category", prompt: "Group the installed applications by category." },
    { label: "Export a report", prompt: "Export the installed application list as a report." },
  ] });
  const step: AgentStep = { id: "interaction", kind: "action", tool: interactionMode === "suggestions" ? "suggest_next_actions" : "ask_user_question",
    state: "completed", ...(interactionMode === "suggestions" ? { suggestions } : { question }) };
  const current = useG4fStore.getState().conversations[0];
  const calls: string[] = [];
  const messages = [current.messages[0], { ...current.messages[1], content: "Choose the scope to continue.", steps: [step] }];
  useG4fStore.setState({ conversations: [{ ...current, messages }], sendMessage: async (content) => {
    calls.push(content);
    useG4fStore.setState((state) => ({ conversations: state.conversations.map((conversation) => ({ ...conversation,
      messages: [...conversation.messages, { role: "user", content, createdAt: Date.now() }],
    })) }));
  } });
  Object.assign(window, { interactionFixture: {
    calls, queue: () => useG4fStore.getState().messageQueue.length,
    runQueue: () => useG4fStore.getState().runNextQueuedMessage("chat"),
    streaming: (value: boolean) => useG4fStore.setState({ runs: { chat: { streaming: value, streamedContent: "", streamedReasoning: "", streamingSteps: [], error: null, startedAt: 1 } } }),
    restore: () => useG4fStore.setState({ conversations: [{ ...current, messages: JSON.parse(JSON.stringify(messages)) }] }),
    stale: () => useG4fStore.getState().sendFollowUp("chat", messages[1], "Stale control must not send"),
  } });
}

function Fixture() {
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const filtered = filterQxAiConversations(conversations, providers, query);
  const { getItemProps } = useQxListSelection({ listRef, index: 0, listSignature: query });
  if (mode === "pzai") {
    usePzaiStore.setState({ openArticle: async () => {} });
    return <div className="qx-canvas"><QxShell title="Article" islandKey="fixture-pzai" context={
      <PzaiAssistantPanel article={{ id: 1, title: "Software", content: "Software list", link: "", author: "" }}
        conversationId="chat" onConversationCreated={() => {}} onClose={() => {}} />
    }><p>Software list</p></QxShell></div>;
  }
  if (mode === "ai") return <div className="qx-canvas"><QxAiChat /></div>;
  if (mode === "workbench") return <div className="qx-canvas"><QxShell title="Workbench" islandKey="fixture-workbench" contentMode="fill" className="qx-plugin-shell"
    search={<QxModuleSearch value={query} onChange={setQuery} placeholder="Search" />}>
    <div className="qx-plugin-runtime-stage"><PluginWorkbenchView pluginId="fixture" detailOpen={false}
      state={normalizePluginWorkbenchState({ items: [{ id: "item", title: "Installed applications", subtitle: "Application name and version", icon: "🗂️" }], selectedId: "item" })}
      onActivate={() => {}} onInput={() => {}} onAction={() => {}} onDownload={() => {}} />
    </div>
  </QxShell></div>;
  return <main>
    <QxModuleSearch value={query} onChange={setQuery} placeholder="Search" />
    <QxAiConversationList listRef={listRef} regionIds={qxMasterDetailIds("qx-ai")}
      providers={providers} conversations={filtered} runs={{}} selectedId="chat"
      loading={false} listQuery={query} getItemProps={getItemProps}
      onSelect={() => {}} onOpen={() => {}} hasActiveConversation />
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider><Fixture /></ThemeProvider>);

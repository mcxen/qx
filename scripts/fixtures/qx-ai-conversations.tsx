// Production conversation list, synthetic catalog only; no provider or user data.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QxAiConversationList from "../../src/modules/qx-ai/QxAiConversationList";
import { filterQxAiConversations } from "../../src/modules/qx-ai/conversation-model";
import { QxModuleSearch } from "../../src/components/QxModuleSearch";
import { qxMasterDetailIds } from "../../src/hooks/useQxMasterDetail";
import { useQxListSelection } from "../../src/hooks/useQxListSelection";
import { useSettingsStore } from "../../src/modules/settings/store";
import "../../src/App.css";

const params = new URLSearchParams(location.search);
const language = params.get("locale") === "zh" ? "zh-CN" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const settings = useSettingsStore.getState().settings;
useSettingsStore.setState({ settings: { ...settings, general: { ...settings.general, language } } });
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");
const providers = [{ id: "custom:mutgy9fkna1v8n0", name: "小红书", models: [{ id: "dots3-note-prev", name: "我的模型" }] }];
const conversations = [{ id: "chat", name: "电脑软件列表", provider: providers[0].id, model: "dots3-note-prev", createdAt: 1, messages: [] }];

function Fixture() {
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const filtered = filterQxAiConversations(conversations, providers, query);
  const { getItemProps } = useQxListSelection({ listRef, index: 0, listSignature: query });
  return <main>
    <QxModuleSearch value={query} onChange={setQuery} placeholder="Search" />
    <QxAiConversationList listRef={listRef} regionIds={qxMasterDetailIds("qx-ai")}
      providers={providers} conversations={filtered} runs={{}} selectedId="chat"
      loading={false} listQuery={query} getItemProps={getItemProps}
      onSelect={() => {}} onOpen={() => {}} hasActiveConversation />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

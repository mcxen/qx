// Production controls; isolated synthetic data, never the user's settings or DB.
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import QxShell from "../../src/components/QxShell";
import { MemorySection } from "../../src/modules/qx-ai/MemorySection";
import { MemoryScopeControl } from "../../src/modules/qx-ai/MemoryScopeControl";
import { useG4fStore } from "../../src/modules/qx-ai/store";
import { useSettingsStore } from "../../src/modules/settings/store";
import "../../src/App.css";

const params = new URLSearchParams(location.search);
const settings = useSettingsStore.getState().settings;
useSettingsStore.setState({ settings: { ...settings, general: { ...settings.general, language: params.get("locale") === "zh" ? "zh-CN" : "en" } } });
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
document.documentElement.style.background = "var(--qx-bg-100)";
useG4fStore.setState({ sessionsLoaded: true, conversations: [{ id: "source-chat", name: "Source conversation", provider: "test", model: "test", createdAt: 1, messages: [], memoryScope: "Qx" }] });
const calls: unknown[] = [];
let fail = false;
const base = { tags: [], source: "dream.smart", type: "core", category: "project", active: true, importance: 70, createdAt: 1, updatedAt: 2, supersedes: [] };
let entries = [
  { ...base, id: "original", text: "Original preserved fact", scope: "", active: false },
  { ...base, id: "summary", text: "Global durable preference", scope: "", supersedes: ["original"], originConversationId: "source-chat" },
  { ...base, id: "project", text: "Project-only invariant", scope: "Qx" },
];
mockIPC((command, payload) => {
  calls.push({ command, payload });
  if (command === "plugin:event|listen") return 1;
  if (command === "plugin_ai_memory_list") {
    if (fail) throw new Error("Expected memory failure ".repeat(20));
    return entries;
  }
  if (command === "plugin_ai_memory_add") {
    const input = (payload as { input: { text: string; tags: string[] } }).input;
    const entry = { ...base, id: "added", ...input, scope: input.tags.find((tag) => tag.startsWith("scope:"))?.slice(6) ?? "" };
    entries = [...entries, entry]; return entry;
  }
  if (command === "qxai_memory_dream") return { beforeChars: 40, afterChars: 20, savedChars: 20, hasMore: false };
  return null;
});
Object.assign(window, { memoryFixture: { calls, fail: () => { fail = true; }, scope: () => useG4fStore.getState().conversations[0].memoryScope } });
createRoot(document.getElementById("root")!).render(
  <QxShell title="Memory fixture" islandKey="qx-ai.fixture" escapeAction={{ id: "back", label: "Back", onClick() {} }}>
    <MemoryScopeControl conversationId="source-chat" scope="Qx" />
    <MemorySection />
  </QxShell>,
);

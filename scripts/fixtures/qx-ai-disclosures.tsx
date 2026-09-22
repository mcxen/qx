// Production QxAI renderer with synthetic steps; no user session or provider traffic.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentStepsView } from "../../src/modules/qx-ai/message-rendering";
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

function Fixture() {
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([
    {
      id: `live-${runKey}`,
      kind: "action",
      tool: "http",
      input: JSON.stringify({ url: "https://example.test/result" }),
      state: "running",
    },
  ]);

  Object.assign(window, {
    qxAiDisclosureFixture: {
      completeLive() {
        setLiveSteps((steps) => steps.map((step) => ({
          ...step,
          output: "Live result returned",
          state: "completed" as const,
        })));
      },
    },
  });

  return (
    <main
      className="qx-ai-disclosure-fixture"
      style={{ display: "grid", gap: 18, margin: "0 auto", maxWidth: 680, padding: 20 }}
    >
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
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

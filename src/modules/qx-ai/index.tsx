import { useEffect } from "react";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import { useG4fStore } from "./store";
import { startQxAiScheduleBridge } from "./schedule-bridge";
import QxAiChat from "./QxAiChat";
import QxAiSettings from "./QxAiSettings";

/**
 * QxAI entry: default surface is the conversation workbench
 * (left list + right self-drawn chat). Settings is a nested view.
 */
export default function QxAiReader() {
  const {
    view,
    loadProviders,
    loadSessions,
    selectConversation,
    setView,
    createConversation,
  } = useG4fStore();

  useEffect(() => {
    startQxAiScheduleBridge();
    void Promise.all([loadProviders(), loadSessions()]);
  }, [loadProviders, loadSessions]);

  useEffect(() => {
    const launch = takePendingModuleLaunch("qx-ai");
    if (!launch) return;
    if (launch.surface === "settings") {
      setView("settings");
      return;
    }
    if (launch.surface === "new") {
      createConversation();
      return;
    }
    if (launch.surface === "chat") {
      const id = String(launch.params?.id || "");
      if (id) selectConversation(id);
      setView("chat");
      return;
    }
    // root / list aliases → workbench (last conversation restored by loadSessions)
    setView("chat");
  }, [createConversation, selectConversation, setView]);

  if (view === "settings") return <QxAiSettings />;
  return <QxAiChat />;
}

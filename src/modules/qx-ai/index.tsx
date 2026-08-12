import { useEffect } from "react";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import { useG4fStore } from "./store";
import QxAiChat from "./QxAiChat";
import QxAiSettings from "./QxAiSettings";

/**
 * QxAI entry: default surface is the conversation workbench
 * (left list + right self-drawn chat). Settings is a nested view.
 *
 * Load providers/sessions asynchronously after mount; never block shell paint.
 * Agent harness stays out of this entry — only `sendMessage` pulls it in.
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
    // Schedule bridge is started from App (idle). Also ensure when user opens QxAI.
    void import("./schedule-bridge")
      .then(({ startQxAiScheduleBridge }) => startQxAiScheduleBridge())
      .catch(() => {});
    // Sessions and providers in parallel; each call is idempotent/resilient.
    void loadSessions().catch((error) => {
      console.error("qxai loadSessions failed", error);
    });
    void loadProviders().catch((error) => {
      console.error("qxai loadProviders failed", error);
    });
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

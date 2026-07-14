import { useEffect } from "react";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import { useG4fStore } from "./store";
import QxAiPanel from "./QxAiPanel";
import QxAiChat from "./QxAiChat";
import QxAiSettings from "./QxAiSettings";

export default function QxAiReader() {
  const { view, loadProviders, selectConversation, setView, createConversation } = useG4fStore();

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

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
      if (id) {
        selectConversation(id);
        setView("chat");
      }
      return;
    }
    // root → list
    setView("list");
  }, [createConversation, selectConversation, setView]);

  if (view === "chat") return <QxAiChat />;
  if (view === "settings") return <QxAiSettings />;
  return <QxAiPanel />;
}

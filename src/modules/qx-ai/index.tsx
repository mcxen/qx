import { useEffect } from "react";
import { useG4fStore } from "./store";
import QxAiPanel from "./QxAiPanel";
import QxAiChat from "./QxAiChat";
import QxAiSettings from "./QxAiSettings";

export default function QxAiReader() {
  const { view, loadProviders } = useG4fStore();

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  if (view === "chat") return <QxAiChat />;
  if (view === "settings") return <QxAiSettings />;
  return <QxAiPanel />;
}

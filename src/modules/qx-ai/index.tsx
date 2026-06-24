import { useEffect } from "react";
import { useG4fStore } from "./store";
import G4FPanel from "./G4FPanel";
import G4FChat from "./G4FChat";
import G4FSettings from "./G4FSettings";

export default function G4fReader() {
  const { view, loadProviders } = useG4fStore();

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  if (view === "settings") return <G4FSettings />;
  if (view === "chat") return <G4FChat />;
  return <G4FPanel />;
}

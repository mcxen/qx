import { AlertCircle } from "lucide-react";
import { Button, Popover, PopoverTrigger, PopoverContent } from "../../components/ui";
import { useT } from "../../i18n";
import type { IslandSession } from "../types";
import { islandHost } from "../session/hostApi";
import { actionRegistry } from "../session/actionRegistry";
import IslandActionButton from "./IslandActionButton";

/** The same session supplies the compact trigger, full detail and recovery actions. */
export default function IslandErrorSummary({ session, canFloat, openRoute }: { session: IslandSession; canFloat?: boolean; openRoute?: string | null }) {
  const t = useT();
  const { content } = session;
  const actions = content.actions?.length ? content.actions : content.action ? [content.action] : [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="qx-island-error-trigger"
          aria-label={`${t("island.errorDetails", "View error details")}: ${content.primary}. ${content.secondary ?? ""}`}>
          <AlertCircle size={16} aria-hidden="true" />
          <span>{content.primary}</span>
          <span className="qx-island-error-preview">{content.secondary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={10} className="qx-island-error-details"
        role="dialog" aria-label={content.primary}>
        <strong>{content.primary}</strong>
        <p>{content.secondary}</p>
        <div className="qx-island-error-actions">
          {actions.map((action) => <IslandActionButton key={action.id} action={action}
            onInvoke={async () => { await actionRegistry.run(session.id, action.id); }} />)}
          {openRoute && <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("qx:navigate", { detail: openRoute }))}>
            {t("common.open", "Open")}
          </Button>}
          {canFloat && <Button variant="ghost" size="sm" onClick={() => islandHost.requestFloat(session.id)}>
            {t("island.float.popOut", "Float Island")}
          </Button>}
          <Button variant="ghost" size="sm" onClick={() => islandHost.dismiss(session.id)}>
            {t("island.dismiss", "Dismiss")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

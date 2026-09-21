import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, Input } from "../../components/ui";
import { useT } from "../../i18n";
import { useG4fStore } from "./store";

/** Mount keyed by conversation: an unfinished scope draft never leaks to another chat. */
export function MemoryScopeControl({ conversationId, scope }: { conversationId: string; scope?: string }) {
  const t = useT();
  const [draft, setDraft] = useState(scope ?? "");
  useEffect(() => setDraft(scope ?? ""), [scope]);
  const commit = () => useG4fStore.getState().setConversationMemoryScope(conversationId, draft);
  return <label className="qx-ai-config-field-label" title={t("agent.memory.scope.hint", "Affects future turns only; existing memories stay in place. Matching project names share memory.")}>
    {t("agent.memory.scope", "Memory scope")}
    <Input value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      placeholder={t("agent.memory.scope.placeholder", "Project name (empty for global)")}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
      }} />
  </label>;
}

export function MemoryScopeDialog({ conversationId, scope, open, onOpenChange }: {
  conversationId: string; scope?: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent><DialogTitle>{t("agent.memory.scope", "Memory scope")}</DialogTitle>
      <MemoryScopeControl key={`${conversationId}:${open}`} conversationId={conversationId} scope={scope} />
    </DialogContent>
  </Dialog>;
}

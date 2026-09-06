import { lazy, Suspense, useEffect, useRef, type KeyboardEvent } from "react";
import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import { Button, Textarea } from "../components/ui";
import { isImeCompositionEvent } from "../utils/keyboard";
import { useT } from "../i18n";
import type { WorkbenchEditSession } from "./workbenchEditSession";
import { workbenchUtf8ByteLength } from "./workbenchEditTypes";

export interface PluginWorkbenchInlineEditorProps {
  session: WorkbenchEditSession;
  onInput: (value: string) => void;
  onSave: () => Promise<boolean>;
  onCancel: () => Promise<boolean>;
}

function PlainPluginWorkbenchInlineEditor({
  session,
  onInput,
  onSave,
  onCancel,
}: PluginWorkbenchInlineEditorProps) {
  const t = useT();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const focusedSessionRef = useRef<string | null>(null);
  const limit = session.item.editor?.maxBytes || 65_536;
  const busy = session.status === "starting" || session.status === "saving";
  const byteCount = workbenchUtf8ByteLength(session.value);
  useEffect(() => {
    if (!session.ready || focusedSessionRef.current === session.sessionId) return;
    focusedSessionRef.current = session.sessionId;
    editorRef.current?.focus({ preventScroll: true });
    editorRef.current?.setSelectionRange(session.value.length, session.value.length);
  }, [session.sessionId, session.ready]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeCompositionEvent(event.nativeEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void onCancel();
      return;
    }
    if (
      event.key === "Enter"
      && (event.metaKey || event.ctrlKey)
      && !event.shiftKey
      && !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      void onSave();
    }
  };

  return (
    <div
      className={`qx-host-workbench-card-editor is-${session.status}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Textarea
        ref={editorRef}
        className="qx-host-workbench-card-editor-input"
        value={session.value}
        rows={session.item.editor?.rows}
        placeholder={session.item.editor?.placeholder}
        disabled={busy || !session.ready}
        aria-label={session.item.title || t("plugins.workbench.editor.bodyLabel", "Note body")}
        aria-invalid={session.invalid || undefined}
        onChange={(event) => onInput(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="qx-host-workbench-card-editor-footer">
        <span className="qx-host-workbench-card-editor-state" role={session.status === "error" ? "alert" : "status"}>
          {session.status === "starting" || session.status === "saving" ? (
            <LoaderCircle size={13} className="qx-loading-spinner" aria-hidden="true" />
          ) : session.status === "conflict" || session.status === "error" ? (
            <AlertTriangle size={13} aria-hidden="true" />
          ) : (
            <Check size={13} aria-hidden="true" />
          )}
          <span>
            {session.message
              || (session.status === "starting"
                ? t("plugins.workbench.editor.loading", "Loading note…")
                : session.status === "saving"
                  ? t("plugins.workbench.editor.saving", "Saving…")
                  : session.status === "conflict"
                    ? t("plugins.workbench.editor.conflict", "Conflict — review and retry")
                    : session.status === "error"
                      ? t("plugins.workbench.editor.error", "Could not edit this note")
                      : t("plugins.workbench.editor.draft", "Unsaved draft"))}
          </span>
          <span className="qx-host-workbench-card-editor-count">{byteCount}/{limit}</span>
        </span>
        <span className="qx-host-workbench-card-editor-actions">
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={busy || session.invalid}
            onClick={() => void onSave()}
          >
            {t("plugins.workbench.editor.save", "Save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void onCancel()}
          >
            {t("plugins.workbench.editor.cancel", "Cancel")}
          </Button>
        </span>
      </div>
    </div>
  );
}

const WorkbenchMarkdownEditor = lazy(() => import("./WorkbenchMarkdownEditor"));

export default function PluginWorkbenchInlineEditor(props: PluginWorkbenchInlineEditorProps) {
  if (props.session.item.editor?.format !== "markdown") {
    return <PlainPluginWorkbenchInlineEditor {...props} />;
  }
  return (
    <Suspense fallback={<PlainPluginWorkbenchInlineEditor {...props} />}>
      <WorkbenchMarkdownEditor {...props} />
    </Suspense>
  );
}

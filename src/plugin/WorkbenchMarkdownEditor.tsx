import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlertTriangle,
  Bold,
  Check,
  Code2,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { Button, Textarea } from "../components/ui";
import { isImeCompositionEvent } from "../utils/keyboard";
import { useT } from "../i18n";
import type { WorkbenchEditSession } from "./workbenchEditSession";
import {
  analyzeWorkbenchMarkdown,
  serializeWorkbenchMarkdown,
  workbenchMarkdownExtensions,
  type WorkbenchMarkdownUnsupportedReason,
} from "./workbenchMarkdown";
import { workbenchUtf8ByteLength } from "./workbenchEditTypes";
import "../styles/workbench-markdown-editor.css";

export interface WorkbenchMarkdownEditorProps {
  session: WorkbenchEditSession;
  onInput: (value: string) => void;
  onSave: () => Promise<boolean>;
  onCancel: () => Promise<boolean>;
}

const emptyDocument = { type: "doc" as const, content: [{ type: "paragraph" as const }] };

function reasonLabel(
  reason: WorkbenchMarkdownUnsupportedReason | undefined,
  t: (key: string, fallback: string) => string,
): string {
  switch (reason) {
    case "image":
      return t("plugins.workbench.editor.markdown.unsupportedImage", "Images stay in source mode.");
    case "html":
      return t("plugins.workbench.editor.markdown.unsupportedHtml", "Raw HTML stays in source mode.");
    case "table":
      return t("plugins.workbench.editor.markdown.unsupportedTable", "Tables stay in source mode.");
    case "dangerous-link":
      return t("plugins.workbench.editor.markdown.unsafeLink", "This link is not safe to render.");
    case "unknown-token":
      return t("plugins.workbench.editor.markdown.unsupportedFormat", "This format stays in source mode.");
    case "parse-error":
      return t("plugins.workbench.editor.markdown.parseError", "This Markdown could not be opened visually.");
    default:
      return t("plugins.workbench.editor.markdown.sourceOnly", "Source mode protects unsupported content.");
  }
}

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? "secondary" : "ghost"}
      className="qx-host-workbench-markdown-tool"
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function MarkdownToolbar({
  editor,
  disabled,
  onSource,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  disabled: boolean;
  onSource: () => void;
}) {
  const t = useT();
  const run = useCallback((command: () => boolean) => {
    if (!disabled) command();
  }, [disabled]);
  return (
    <div className="qx-host-workbench-markdown-toolbar" role="toolbar" aria-label={t("plugins.workbench.editor.markdown.toolbar", "Formatting") }>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.bold", "Bold")}
        active={editor.isActive("bold")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run())}
      >
        <Bold size={14} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.italic", "Italic")}
        active={editor.isActive("italic")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run())}
      >
        <Italic size={14} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.strike", "Strikethrough")}
        active={editor.isActive("strike")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleStrike().run())}
      >
        <Strikethrough size={14} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.underline", "Underline")}
        active={editor.isActive("underline")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleUnderline().run())}
      >
        <Underline size={14} aria-hidden="true" />
      </ToolbarButton>
      <span className="qx-host-workbench-markdown-toolbar-divider" aria-hidden="true" />
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.bulletedList", "Bulleted list")}
        active={editor.isActive("bulletList")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleBulletList().run())}
      >
        <List size={14} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.orderedList", "Ordered list")}
        active={editor.isActive("orderedList")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleOrderedList().run())}
      >
        <ListOrdered size={14} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.taskList", "Task list")}
        active={editor.isActive("taskList")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleTaskList().run())}
      >
        <ListChecks size={14} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.quote", "Quote")}
        active={editor.isActive("blockquote")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleBlockquote().run())}
      >
        <Quote size={14} aria-hidden="true" />
      </ToolbarButton>
      <ToolbarButton
        label={t("plugins.workbench.editor.markdown.codeBlock", "Code block")}
        active={editor.isActive("codeBlock")}
        disabled={disabled}
        onClick={() => run(() => editor.chain().focus(undefined, { scrollIntoView: false }).toggleCodeBlock().run())}
      >
        <Code2 size={14} aria-hidden="true" />
      </ToolbarButton>
      <span className="qx-host-workbench-markdown-toolbar-spacer" />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="qx-host-workbench-markdown-source-toggle"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSource}
      >
        {t("plugins.workbench.editor.markdown.source", "Source")}
      </Button>
    </div>
  );
}

export default function WorkbenchMarkdownEditor({
  session,
  onInput,
  onSave,
  onCancel,
}: WorkbenchMarkdownEditorProps) {
  const t = useT();
  const inputRef = useRef(onInput);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const focusedSessionRef = useRef<string | null>(null);
  const originalSourceRef = useRef("");
  const currentSourceRef = useRef("");
  const lastReportedRef = useRef("");
  const visualEditedRef = useRef(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [warningReason, setWarningReason] = useState<WorkbenchMarkdownUnsupportedReason>();

  useEffect(() => {
    inputRef.current = onInput;
  }, [onInput]);

  // The initial content is keyed by session readiness, never by every draft
  // keystroke. This prevents React from replacing the ProseMirror document or
  // resetting the selection while the user types.
  const initialSource = useMemo(
    () => (session.ready ? session.value : ""),
    [session.ready, session.sessionId],
  );
  const initialAnalysis = useMemo(
    () => analyzeWorkbenchMarkdown(initialSource),
    [initialSource],
  );
  const editor = useEditor({
    extensions: workbenchMarkdownExtensions,
    content: initialAnalysis.document || emptyDocument,
    editable: session.ready && session.status !== "saving" && session.status !== "starting",
    immediatelyRender: false,
    onUpdate: ({ editor: updatedEditor, transaction }) => {
      if (!transaction.docChanged) return;
      const next = serializeWorkbenchMarkdown(updatedEditor.getJSON());
      currentSourceRef.current = next;
      if (!visualEditedRef.current && next === originalSourceRef.current) return;
      visualEditedRef.current = true;
      if (next === lastReportedRef.current) return;
      lastReportedRef.current = next;
      inputRef.current(next);
    },
  }, [session.sessionId, session.ready]);

  useEffect(() => {
    if (editor) {
      // The extensions are attached by the editor factory in the lazy module;
      // this branch only exists to retain a stable hook shape during loading.
      editor.setEditable(session.ready && session.status !== "saving" && session.status !== "starting", false);
    }
  }, [editor, session.ready, session.status]);

  useEffect(() => {
    originalSourceRef.current = initialSource;
    currentSourceRef.current = initialSource;
    lastReportedRef.current = initialSource;
    visualEditedRef.current = false;
    setSourceDraft(initialSource);
    setWarningReason(initialAnalysis.reason);
    setSourceMode(!initialAnalysis.safe);
    focusedSessionRef.current = null;
  }, [initialAnalysis.reason, initialAnalysis.safe, initialSource, session.sessionId]);

  useEffect(() => {
    if (!session.ready || focusedSessionRef.current === session.sessionId) return;
    if (sourceMode) {
      const source = sourceRef.current;
      if (!source) return;
      source.focus({ preventScroll: true });
      source.setSelectionRange(sourceDraft.length, sourceDraft.length);
      focusedSessionRef.current = session.sessionId;
      return;
    }
    // React may retain an editor for one render after its view is destroyed
    // during session readiness changes. Tiptap's view getter throws then.
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    dom.focus({ preventScroll: true });
    editor?.commands.focus("end", { scrollIntoView: false });
    focusedSessionRef.current = session.sessionId;
  }, [editor, session.ready, session.sessionId, sourceDraft.length, sourceMode]);

  const enterVisualMode = useCallback(() => {
    if (!editor || session.invalid || !session.ready || session.status === "saving") return;
    const result = analyzeWorkbenchMarkdown(sourceDraft);
    setWarningReason(result.reason);
    if (!result.safe || !result.document) return;
    editor.commands.setContent(result.document, { emitUpdate: false });
    originalSourceRef.current = sourceDraft;
    currentSourceRef.current = sourceDraft;
    lastReportedRef.current = sourceDraft;
    visualEditedRef.current = false;
    focusedSessionRef.current = null;
    setSourceMode(false);
  }, [editor, sourceDraft, session.invalid, session.ready, session.status]);

  const enterSourceMode = useCallback(() => {
    setSourceDraft(currentSourceRef.current);
    focusedSessionRef.current = null;
    setSourceMode(true);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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

  const onSourceChange = (value: string) => {
    currentSourceRef.current = value;
    lastReportedRef.current = value;
    setSourceDraft(value);
    // Parse only when explicitly entering visual mode, not on each keystroke.
    setWarningReason(undefined);
    inputRef.current(value);
  };

  const busy = session.status === "starting" || session.status === "saving";
  const byteCount = workbenchUtf8ByteLength(session.value);
  const limit = session.item.editor?.maxBytes || 65_536;
  const sourceOnlyMessage = reasonLabel(warningReason, t);

  return (
    <div
      className={`qx-host-workbench-card-editor qx-host-workbench-markdown-editor is-${session.status}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
      data-qx-workbench-editor="markdown"
    >
      {sourceMode || !editor ? (
        <div className="qx-host-workbench-markdown-source-wrap">
          {warningReason ? (
            <div className="qx-host-workbench-markdown-warning" role="status">
              <AlertTriangle size={13} aria-hidden="true" />
              <span>{sourceOnlyMessage}</span>
            </div>
          ) : null}
          <Textarea
            ref={sourceRef}
            className="qx-host-workbench-card-editor-input qx-host-workbench-markdown-source"
            value={sourceDraft}
            rows={session.item.editor?.rows}
            placeholder={session.item.editor?.placeholder}
            disabled={busy || !session.ready}
            aria-label={session.item.title || t("plugins.workbench.editor.bodyLabel", "Note body")}
            aria-invalid={session.invalid || undefined}
            onChange={(event) => onSourceChange(event.currentTarget.value)}
          />
          {editor ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy || session.invalid || !session.ready} onClick={enterVisualMode}>
              {t("plugins.workbench.editor.markdown.openVisual", "Open visual")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <MarkdownToolbar editor={editor} disabled={busy || !session.ready} onSource={enterSourceMode} />
          <EditorContent
            editor={editor}
            className="qx-host-workbench-markdown-content"
          />
        </>
      )}
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
          <Button type="button" size="sm" variant="default" disabled={busy || session.invalid} onClick={() => void onSave()}>
            {t("plugins.workbench.editor.save", "Save")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onCancel()}>
            {t("plugins.workbench.editor.cancel", "Cancel")}
          </Button>
        </span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { SegmentedControl } from "../../components/ui";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { formatQxShortcut, getQxShortcutPreset } from "../../utils/keyboard";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";

type Mode = "clean" | "markdown" | "json";

function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownSummary(text: string): string {
  const headings = text.match(/^#{1,6}\s+.+$/gm) ?? [];
  const links = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => `${match[1]} -> ${match[2]}`);
  return [
    `Headings: ${headings.length}`,
    `Links: ${links.length}`,
    "",
    ...headings.slice(0, 12),
    ...(links.length ? ["", ...links.slice(0, 12)] : []),
  ].join("\n");
}

function jsonFormat(text: string): string {
  const parsed = JSON.parse(text);
  return JSON.stringify(parsed, null, 2);
}

function statsFor(text: string) {
  const normalized = text.trim();
  const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const lines = text ? text.split(/\r?\n/).length : 0;
  const paragraphs = normalized ? normalized.split(/\n\s*\n/).filter(Boolean).length : 0;
  const readingMinutes = words || cjk ? Math.max(1, Math.ceil((words + cjk) / 400)) : 0;
  return { chars: text.length, words, cjk, lines, paragraphs, readingMinutes };
}

export default function DevTxtTool() {
  const setTab = useStore((state) => state.setTab);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("clean");
  const [message, setMessage] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const stats = useMemo(() => statsFor(text), [text]);
  const actionMenuShortcut = getQxShortcutPreset().actionMenu;
  const actionMenuLabel = formatQxShortcut(actionMenuShortcut) ?? "⌘K";

  useEffect(() => {
    const launch = takePendingModuleLaunch("documents");
    if (!launch) return;
    if (launch.surface === "clean" || launch.surface === "markdown" || launch.surface === "json") {
      setMode(launch.surface);
      setShowOutput(true);
    }
  }, []);

  const output = useMemo(() => {
    if (!text.trim()) return "";
    try {
      if (mode === "json") return jsonFormat(text);
      if (mode === "markdown") return markdownSummary(text);
      return normalizePlainText(text);
    } catch (error) {
      return String(error);
    }
  }, [mode, text]);

  const flash = (detail: string) => {
    setMessage(detail);
    window.setTimeout(() => setMessage(""), 1200);
  };

  const copyAll = async () => {
    if (!text) return;
    await writeText(text);
    flash("Copied");
  };

  const copyOutput = async () => {
    if (!output) return;
    await writeText(output);
    flash("Copied");
  };

  const pasteClipboard = async () => {
    try {
      const value = await readText();
      setText(value ?? "");
      setShowOutput(false);
      flash("Pasted");
    } catch (error) {
      flash(String(error));
    }
  };

  const clearText = () => {
    setText("");
    setShowOutput(false);
  };

  const goBack = () => setTab("launcher");

  const { onKeyDown } = useEscBack({
    inner: { active: showOutput, close: () => setShowOutput(false) },
    launcher: goBack,
  });

  const islandDetail = [
    `${stats.chars.toLocaleString()} chars`,
    `${stats.words.toLocaleString()} words`,
    `${stats.lines.toLocaleString()} lines`,
  ].join(" · ");

  const documentActions = useMemo<QxShellAction[]>(() => {
    const list: QxShellAction[] = [
      {
        label: showOutput ? "Copy Output" : "Copy All",
        disabled: showOutput ? !output : !text,
        onClick: () => void (showOutput ? copyOutput() : copyAll()),
      },
      {
        label: "Paste",
        onClick: () => void pasteClipboard(),
      },
      {
        label: showOutput ? "Show Editor" : "Show Output",
        disabled: !output,
        onClick: () => setShowOutput((value) => !value),
      },
      {
        label: "Clear",
        disabled: !text,
        tone: "danger",
        onClick: clearText,
      },
    ];
    return list;
  }, [output, showOutput, text]);

  return (
    <QxShell
      title="Documents"
      className="documents-shell"
      visual="solid"
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      onKeyDown={onKeyDown}
      search={
        <div className="qx-rss-detail-title">
          <span>Documents</span>
        </div>
      }
      trailing={
        <>
          <SegmentedControl
            value={mode}
            onChange={(next) => {
              setMode(next);
              // Switching transform mode should land on the processed view when there is content.
              if (text.trim()) setShowOutput(true);
            }}
            options={[
              { value: "clean", label: "Clean" },
              { value: "markdown", label: "Markdown" },
              { value: "json", label: "JSON" },
            ]}
          />
          {output ? (
            <button
              className={`qx-command-button${showOutput ? " is-active" : ""}`}
              onClick={() => setShowOutput((value) => !value)}
              type="button"
            >
              {showOutput ? "Editor" : "Output"}
            </button>
          ) : null}
          {message ? (
            <div className="qx-clipboard-status" aria-live="polite">
              {message}
            </div>
          ) : null}
        </>
      }
      primaryAction={{
        label: showOutput ? "Copy Output" : "Copy All",
        disabled: showOutput ? !output : !text,
        tone: "primary",
        onClick: () => void (showOutput ? copyOutput() : copyAll()),
      }}
      secondaryAction={{
        label: "Paste",
        onClick: () => void pasteClipboard(),
      }}
      actionTitle="Document Actions"
      actions={documentActions}
      island={{
        label: message || (showOutput ? "Output" : "Documents"),
        detail: islandDetail,
        tone: message ? "success" : "neutral",
        actionLabel: output && !showOutput ? "Preview →" : showOutput ? "Editor" : undefined,
        onAction: output
          ? () => setShowOutput((value) => !value)
          : undefined,
      }}
    >
      <div className="qx-documents-stage">
        {showOutput && output ? (
          <pre className="qx-documents-output-only">{output}</pre>
        ) : (
          <textarea
            className="qx-documents-textarea-full"
            value={text}
            autoFocus
            onFocus={requestPanelKeyWindow}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            placeholder="Paste text, Markdown, or JSON…"
            aria-label="Document text"
          />
        )}
        <div className="qx-documents-stats" aria-live="polite">
          <span>{stats.chars.toLocaleString()} chars</span>
          <span>{stats.words.toLocaleString()} words</span>
          <span>{stats.cjk.toLocaleString()} CJK</span>
          <span>{stats.lines.toLocaleString()} lines</span>
          <span>{stats.paragraphs.toLocaleString()} paragraphs</span>
          {stats.readingMinutes > 0 ? <span>~{stats.readingMinutes} min</span> : null}
          <span className="qx-documents-stats-mode">{mode}</span>
          <span className="qx-documents-stats-hint">Actions {actionMenuLabel}</span>
        </div>
      </div>
    </QxShell>
  );
}

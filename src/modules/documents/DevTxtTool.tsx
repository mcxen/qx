import { useMemo, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import QxShell from "../../components/QxShell";
import { SegmentedControl } from "../../components/ui";
import { useStore } from "../../store";

type Mode = "stats" | "markdown" | "json";

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
  const [mode, setMode] = useState<Mode>("stats");
  const [message, setMessage] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const stats = useMemo(() => statsFor(text), [text]);

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

  const copyOutput = async () => {
    if (!output) return;
    await writeText(output);
    setMessage("Copied");
    window.setTimeout(() => setMessage(""), 1200);
  };

  const pasteClipboard = async () => {
    const value = await readText();
    setText(value ?? "");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (showOutput) {
        setShowOutput(false);
      } else {
        setTab("launcher");
      }
    }
  };

  const islandDetail = [
    `${stats.chars.toLocaleString()} chars`,
    `${stats.words.toLocaleString()} words`,
    `${stats.lines.toLocaleString()} lines`,
  ].join(" \u00b7 ");

  const trailing = (
    <>
      <SegmentedControl
        value={mode}
        onChange={(v) => setMode(v)}
        options={[
          { value: "stats", label: "Clean" },
          { value: "markdown", label: "Markdown" },
          { value: "json", label: "JSON" },
        ]}
      />
      {output && (
        <button
          className={`qx-command-button${showOutput ? " is-active" : ""}`}
          onClick={() => setShowOutput((v) => !v)}
          type="button"
        >
          {showOutput ? "Editor" : "Output"}
        </button>
      )}
      {message && (
        <div className="qx-clipboard-status" aria-live="polite">
          {message}
        </div>
      )}
    </>
  );

  return (
    <QxShell
      title="DevTxtTool"
      className="documents-shell"
      onBack={() => setTab("launcher")}
      onKeyDown={onKeyDown}
      trailing={trailing}
      primaryAction={{
        label: showOutput ? "Copy Output" : "Copy All",
        kbd: "Enter",
        disabled: !text,
        tone: "primary",
        onClick: showOutput ? copyOutput : async () => {
          await writeText(text);
          setMessage("Copied");
          window.setTimeout(() => setMessage(""), 1200);
        },
      }}
      secondaryAction={{
        label: "Paste",
        kbd: "Cmd V",
        disabled: false,
        onClick: pasteClipboard,
      }}
      island={{
        label: message || (showOutput ? "Output" : "DevTxtTool"),
        detail: islandDetail,
        progress: Math.min(100, Math.max(5, stats.chars / 20)),
        tone: message ? "success" : "neutral",
        actionLabel: output && !showOutput ? "Preview \u2192" : undefined,
        onAction: output && !showOutput ? () => setShowOutput(true) : undefined,
      }}
    >
      {showOutput && output ? (
        <pre className="qx-documents-output-only">{output}</pre>
      ) : (
        <textarea
          className="qx-documents-textarea-full"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          placeholder="Paste text, Markdown, or JSON"
        />
      )}
    </QxShell>
  );
}

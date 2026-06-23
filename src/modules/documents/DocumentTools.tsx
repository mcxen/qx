import { useMemo, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import QxShell from "../../components/QxShell";

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

export default function DocumentTools() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("stats");
  const [message, setMessage] = useState("");
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

  return (
    <QxShell
      title="Documents"
      className="documents-shell"
      primaryAction={{
        label: "Copy Output",
        kbd: "↵",
        disabled: !output,
        tone: "primary",
        onClick: copyOutput,
      }}
      secondaryAction={{
        label: "Paste Clipboard",
        kbd: "⌘V",
        onClick: pasteClipboard,
      }}
      island={{
        label: message || "Document tools",
        detail: `${stats.chars.toLocaleString()} chars · ${stats.words.toLocaleString()} words · ${stats.lines.toLocaleString()} lines`,
        progress: Math.min(100, Math.max(8, stats.chars / 40)),
      }}
    >
      <div className="qx-documents-grid">
        <section className="qx-documents-editor" aria-label="Input document">
          <div className="qx-documents-toolbar">
            {(["stats", "markdown", "json"] as Mode[]).map((item) => (
              <button
                key={item}
                className={`qx-documents-mode${mode === item ? " is-active" : ""}`}
                onClick={() => setMode(item)}
                type="button"
              >
                {item === "stats" ? "Clean" : item === "markdown" ? "Markdown" : "JSON"}
              </button>
            ))}
          </div>
          <textarea
            className="qx-documents-textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            placeholder="Paste text, Markdown, or JSON"
          />
        </section>
        <aside className="qx-documents-side" aria-label="Document analysis">
          <div className="qx-documents-stats">
            <span>Characters</span>
            <strong>{stats.chars.toLocaleString()}</strong>
            <span>Words</span>
            <strong>{stats.words.toLocaleString()}</strong>
            <span>CJK</span>
            <strong>{stats.cjk.toLocaleString()}</strong>
            <span>Paragraphs</span>
            <strong>{stats.paragraphs.toLocaleString()}</strong>
            <span>Read</span>
            <strong>{stats.readingMinutes ? `${stats.readingMinutes} min` : "-"}</strong>
          </div>
          <pre className="qx-documents-output">{output || "Output preview"}</pre>
        </aside>
      </div>
    </QxShell>
  );
}

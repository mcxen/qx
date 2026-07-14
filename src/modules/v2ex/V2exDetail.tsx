import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { useEscBack } from "../../hooks/useEscBack";
import { stripDangerousHtmlAttributes } from "../../utils/sanitize-html";
import { type V2exTopic, formatTime } from "./types";

interface V2exDetailProps {
  topic: V2exTopic;
  onBack: () => void;
}

export function sanitizeTopicHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((el) => el.remove());
  stripDangerousHtmlAttributes(doc);
  doc.querySelectorAll("a").forEach((el) => {
    const a = el as HTMLAnchorElement;
    if (!a.hasAttribute("href")) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  doc.querySelectorAll("img").forEach((el) => {
    const img = el as HTMLImageElement;
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.borderRadius = "4px";
    img.style.display = "block";
    img.style.margin = "10px 0";
    img.setAttribute("loading", "lazy");
  });
  doc.querySelectorAll("pre,code").forEach((el) => {
    const h = el as HTMLElement;
    h.style.background = "var(--qx-bg-component-3)";
    h.style.padding = "2px 6px";
    h.style.borderRadius = "4px";
    h.style.fontSize = "12px";
    h.style.fontFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace';
  });
  doc.querySelectorAll("pre").forEach((el) => {
    const h = el as HTMLElement;
    h.style.padding = "10px 12px";
    h.style.overflowX = "auto";
  });
  doc.querySelectorAll("h1,h2,h3,h4").forEach((el) => {
    const h = el as HTMLElement;
    h.style.marginTop = "16px";
    h.style.marginBottom = "6px";
    h.style.fontWeight = "600";
  });
  doc.querySelectorAll("p,li").forEach((el) => {
    const h = el as HTMLElement;
    h.style.lineHeight = "inherit";
    h.style.margin = "6px 0";
  });
  doc.querySelectorAll("blockquote").forEach((el) => {
    const h = el as HTMLElement;
    h.style.borderLeft = "3px solid var(--qx-accent)";
    h.style.paddingLeft = "12px";
    h.style.color = "var(--qx-text-secondary)";
    h.style.margin = "10px 0";
  });
  return doc.body ? doc.body.innerHTML : html;
}

export default function V2exDetail({ topic, onBack }: V2exDetailProps) {
  const { onKeyDown: escKeyDown } = useEscBack({
    launcher: onBack,
  });

  const cleanContent = useMemo(() => sanitizeTopicHtml(topic.content), [topic.content]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    escKeyDown(event);
  };

  const actions = useMemo<QxShellAction[]>(() => [
    {
      label: "Open in Browser",
      kbd: "O",
      onClick: () => void openUrl(topic.url),
    },
    {
      label: "Back to Topics",
      kbd: "Esc",
      onClick: onBack,
    },
  ], [onBack, topic.url]);

  const island: BottomIslandContent = {
    label: "V2EX Detail",
    detail: `${topic.replies} replies · ${topic.node || "V2EX"}`,
  };

  return (
    <QxShell
      title={topic.title}
      className="v2ex-shell"
      onKeyDown={onKeyDown}
      overlayBottom
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: onBack }}
      search={
        <div className="qx-rss-detail-title">
          <span>{topic.title}</span>
        </div>
      }
      context={
        <aside className="qx-action-panel">
          <div className="qx-action-title">Topic Actions</div>
          <button className="qx-action-item" onClick={() => void openUrl(topic.url)} type="button">
            <span>Open in Browser</span>
            <kbd>O</kbd>
          </button>
          <button className="qx-action-item" onClick={onBack} type="button">
            <span>Back to Topics</span>
            <kbd>Esc</kbd>
          </button>
          <div className="qx-action-title">Info</div>
          <div className="v2ex-context-copy">
            <strong>{topic.node || "V2EX"}</strong>
            <span>{topic.author || "unknown"} · {topic.replies} replies</span>
            <span>{formatTime(topic.last_modified || topic.created)}</span>
          </div>
        </aside>
      }
      island={island}
      primaryAction={{
        label: "Open in Browser",
        kbd: "O",
        tone: "primary",
        onClick: () => void openUrl(topic.url),
      }}
      secondaryAction={{ label: "Actions", kbd: "Cmd K" }}
      actionTitle="Topic Actions"
      actions={actions}
    >
      <article className="qx-plugin-detail qx-rss-detail-content">
        <div className="qx-detail-header">
          <div style={{ minWidth: 0 }}>
            <div className="qx-detail-title">{topic.title}</div>
            <div className="qx-detail-meta">
              {topic.node || "V2EX"} · {topic.author || "unknown"} · {formatTime(topic.created)}
            </div>
          </div>
          <span className="qx-badge">{topic.replies}</span>
        </div>
        <div
          className="v2ex-detail-content"
          dangerouslySetInnerHTML={{ __html: cleanContent }}
          style={{ flex: 1, overflowY: "auto", padding: "10px 12px 16px" }}
        />
      </article>
    </QxShell>
  );
}

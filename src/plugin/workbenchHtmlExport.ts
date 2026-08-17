import { buildQxReplyTreeRows } from "../components/QxReplyList";
import type {
  PluginWorkbenchContentBlock,
  PluginWorkbenchDetail,
  PluginWorkbenchField,
  PluginWorkbenchImage,
  PluginWorkbenchReplyContent,
} from "./workbenchTypes";

export interface WorkbenchHtmlExportLabels {
  savedFrom: string;
  savedAt: string;
  replies: string;
  replyTo: string;
  originalPoster: string;
  likes: string;
  loadedReplies: string;
}

export interface WorkbenchHtmlExportInput {
  detail: PluginWorkbenchDetail;
  itemTitle?: string;
  panelTitle?: string;
  pluginName: string;
  locale: string;
  labels: WorkbenchHtmlExportLabels;
  exportedAt?: Date;
}

export interface WorkbenchHtmlExport {
  filename: string;
  html: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeFilename(title: string): string {
  const stem = title
    .replace(/[\\/:*?\"<>|]/g, " ")
    .replace(/[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return `${stem || "Qx Workbench"}.html`;
}

function renderImage(image: PluginWorkbenchImage): string {
  if (!/^data:image\//i.test(image.url)) {
    return image.alt ? `<span class="asset-fallback">${escapeHtml(image.alt)}</span>` : "";
  }
  const caption = image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : "";
  return `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || "")}" loading="lazy">${caption}</figure>`;
}

function renderContent(
  content: PluginWorkbenchContentBlock[] | PluginWorkbenchReplyContent[] | undefined,
  fallback = "",
): string {
  if (!content?.length) {
    return fallback ? `<p class="text">${escapeHtml(fallback)}</p>` : "";
  }
  return content.map((block) => {
    if (block.type === "text") return `<p class="text">${escapeHtml(block.text)}</p>`;
    if (block.type === "image") return renderImage(block.image);
    return block.alt ? `<span class="asset-fallback">${escapeHtml(block.alt)}</span>` : "";
  }).join("\n");
}

function renderFields(fields: PluginWorkbenchField[] | undefined): string {
  if (!fields?.length) return "";
  return `<dl>${fields.map((field) => (
    `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value == null || field.value === "" ? "—" : field.value)}</dd></div>`
  )).join("")}</dl>`;
}

function renderMedia(detail: PluginWorkbenchDetail): string {
  const images = [
    ...(detail.image ? [detail.image] : []),
    ...(detail.images || []),
  ];
  if (!images.length) return "";
  return `<div class="media">${images.map(renderImage).join("\n")}</div>`;
}

function renderChart(detail: PluginWorkbenchDetail): string {
  const chart = detail.chart;
  if (!chart?.points.length) return "";
  const title = chart.title ? `<h2>${escapeHtml(chart.title)}</h2>` : "";
  const summary = [chart.subtitle, chart.valueLabel, chart.value, chart.unit]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const rows = chart.points.map((point) => (
    `<tr><th>${escapeHtml(point.label || "")}</th><td>${escapeHtml(point.value)}</td></tr>`
  )).join("");
  return `<section>${title}${summary ? `<p class="meta">${summary}</p>` : ""}<table><tbody>${rows}</tbody></table></section>`;
}

function renderReplies(
  detail: PluginWorkbenchDetail,
  labels: WorkbenchHtmlExportLabels,
): string {
  const replies = detail.replies;
  if (!replies) return "";
  const repliesById = new Map(replies.items.map((reply) => [reply.id, reply]));
  const rows = buildQxReplyTreeRows(replies.items.map((reply) => ({
    ...reply,
    body: reply.body,
  })));
  const total = Number.isFinite(replies.total) ? Math.max(0, Number(replies.total)) : rows.length;
  const count = total > rows.length ? `${rows.length} / ${total}` : String(rows.length);
  const title = replies.title || labels.replies;
  const replyHtml = rows.map((reply) => {
    const source = repliesById.get(reply.id);
    const meta = [
      `#${escapeHtml(reply.floor)}`,
      escapeHtml(reply.author),
      reply.replyToAuthor
        ? escapeHtml(labels.replyTo.replace("{author}", reply.replyToAuthor.trim()))
        : "",
      reply.originalPoster ? escapeHtml(labels.originalPoster) : "",
      Number(reply.likeCount) > 0
        ? escapeHtml(labels.likes.replace("{count}", String(reply.likeCount)))
        : "",
      escapeHtml(reply.createdAt || ""),
    ].filter(Boolean).join(" · ");
    return `<article class="reply" style="--depth:${reply.treeDepth}"><div class="reply-meta">${meta}</div>${renderContent(source?.content, source?.body || "")}</article>`;
  }).join("\n");
  return `<section class="replies"><h2>${escapeHtml(title)} <small>${escapeHtml(count)}</small></h2>${total > rows.length ? `<p class="meta">${escapeHtml(labels.loadedReplies.replace("{loaded}", String(rows.length)).replace("{total}", String(total)))}</p>` : ""}${replyHtml}</section>`;
}

/** Information-like Workbench details get the host-owned HTML export action. */
export function isWorkbenchHtmlExportable(detail: PluginWorkbenchDetail | undefined): boolean {
  if (!detail) return false;
  return Boolean(
    detail.body?.trim()
    || detail.content?.length
    || detail.replies?.items.length,
  );
}

/** Serialize the current trusted Workbench snapshot into a portable reading document. */
export function buildWorkbenchHtmlExport(input: WorkbenchHtmlExportInput): WorkbenchHtmlExport {
  const { detail, labels } = input;
  const title = detail.title?.trim()
    || input.itemTitle?.trim()
    || input.panelTitle?.trim()
    || input.pluginName.trim()
    || "Qx Workbench";
  const savedAt = (input.exportedAt || new Date()).toLocaleString(input.locale);
  const media = renderMedia(detail);
  const body = renderContent(detail.content, detail.body);
  const sections = (detail.sections || []).map((section) => (
    `<section>${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}${section.body ? `<p class="text">${escapeHtml(section.body)}</p>` : ""}${renderFields(section.fields)}</section>`
  )).join("\n");
  const document = `<!doctype html>
<html lang="${escapeHtml(input.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{max-width:860px;margin:0 auto;padding:40px 24px 64px;color:#202124;background:#fff;font:16px/1.68 system-ui,-apple-system,"Segoe UI",sans-serif}header{padding-bottom:22px;border-bottom:1px solid #d9dde3;margin-bottom:28px}h1{font-size:2rem;line-height:1.2;margin:0 0 10px}h2{font-size:1.25rem;margin:32px 0 12px}.meta,.reply-meta,figcaption{color:#667085;font-size:.875rem}.text{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#1463d9}img{display:block;max-width:100%;height:auto;margin:auto;border-radius:8px}figure{margin:22px 0}figcaption{margin-top:8px;text-align:center}.media{display:grid;gap:16px}.media figure{margin:0}dl{display:grid;gap:1px;background:#d9dde3;border:1px solid #d9dde3;border-radius:8px;overflow:hidden}dl div{display:grid;grid-template-columns:minmax(120px,34%) 1fr;gap:18px;background:#fff;padding:10px 12px}dt{color:#667085}dd{margin:0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:left}.replies{margin-top:42px;padding-top:8px;border-top:2px solid #d9dde3}.replies h2 small{color:#667085;font-weight:400}.reply{margin:0 0 10px calc(min(var(--depth),8) * 18px);padding:12px 14px;border-left:2px solid #d9dde3;background:#f7f8fa;border-radius:0 8px 8px 0}.reply .text{margin:5px 0 0}.asset-fallback{display:inline-block;color:#667085;font-size:.875rem}@media(prefers-color-scheme:dark){body{color:#e8eaed;background:#17181a}header,.replies{border-color:#41444a}.meta,.reply-meta,figcaption,dt,.asset-fallback{color:#aeb4bf}dl{background:#41444a;border-color:#41444a}dl div{background:#202124}th,td{border-color:#383b40}.reply{background:#202124;border-color:#555a63}a{color:#8ab4f8}}
</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1>${detail.subtitle ? `<p>${escapeHtml(detail.subtitle)}</p>` : ""}<p class="meta">${escapeHtml(labels.savedFrom.replace("{source}", input.pluginName))}<br>${escapeHtml(labels.savedAt.replace("{time}", savedAt))}</p></header>
<main>${detail.mediaPlacement !== "after-body" ? media : ""}${body}${detail.mediaPlacement === "after-body" ? media : ""}${renderChart(detail)}${renderFields(detail.fields)}${sections}${renderReplies(detail, labels)}</main>
</body>
</html>`;
  return { filename: safeFilename(title), html: document };
}

export function utf8TextToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return window.btoa(chunks.join(""));
}

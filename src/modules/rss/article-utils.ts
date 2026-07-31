import { stripDangerousHtmlAttributes } from "../../utils/sanitize-html";

export function startOfDay(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(x.getTime() / 1000);
}

export function classifyArticleTime(publishedAt: number): "today" | "yesterday" | "earlier" {
  if (!publishedAt) return "earlier";
  const today = startOfDay(new Date());
  const yesterday = today - 86400;
  if (publishedAt >= today) return "today";
  if (publishedAt >= yesterday) return "yesterday";
  return "earlier";
}

export function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadFilename(title: string): string {
  const stem = title
    .replace(/[\\/:*?\"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return `${stem || "article"}.html`;
}

/** Download a readable, sanitized article snapshot to the user's Downloads folder. */
export function downloadArticleHtml(article: {
  title: string;
  link: string;
  author: string;
  published_at: number;
  content: string;
  summary: string;
}): void {
  const title = article.title.trim() || "Article";
  const content = sanitizeHtml(article.content || article.summary, article.link, "webview");
  const source = absoluteHttpUrl(article.link);
  const byline = [article.author.trim(), formatDate(article.published_at)].filter(Boolean).join(" · ");
  const htmlDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;color:#202124;font:17px/1.65 system-ui,sans-serif}img{max-width:100%;height:auto}a{color:#1463d9}pre{overflow:auto}</style>
</head><body><article><h1>${escapeHtml(title)}</h1>${byline ? `<p>${escapeHtml(byline)}</p>` : ""}${source ? `<p><a href="${escapeHtml(source)}">${escapeHtml(source)}</a></p>` : ""}${content}</article></body></html>`;
  const url = URL.createObjectURL(new Blob([htmlDocument], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadFilename(title);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

function absoluteHttpUrl(value: string, baseUrl?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function lastSrcsetCandidate(value: string): string {
  const candidates = value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
  return candidates[candidates.length - 1] ?? "";
}

function imageRemoteSource(img: HTMLImageElement, baseUrl?: string): string | null {
  const source =
    img.getAttribute("data-src")
    || img.getAttribute("data-original")
    || img.getAttribute("data-lazy-src")
    || img.getAttribute("data-url")
    || img.getAttribute("src")
    || lastSrcsetCandidate(img.getAttribute("data-srcset") || img.getAttribute("srcset") || "");
  return absoluteHttpUrl(source, baseUrl);
}

/** Returns the article's original HTTP(S) images for Rust cache prewarming. */
export function collectArticleImageUrls(html: string, baseUrl?: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const urls = new Set<string>();
  doc.querySelectorAll("img").forEach((element) => {
    const source = imageRemoteSource(element as HTMLImageElement, baseUrl);
    if (source) urls.add(source);
  });
  return [...urls];
}

export type ArticleImageLoadingMode = "webview" | "rust-cache";

export function sanitizeHtml(
  html: string,
  baseUrl?: string,
  imageLoadingMode: ArticleImageLoadingMode = "webview",
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((el) => el.remove());
  stripDangerousHtmlAttributes(doc);
  doc.querySelectorAll("a").forEach((el) => {
    const a = el as HTMLAnchorElement;
    if (!a.hasAttribute("href")) return;
    const href = absoluteHttpUrl(a.getAttribute("href") ?? "", baseUrl);
    if (href) a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  doc.querySelectorAll("img").forEach((el) => {
    const img = el as HTMLImageElement;
    const remoteSource = imageRemoteSource(img, baseUrl);
    if (remoteSource) {
      if (imageLoadingMode === "rust-cache") {
        img.setAttribute("data-qx-remote-src", remoteSource);
        img.setAttribute("src", TRANSPARENT_PIXEL);
        img.setAttribute("data-qx-image-state", "loading");
      } else {
        img.setAttribute("src", remoteSource);
        img.removeAttribute("data-qx-remote-src");
        img.removeAttribute("data-qx-image-state");
      }
      img.removeAttribute("srcset");
      img.removeAttribute("data-srcset");
    }
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.borderRadius = "4px";
    img.style.display = "block";
    img.style.margin = "10px 0";
    // The visible article owns scrolling and only mounts one body at a time.
    // Eager loading also prevents a local Rust-cached source from being gated
    // a second time by the browser after the reader has already prepared it.
    img.setAttribute("loading", "eager");
    img.setAttribute("decoding", "async");
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

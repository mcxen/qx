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

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((el) => el.remove());
  doc.querySelectorAll("a").forEach((el) => {
    const a = el as HTMLAnchorElement;
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

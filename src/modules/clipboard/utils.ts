import type { ClipboardEntry } from "../../store";

export function classify(item: ClipboardEntry): "pinned" | "links" | "code" | "long" | "frequent" | "image" | "file" | "text" {
  if (item.file_path) return "file";
  if (item.image_path) return "image";
  const text = item.text.trim();
  if (/^https?:\/\/\S+$/i.test(text)) return "links";
  if (
    /[{}[\]();]/.test(text) ||
    /\b(function|const|let|class|import|SELECT|FROM|fn|pub)\b/.test(text)
  ) {
    return "code";
  }
  if (text.length > 280 || text.includes("\n")) return "long";
  return "text";
}

export function sectionName(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "Recent";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startItem = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startToday - startItem) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This Week";
  return "Older";
}

export function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function formatCopied(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startItem = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  if (startToday === startItem) return `Today at ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} at ${time}`;
}

export function formatMeta(item: ClipboardEntry): string {
  if (item.file_path) return item.file_path;
  if (item.image_path) return "Image";
  const lines = item.text.split(/\r?\n/).length;
  const count = item.text.length;
  const parts = [`${count} chars`];
  if (lines > 1) parts.push(`${lines} lines`);
  if (item.copy_count > 0) parts.push(`${item.copy_count} copies`);
  return parts.join(" · ");
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function contentType(item: ClipboardEntry): string {
  const kind = classify(item);
  if (kind === "links") return "Link";
  if (kind === "code") return "Code";
  if (kind === "image") return "Image";
  if (kind === "file") return "File";
  return "Text";
}

export function matchesQuery(item: ClipboardEntry, q: string): boolean {
  if (!q) return true;
  const haystack = `${item.text} ${item.file_path ?? ""} ${classify(item)} ${formatMeta(item)}`.toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

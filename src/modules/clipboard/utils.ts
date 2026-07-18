import type { ClipboardEntry } from "../../store";
import type { Locale } from "../../i18n";

type Translate = (key: string, fallback: string) => string;

export function dateKey(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

export function sectionName(timestamp: string, t: Translate): string {
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return t("clipboard.section.recent", "Recent");
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startItem = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startToday - startItem) / 86_400_000);
  if (diff === 0) return t("clipboard.section.today", "Today");
  if (diff === 1) return t("clipboard.section.yesterday", "Yesterday");
  if (diff < 7) return t("clipboard.section.thisWeek", "This Week");
  return t("clipboard.section.older", "Older");
}

export function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function formatCopied(timestamp: string, locale: Locale, t: Translate): string {
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startItem = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = date.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  if (startToday === startItem) {
    return t("clipboard.copied.today", "Today at {time}").replace("{time}", time);
  }
  const day = date.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  return t("clipboard.copied.on", "{date} at {time}")
    .replace("{date}", day)
    .replace("{time}", time);
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

export type ClipboardFileKind = "image" | "video" | "audio" | "pdf" | "file";

export function clipboardFileKind(path: string): ClipboardFileKind {
  const base = path.split(/[/\\]/).pop() || path;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "avi", "mkv", "webm", "mpeg", "mpg"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "aac", "flac", "ogg"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return "file";
}

export function contentType(item: ClipboardEntry, t: Translate): string {
  const kind = classify(item);
  if (kind === "links") return t("clipboard.type.link", "Link");
  if (kind === "code") return t("clipboard.type.code", "Code");
  if (kind === "image") return t("clipboard.type.image", "Image");
  if (kind === "file" && item.file_path) {
    const fileKind = clipboardFileKind(item.file_path);
    if (fileKind === "image") return t("clipboard.type.image", "Image");
    if (fileKind === "video") return t("clipboard.type.video", "Video");
    if (fileKind === "audio") return t("clipboard.type.audio", "Audio");
    if (fileKind === "pdf") return t("clipboard.type.pdf", "PDF");
    return t("clipboard.type.file", "File");
  }
  return t("clipboard.type.text", "Text");
}

export function matchesQuery(item: ClipboardEntry, q: string): boolean {
  if (!q) return true;
  const haystack = `${item.text} ${item.file_path ?? ""} ${classify(item)} ${formatMeta(item)}`.toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

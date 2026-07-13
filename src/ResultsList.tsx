import { useStore } from "./store";
import type { AppEntry } from "./store";
import { memo, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { LucideIcon } from "lucide-react";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  Palette,
  Presentation,
} from "lucide-react";
import { LoadingLabel, Skeleton } from "./components/ui";
import AppResultContextMenu from "./launcher/AppResultContextMenu";
import { useDisplayName } from "./search/appDisplay";

const FILE_ICON_BY_EXTENSION: Record<string, string> = {
  pdf: "file-pdf",
  png: "file-image",
  jpg: "file-image",
  jpeg: "file-image",
  gif: "file-image",
  webp: "file-image",
  avif: "file-image",
  heic: "file-image",
  heif: "file-image",
  svg: "file-image",
  ico: "file-image",
  tif: "file-image",
  tiff: "file-image",
  bmp: "file-image",
  mp4: "file-video",
  mov: "file-video",
  m4v: "file-video",
  avi: "file-video",
  mkv: "file-video",
  webm: "file-video",
  mp3: "file-audio",
  wav: "file-audio",
  aiff: "file-audio",
  aif: "file-audio",
  flac: "file-audio",
  m4a: "file-audio",
  aac: "file-audio",
  ogg: "file-audio",
  zip: "file-archive",
  rar: "file-archive",
  "7z": "file-archive",
  tar: "file-archive",
  gz: "file-archive",
  tgz: "file-archive",
  bz2: "file-archive",
  xz: "file-archive",
  dmg: "file-archive",
  pkg: "file-archive",
  ts: "file-code",
  tsx: "file-code",
  js: "file-code",
  jsx: "file-code",
  mjs: "file-code",
  cjs: "file-code",
  py: "file-code",
  rs: "file-code",
  go: "file-code",
  java: "file-code",
  c: "file-code",
  h: "file-code",
  cpp: "file-code",
  hpp: "file-code",
  cs: "file-code",
  swift: "file-code",
  kt: "file-code",
  rb: "file-code",
  php: "file-code",
  html: "file-code",
  css: "file-code",
  scss: "file-code",
  sass: "file-code",
  json: "file-code",
  jsonc: "file-code",
  yml: "file-code",
  yaml: "file-code",
  toml: "file-code",
  xml: "file-code",
  sh: "file-code",
  zsh: "file-code",
  bash: "file-code",
  sql: "file-code",
  vue: "file-code",
  svelte: "file-code",
  astro: "file-code",
  txt: "file-text",
  md: "file-text",
  markdown: "file-text",
  rtf: "file-text",
  log: "file-text",
  doc: "file-text",
  docx: "file-text",
  pages: "file-text",
  csv: "file-sheet",
  tsv: "file-sheet",
  xls: "file-sheet",
  xlsx: "file-sheet",
  numbers: "file-sheet",
  ppt: "file-presentation",
  pptx: "file-presentation",
  key: "file-presentation",
  fig: "file-design",
  sketch: "file-design",
  psd: "file-design",
  ai: "file-design",
  ttf: "file-font",
  otf: "file-font",
  woff: "file-font",
  woff2: "file-font",
};

const FILE_LABEL_BY_ICON_KIND: Record<string, string> = {
  "file-pdf": "PDF",
  "file-image": "Image",
  "file-video": "Video",
  "file-audio": "Audio",
  "file-archive": "Archive",
  "file-code": "Code",
  "file-text": "Text",
  "file-sheet": "Sheet",
  "file-presentation": "Slides",
  "file-design": "Design",
  "file-font": "Font",
};

const LUCIDE_ICON_BY_KIND: Record<string, LucideIcon> = {
  folder: Folder,
  file: File,
  "file-pdf": FileText,
  "file-image": FileImage,
  "file-video": FileVideo,
  "file-audio": FileAudio,
  "file-archive": FileArchive,
  "file-code": FileCode2,
  "file-text": FileText,
  "file-sheet": FileSpreadsheet,
  "file-presentation": Presentation,
  "file-design": Palette,
  "file-font": FileType,
};

function fileExtension(item: AppEntry): string {
  const leaf = (item.name || item.path.split(/[\\/]/).pop() || "").trim();
  const dotIndex = leaf.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === leaf.length - 1) return "";
  return leaf.slice(dotIndex + 1).toLowerCase();
}

function fileIconKind(item: AppEntry): string {
  return FILE_ICON_BY_EXTENSION[fileExtension(item)] ?? "file";
}

function iconKind(item: AppEntry): string {
  if (item.kind === "folder") return "folder";
  if (item.kind === "file") return fileIconKind(item);
  if (item.kind === "clipboard") return "clipboard";
  if (item.kind === "calculation") return "calculator";
  if (item.icon.startsWith("builtin:")) {
    const value = `${item.icon} ${item.path}`.toLowerCase();
    if (value.includes("clipboard")) return "clipboard";
    if (value.includes("screencap")) return "record";
    if (value.includes("rss")) return "rss";
    if (value.includes("macro")) return "macro";
    if (value.includes("document") || value.includes("doc")) return "document";
    if (value.includes("calculator") || value.includes("calc")) return "calculator";
    if (value.includes("settings")) return "settings";
    if (value.includes("folder")) return "folder";
    return "command";
  }
  return "app";
}

function sourceLabel(item: AppEntry): string {
  if (item.kind === "folder") return "Folder";
  if (item.kind === "file") return FILE_LABEL_BY_ICON_KIND[fileIconKind(item)] ?? "File";
  if (item.kind === "clipboard") return "Clipboard";
  if (item.kind === "calculation") return "Copy Result";
  if (item.kind === "command") return "Command";
  return "Application";
}

function fallbackLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "A";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function lucideIconForKind(kind: string): LucideIcon | null {
  return LUCIDE_ICON_BY_KIND[kind] ?? null;
}

function AppIcon({ item, label }: { item: AppEntry; label: string }) {
  const [failed, setFailed] = useState(false);
  const kind = iconKind(item);
  const LucideIcon = lucideIconForKind(kind);
  const builtin = item.icon.startsWith("builtin:");
  const canUseImage =
    item.icon &&
    !failed &&
    !builtin &&
    !item.icon.startsWith("plugin:");

  useEffect(() => {
    setFailed(false);
  }, [item.icon]);

  return (
    <span className={`qx-list-icon qx-app-icon kind-${kind}`} aria-hidden="true">
      {canUseImage ? (
        <img
          src={item.icon.startsWith("/") ? convertFileSrc(item.icon) : item.icon}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : LucideIcon ? (
        <LucideIcon className="qx-app-icon-lucide" size={13} strokeWidth={2.1} />
      ) : builtin ? (
        <span className="qx-app-icon-symbol" />
      ) : (
        <span className="qx-app-icon-fallback">{fallbackLabel(label)}</span>
      )}
    </span>
  );
}

const ResultItem = memo(function ResultItem({ item, index, label }: { item: AppEntry; index: number; label: string }) {
  const selected = useStore((state) => state.selectedIndex === index);
  const setSelectedIndex = useStore((state) => state.setSelectedIndex);

  return (
    <div
      onMouseEnter={() => setSelectedIndex(index)}
      className={`qx-list-row${selected ? " is-active" : ""}`}
    >
      <AppIcon item={item} label={label} />
      <div className="qx-list-copy">
        <div className="qx-list-title" style={{ fontWeight: 500 }}>
          {label}
        </div>
        <div className="qx-list-subtitle">
          {item.path.replace("/Applications/", "").replace("/System/Applications/", "System/")}
        </div>
      </div>
      <span className="qx-list-time">
        {sourceLabel(item)}
      </span>
    </div>
  );
});

function ResultSkeletonRows() {
  return (
    <div className="qx-skeleton-stack" aria-label="Loading apps">
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="qx-skeleton-row" key={index}>
          <Skeleton className="qx-skeleton-icon" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Skeleton className="qx-skeleton-line long" />
            <Skeleton className="qx-skeleton-line medium" style={{ marginTop: 8 }} />
          </div>
          <Skeleton className="qx-skeleton-line short" style={{ width: 72 }} />
        </div>
      ))}
    </div>
  );
}

export default function ResultsList({
  items,
  onItemClick,
  loadingPhase,
}: {
  items: AppEntry[];
  onItemClick: (item: AppEntry) => void;
  loadingPhase?: string;
}) {
  const getDisplayName = useDisplayName();
  return (
    <div className="qx-plugin-list" style={{ flex: 1, borderRight: "none" }}>
      {items.length > 0 && (
        <div className="qx-section-header">Suggestions</div>
      )}
      {items.map((item, i) => (
        <AppResultContextMenu item={item} key={`${item.kind}:${item.path}:${item.name}`}>
          <div onClick={() => onItemClick(item)}>
            <ResultItem item={item} index={i} label={getDisplayName(item)} />
          </div>
        </AppResultContextMenu>
      ))}
      {items.length === 0 && loadingPhase === "loading-apps" && (
        <>
          <ResultSkeletonRows />
          <div className="qx-empty-state">
            <LoadingLabel>Loading apps...</LoadingLabel>
          </div>
        </>
      )}
      {items.length === 0 && loadingPhase !== "loading-apps" && (
        <div
          style={{
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--qx-text-tertiary)",
            fontSize: 13,
          }}
        >
          No results found
        </div>
      )}
    </div>
  );
}

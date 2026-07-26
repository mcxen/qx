import { useStore } from "./store";
import type { AppEntry } from "./store";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  SquareTerminal,
  ChevronRight,
} from "lucide-react";
import { QxListLoading } from "./components/QxListLoading";
import { Kbd } from "./components/ui";
import { getQxListItemProps, useQxListSelection } from "./hooks/useQxListSelection";
import { useDisplayName } from "./search/appDisplay";
import { useT } from "./i18n";
import BetaBadge from "./components/BetaBadge";
import PluginBackgroundBadge from "./components/PluginBackgroundBadge";
import {
  commandNameFromAppPath,
  pluginIdFromAppPath,
} from "./plugin/backgroundActivity";
import { isBetaModule } from "./modules/catalog";
import { useSettingsStore } from "./modules/settings/store";
import {
  isEntryHidden,
  isEntryPinned,
  metadataKeyForEntry,
} from "./search/searchMetadata";
import { formatQxShortcut } from "./utils/keyboard";
import { EyeOff, Pin } from "lucide-react";
import type { LauncherResultRow } from "./launcher/resultRows";
import { builtinModuleIcon, builtinModuleIconKind } from "./modules/builtinIcons";

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
  terminal: SquareTerminal,
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
    return builtinModuleIconKind(item.icon);
  }
  return "app";
}

function sourceLabel(item: AppEntry, t: (key: string, fallback: string) => string): string {
  if (item.kind === "folder") return t("launcher.source.folder", "Folder");
  if (item.kind === "file") {
    return FILE_LABEL_BY_ICON_KIND[fileIconKind(item)] ?? t("launcher.source.file", "File");
  }
  if (item.kind === "clipboard") return t("launcher.source.clipboard", "Clipboard");
  if (item.kind === "calculation") return t("launcher.source.calculation", "Copy Result");
  // Built-in / plugin panel openers are modules, not free-floating commands.
  if (item.moduleId || item.path.startsWith("__qx:plugin:") || item.path.startsWith("__qx:")) {
    if (item.kind === "command" || item.path.startsWith("__qx:")) {
      return t("launcher.source.module", "Module");
    }
  }
  if (item.kind === "command") return t("launcher.source.command", "Command");
  return t("launcher.source.app", "Application");
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

export function LauncherAppIcon({ item, label }: { item: AppEntry; label: string }) {
  const [failed, setFailed] = useState(false);
  const kind = iconKind(item);
  const builtin = item.icon.startsWith("builtin:");
  const LucideIcon = builtinModuleIcon(item.icon) ?? lucideIconForKind(kind);
  const canUseImage =
    item.icon &&
    !failed &&
    !builtin &&
    !item.icon.startsWith("plugin:");
  const imageSrc = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(item.icon)
    ? convertFileSrc(item.icon)
    : item.icon;

  useEffect(() => {
    setFailed(false);
  }, [item.icon]);

  return (
    <span className={`qx-list-icon qx-app-icon kind-${kind}`} aria-hidden="true">
      {canUseImage ? (
        <img
          src={imageSrc}
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

function resultSubtitle(item: AppEntry): string {
  if (item.subtitle) return item.subtitle;
  return item.path
    .replace("/Applications/", "")
    .replace("/System/Applications/", "System/")
    .replace(/^__qx:launch:.+$/, "Module")
    .replace(/^__qx:cmd:.+$/, "Command")
    .replace(/^__qx:rss:.+$/, "RSS")
    .replace(/^__qx:/, "");
}

const ResultItem = memo(function ResultItem({
  item,
  index,
  selectedIndex,
  label,
}: {
  item: AppEntry;
  index: number;
  selectedIndex: number;
  label: string;
}) {
  const settings = useSettingsStore((state) => state.settings);
  const metadataKey = metadataKeyForEntry(item);
  const pinned = isEntryPinned(settings, metadataKey);
  const hidden = isEntryHidden(settings, metadataKey);
  const shortcutKey = metadataKey ? settings.app_shortcuts[metadataKey]?.key : undefined;
  const shortcutLabel = shortcutKey && settings.app_shortcuts[metadataKey!]?.enabled !== false
    ? formatQxShortcut(shortcutKey)
    : undefined;
  const backgroundPluginId = pluginIdFromAppPath(item.path);
  const backgroundCommandName = commandNameFromAppPath(item.path);
  const subtitle = resultSubtitle(item);
  const density = settings.appearance.launcher_result_density === "compact" ? "compact" : "comfortable";
  const t = useT();

  return (
    <div
      {...getQxListItemProps(index, selectedIndex, {
        className: [
          "qx-launcher-row",
          `density-${density}`,
          pinned ? "is-pinned" : "",
          hidden ? "is-hidden-app" : "",
        ].filter(Boolean).join(" "),
        role: "option",
      })}
      data-qx-result-index={index}
    >
      <LauncherAppIcon item={item} label={label} />
      <div className="qx-list-copy">
        <div className="qx-list-title qx-module-title-with-badge">
          <span>{label}</span>
          {pinned && (
            <Pin
              className="qx-launcher-pin-mark"
              size={11}
              strokeWidth={2.4}
              aria-hidden="true"
            />
          )}
          {hidden && (
            <EyeOff
              className="qx-launcher-hidden-mark"
              size={11}
              strokeWidth={2.4}
              aria-hidden="true"
            />
          )}
          {isBetaModule(item.moduleId) && <BetaBadge />}
          <PluginBackgroundBadge
            pluginId={backgroundPluginId}
            commandName={backgroundCommandName}
            compact
          />
        </div>
        {density === "comfortable" && (
          <div className="qx-list-subtitle" title={subtitle}>
            {subtitle}
          </div>
        )}
      </div>
      <span className="qx-list-meta">
        {shortcutLabel && (
          <span className="qx-launcher-shortcut-kbd">
            <Kbd>{shortcutLabel}</Kbd>
          </span>
        )}
        <span className="qx-list-time">{sourceLabel(item, t)}</span>
      </span>
    </div>
  );
});

/**
 * Keyboard selection and pointer hover are deliberately independent:
 * arrows move selection immediately; hover is visual only; click confirms.
 */
export default function ResultsList({
  items,
  rows,
  onItemClick,
  onToggleCategory,
  onSelectRow,
  onOpenActionsAt,
  loadingPhase,
}: {
  items: AppEntry[];
  rows: LauncherResultRow[];
  onItemClick: (item: AppEntry) => void;
  onToggleCategory: (categoryId: string) => void;
  onSelectRow: (index: number) => void;
  onOpenActionsAt: (x: number, y: number) => void;
  loadingPhase?: string;
}) {
  const t = useT();
  const getDisplayName = useDisplayName();
  const selectedIndex = useStore((state) => state.selectedIndex);
  const loadingLabel = t("launcher.loadingApps", "Loading apps...");
  const listRef = useRef<HTMLDivElement>(null);

  // Async search/filter updates preserve the current keyboard or click selection.
  const listSignature = useMemo(
    () => rows.map((row) => row.key).join("\n"),
    [rows],
  );

  // Shared selection paint + nearest scroll follow (same contract as Clipboard).
  useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature,
  });

  return (
    <div
      ref={listRef}
      className="qx-plugin-list qx-launcher-results"
      style={{ flex: 1, borderRight: "none" }}
    >
      {rows.map((row, rowIndex) => {
        if (row.kind === "category") {
          return (
            <div
              {...getQxListItemProps(rowIndex, selectedIndex, {
                className: "qx-file-category-row",
                role: "option",
              })}
              key={row.key}
              aria-expanded={!row.collapsed}
              onClick={() => {
                onSelectRow(rowIndex);
                onToggleCategory(row.categoryId);
              }}
            >
              <ChevronRight
                className={`qx-file-category-chevron${row.collapsed ? "" : " is-expanded"}`}
                size={13}
                strokeWidth={2.1}
                aria-hidden="true"
              />
              <span className="qx-file-category-label">
                {t(row.translationKey, row.label)}
              </span>
              <span className="qx-file-category-count">{row.count}</span>
            </div>
          );
        }
        const item = row.item;
        return (
          <div
            key={row.key}
            onClick={() => onSelectRow(rowIndex)}
            onDoubleClick={() => onItemClick(item)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelectRow(rowIndex);
              onOpenActionsAt(event.clientX, event.clientY);
            }}
          >
            <ResultItem
              item={item}
              index={rowIndex}
              selectedIndex={selectedIndex}
              label={getDisplayName(item)}
            />
          </div>
        );
      })}
      {items.length === 0 && loadingPhase === "loading-apps" && (
        <QxListLoading
          ariaLabel={loadingLabel}
          label={loadingLabel}
          rows={7}
        />
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
          {t("launcher.noResults", "No results found")}
        </div>
      )}
    </div>
  );
}

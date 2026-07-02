import { useStore } from "./store";
import type { AppEntry } from "./store";
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LoadingLabel, Skeleton } from "./components/ui";
import AppResultContextMenu from "./launcher/AppResultContextMenu";
import { useDisplayName } from "./search/appDisplay";

function iconKind(item: AppEntry): string {
  if (item.kind === "file") return "file";
  if (item.kind === "folder") return "folder";
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
  if (item.kind === "file") return "File";
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

function AppIcon({ item, label }: { item: AppEntry; label: string }) {
  const [failed, setFailed] = useState(false);
  const kind = iconKind(item);
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
      ) : builtin ? (
        <span className="qx-app-icon-symbol" />
      ) : (
        <span className="qx-app-icon-fallback">{fallbackLabel(label)}</span>
      )}
    </span>
  );
}

function ResultItem({ item, index, label }: { item: AppEntry; index: number; label: string }) {
  const { selectedIndex, setSelectedIndex } = useStore();
  const selected = index === selectedIndex;

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
}

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

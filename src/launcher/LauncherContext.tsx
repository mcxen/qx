import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";
import { useT } from "../i18n";
import type { HistoryEntry, SearchHistoryEntry } from "../store";
import type { QuickEntry } from "./types";

function ContextSection({
  title,
  children,
  spacing = false,
}: {
  title: string;
  children: ReactNode;
  spacing?: boolean;
}) {
  return (
    <>
      <div className={`qx-context-title${spacing ? " has-spacing" : ""}`}>
        {title}
      </div>
      {children}
    </>
  );
}

function ContextEntry({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button className="qx-context-entry" onClick={onClick} type="button">
      <span className="qx-context-entry-title">{title}</span>
      <span className="qx-context-entry-subtitle">{subtitle}</span>
    </button>
  );
}

export default function LauncherContext({
  quickEntries,
  recentLaunches,
  recentSearches,
  query,
  onSearchSelect,
}: {
  quickEntries: QuickEntry[];
  recentLaunches: HistoryEntry[];
  recentSearches: SearchHistoryEntry[];
  query: string;
  onSearchSelect: (query: string) => void;
}) {
  const t = useT();

  return (
    <div className="qx-launcher-context">
      <ContextSection title={t("launcher.quickEntries", "Quick Entries")}>
        {quickEntries.map((entry) => (
          <ContextEntry
            key={entry.id}
            title={entry.title}
            subtitle={entry.subtitle}
            onClick={entry.onClick}
          />
        ))}
      </ContextSection>

      {recentLaunches.length > 0 && (
        <ContextSection title={t("launcher.recent", "Recent")} spacing>
          {recentLaunches.map((entry) => (
            <ContextEntry
              key={`launch-${entry.id}`}
              title={entry.name}
              subtitle={entry.timestamp}
              onClick={() => {
                invoke("open_app", { path: entry.path }).catch(() => {});
                getCurrentWindow().hide().catch(() => {});
              }}
            />
          ))}
        </ContextSection>
      )}

      {recentSearches.length > 0 && !query && (
        <ContextSection title={t("launcher.recentSearches", "Recent Searches")} spacing>
          {recentSearches.map((entry) => (
            <ContextEntry
              key={`search-${entry.id}`}
              title={entry.query}
              subtitle={entry.timestamp}
              onClick={() => onSearchSelect(entry.query)}
            />
          ))}
        </ContextSection>
      )}
    </div>
  );
}

import {
  Clipboard,
  Cloud,
  FileText,
  MessageSquare,
  Radio,
  Rss,
  Settings as SettingsIcon,
  Square,
  Video,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { QuickEntry } from "./types";

const ICON_BY_TARGET: Record<string, LucideIcon> = {
  clipboard: Clipboard,
  "qx-ai": MessageSquare,
  rss: Rss,
  screencap: Video,
  v2ex: Radio,
  weather: Cloud,
  documents: FileText,
  macros: Zap,
  settings: SettingsIcon,
};

const MAX_ICONS = 5;

export default function QuickEntryIcons({
  entries,
}: {
  entries: QuickEntry[];
}) {
  if (entries.length === 0) return null;
  const visible = entries.slice(0, MAX_ICONS);
  return (
    <div className="qx-quick-entry-icons" role="toolbar" aria-label="Quick entries">
      {visible.map((entry) => {
        const Icon = ICON_BY_TARGET[entry.target] ?? Square;
        return (
          <button
            key={entry.id}
            type="button"
            className="qx-quick-entry-icon"
            title={entry.title}
            aria-label={entry.title}
            onClick={entry.onClick}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

import {
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LucideIcon } from "lucide-react";
import {
  AlignLeft,
  AudioLines,
  CalendarDays,
  Code2,
  File,
  FileText,
  Folder,
  Image,
  Link,
  Pin,
  Video,
} from "lucide-react";
import type { ClipboardEntry } from "../../store";
import {
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type CalendarRange,
} from "../../components/ui";
import type { QxListItemProps } from "../../hooks/useQxListSelection";
import { useLocale, useT } from "../../i18n";
import {
  classify,
  clipboardFileKind,
  clipboardFileLabel,
  dateKey,
  preview,
} from "./utils";

export interface ClipboardHistorySection {
  key: string;
  title: string;
  items: ClipboardEntry[];
}

type VirtualClipboardRow =
  | { type: "header"; key: string; title: string; count: number }
  | { type: "item"; key: string; item: ClipboardEntry; itemIndex: number };

type ClipboardIconKind = ReturnType<typeof classify> | "pin" | "video" | "audio" | "pdf" | "folder";

const CLIPBOARD_TYPE_ICONS: Record<ClipboardIconKind, LucideIcon> = {
  pinned: Pin,
  pin: Pin,
  links: Link,
  code: Code2,
  long: AlignLeft,
  frequent: FileText,
  image: Image,
  video: Video,
  audio: AudioLines,
  pdf: FileText,
  folder: Folder,
  file: File,
  text: FileText,
};

function ClipboardTypeIcon({ item }: { item: ClipboardEntry }) {
  const kind: ClipboardIconKind = item.pinned
    ? "pin"
    : item.file_path
      ? item.file_kind || clipboardFileKind(item.file_path)
      : classify(item);
  const Icon = CLIPBOARD_TYPE_ICONS[kind] ?? FileText;
  return (
    <Icon
      className={`qx-clipboard-type-icon is-${kind}`}
      size={15}
      strokeWidth={2.1}
      aria-hidden="true"
    />
  );
}

interface ClipboardHistoryVirtualListProps {
  listElement: HTMLDivElement | null;
  sections: ClipboardHistorySection[];
  selected: number;
  getItemProps: (itemIndex: number) => QxListItemProps;
  onSelect: (item: ClipboardEntry, index: number) => void;
  onBeginTextEdit: (item: ClipboardEntry) => void;
  thumbnailUrls: Record<string, string>;
  onVisibleImagePathsChange: (paths: string[]) => void;
  dateFilter: CalendarRange;
  setDateFilter: Dispatch<SetStateAction<CalendarRange>>;
  datePopoverSection: string | null;
  setDatePopoverSection: Dispatch<SetStateAction<string | null>>;
  setSelected: Dispatch<SetStateAction<number>>;
  dateBounds: { min: string | null; max: string | null };
  dateFilterLabel: string | null;
}

export default function ClipboardHistoryVirtualList({
  listElement,
  sections,
  selected,
  getItemProps,
  onSelect,
  onBeginTextEdit,
  thumbnailUrls,
  onVisibleImagePathsChange,
  dateFilter,
  setDateFilter,
  datePopoverSection,
  setDatePopoverSection,
  setSelected,
  dateBounds,
  dateFilterLabel,
}: ClipboardHistoryVirtualListProps) {
  const t = useT();
  const locale = useLocale();
  const rows = useMemo<VirtualClipboardRow[]>(() => {
    const next: VirtualClipboardRow[] = [];
    let itemIndex = 0;
    sections.forEach((section, sectionIndex) => {
      const key = `${section.key}:${sectionIndex}`;
      next.push({ type: "header", key: `header:${key}`, title: section.title, count: section.items.length });
      section.items.forEach((item) => {
        next.push({ type: "item", key: `item:${item.id}`, item, itemIndex });
        itemIndex += 1;
      });
    });
    return next;
  }, [sections]);
  const virtualRowForItemIndex = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((row, rowIndex) => {
      if (row.type === "item") map.set(row.itemIndex, rowIndex);
    });
    return map;
  }, [rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listElement,
    estimateSize: (index) => rows[index]?.type === "header" ? 31 : 42,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
    useFlushSync: false,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const visibleImagePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const virtualItem of virtualItems) {
      const row = rows[virtualItem.index];
      if (row?.type === "item" && classify(row.item) === "image" && row.item.image_path) {
        paths.add(row.item.image_path);
      }
    }
    return [...paths];
  }, [rows, virtualItems]);

  useEffect(() => {
    onVisibleImagePathsChange(visibleImagePaths);
  }, [onVisibleImagePathsChange, visibleImagePaths]);

  useEffect(() => {
    const rowIndex = virtualRowForItemIndex.get(selected);
    if (rowIndex !== undefined) virtualizer.scrollToIndex(rowIndex, { align: "auto" });
  }, [selected, virtualRowForItemIndex, virtualizer]);

  const recentRange = (days: number): CalendarRange => {
    const max = dateBounds.max ?? dateKey(new Date().toISOString());
    const end = new Date(`${max}T12:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const first = dateKey(start.toISOString());
    return {
      from: dateBounds.min && first < dateBounds.min ? dateBounds.min : first,
      to: max,
    };
  };

  return (
    <div
      className="qx-clipboard-virtual-list"
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualItems.map((virtualItem) => {
        const row = rows[virtualItem.index];
        if (!row) return null;
        const rowStyle = {
          position: "absolute" as const,
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${virtualItem.start}px)`,
        };
        if (row.type === "header") {
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={rowStyle}
            >
              <Popover
                modal
                open={datePopoverSection === row.key}
                onOpenChange={(open) => setDatePopoverSection(open ? row.key : null)}
              >
                <PopoverTrigger asChild>
                  <button className="qx-section-header qx-clipboard-date-trigger" type="button">
                    <CalendarDays size={13} aria-hidden="true" />
                    <span className="qx-clipboard-date-title">{dateFilterLabel ?? row.title}</span>
                    <span>{row.count}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="qx-clipboard-date-popover" side="right" align="start">
                  <Calendar
                    value={dateFilter}
                    onChange={(range) => {
                      setDateFilter(range);
                      setSelected(0);
                    }}
                    locale={locale}
                    min={dateBounds.min}
                    max={dateBounds.max}
                    rangeLabel={t("clipboard.dateFilter", "Filter by date range")}
                    previousMonthLabel={t("clipboard.calendar.previousMonth", "Previous month")}
                    nextMonthLabel={t("clipboard.calendar.nextMonth", "Next month")}
                  />
                  <div className="qx-clipboard-date-presets">
                    <button
                      className={!dateFilter.from ? "is-active" : ""}
                      type="button"
                      onClick={() => {
                        setDateFilter({ from: null, to: null });
                        setSelected(0);
                        setDatePopoverSection(null);
                      }}
                    >
                      {t("clipboard.allDates", "All dates")}
                    </button>
                    {[1, 7, 30].map((days) => (
                      <button key={days} type="button" onClick={() => {
                        setDateFilter(recentRange(days));
                        setSelected(0);
                        setDatePopoverSection(null);
                      }}>
                        {days === 1
                          ? t("clipboard.calendar.today", "Today")
                          : t("clipboard.calendar.lastDays", "Last {n} days").replace("{n}", String(days))}
                      </button>
                    ))}
                  </div>
                  <div className="qx-clipboard-date-summary" aria-live="polite">
                    {dateFilterLabel ?? t("clipboard.allDates", "All dates")}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          );
        }
        const item = row.item;
        const isImage = classify(item) === "image";
        return (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={rowStyle}
          >
            <button
              {...getItemProps(row.itemIndex)}
              onClick={() => onSelect(item, row.itemIndex)}
              onDoubleClick={() => onBeginTextEdit(item)}
            >
              <span className="qx-clipboard-row-icon" aria-hidden="true">
                <ClipboardTypeIcon item={item} />
              </span>
              <span className="qx-clipboard-row-copy">
                <span className="qx-clipboard-row-title">
                  {item.pinned && <span className="qx-clipboard-pin-dot" />}
                  {isImage ? (
                    thumbnailUrls[item.image_path!] ? (
                      <img
                        className="qx-clipboard-thumb"
                        src={thumbnailUrls[item.image_path!]}
                        alt={t("clipboard.imageAlt", "Clipboard image")}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="qx-clipboard-thumb-loading">
                        {t("clipboard.type.image", "Image")}
                      </span>
                    )
                  ) : item.file_path ? (
                    clipboardFileLabel(item, t)
                  ) : (
                    preview(item.text) || t("clipboard.emptyText", "Empty Text")
                  )}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

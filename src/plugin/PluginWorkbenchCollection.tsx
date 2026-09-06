import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { QxListLoading, shouldShowQxListLoading } from "../components/QxListLoading";
import { useQxListSelection } from "../hooks/useQxListSelection";
import { qxRegionProps } from "../hooks/useQxMasterDetail";
import {
  WorkbenchCachedImage,
  WorkbenchListMedia,
  WorkbenchStatus,
  workbenchToneClass,
} from "./PluginWorkbenchPrimitives";
import type { PluginWorkbenchItem, PluginWorkbenchState } from "./workbenchTypes";
import PluginWorkbenchCards from "./PluginWorkbenchCards";

interface WorkbenchCollectionProps {
  pluginId: string;
  state: PluginWorkbenchState;
  selectedIndex: number;
  listTitle: string;
  loadingText: string;
  emptyText: string;
  regionId: string;
  onActivate: (id: string) => void;
  onSelect?: (id: string) => void;
  onEdit?: (item: PluginWorkbenchItem) => void;
  onOpenLink?: (url: string) => void;
  editingItemId?: string;
  renderEditor?: (item: PluginWorkbenchItem) => ReactNode;
}

interface SharedCollectionProps extends WorkbenchCollectionProps {
  items: PluginWorkbenchItem[];
}

function collectionSignature(state: PluginWorkbenchState, items: PluginWorkbenchItem[]): string {
  return [
    state.revision ?? "",
    state.query || "",
    items.length,
    items[0]?.id || "",
    items[items.length - 1]?.id || "",
  ].join(":");
}

function workbenchListRowSize(item: PluginWorkbenchItem | undefined): number {
  if (item?.images?.length) return 132;
  if (item?.progress != null) return 56;
  return 52;
}

function VirtualWorkbenchList({
  pluginId,
  state,
  items,
  selectedIndex,
  listTitle,
  loadingText,
  emptyText,
  regionId,
  onActivate,
}: SharedCollectionProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const bindListRef = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    setScrollElement(element);
  }, []);
  const signature = collectionSignature(state, items);
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: signature,
    enabled: selectedIndex >= 0,
  });
  const virtualizer = useVirtualizer({
    count: items.length ? items.length + 1 : 0,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => index === 0 ? "__qx-workbench-header" : items[index - 1]?.id || index,
    estimateSize: (index) => {
      if (index === 0) return 26;
      return workbenchListRowSize(items[index - 1]);
    },
    overscan: 8,
  });
  const rowOffsets = useMemo(() => {
    let cursor = 26;
    return items.map((item) => {
      const start = cursor;
      cursor += workbenchListRowSize(item);
      return start;
    });
  }, [items]);

  useEffect(() => {
    if (selectedIndex < 0 || !scrollElement) return;
    const frame = window.requestAnimationFrame(() => {
      const start = rowOffsets[selectedIndex] ?? 26;
      const end = start + workbenchListRowSize(items[selectedIndex]);
      const viewportStart = scrollElement.scrollTop;
      const viewportEnd = viewportStart + scrollElement.clientHeight;
      if (start < viewportStart) scrollElement.scrollTop = start;
      else if (end > viewportEnd) scrollElement.scrollTop = Math.max(0, end - scrollElement.clientHeight);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items, rowOffsets, scrollElement, selectedIndex, signature]);

  return (
    <div
      ref={bindListRef}
      className="qx-content-list qx-plugin-list qx-host-workbench-list is-virtualized"
      role="listbox"
      {...qxRegionProps(regionId, { initial: true, label: listTitle })}
    >
      {items.length ? (
        <div
          className="qx-host-workbench-virtual-canvas"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            if (virtualRow.index === 0) {
              return (
                <div
                  key={virtualRow.key}
                  className="qx-section-header qx-host-workbench-list-header qx-host-workbench-virtual-row"
                  style={{
                    height: 26,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <span>{listTitle}</span>
                  <span>{state.loading ? "…" : items.length}</span>
                </div>
              );
            }
            const index = virtualRow.index - 1;
            const item = items[index];
            if (!item) return null;
            return (
              <button
                key={virtualRow.key}
                type="button"
                {...getItemProps(index, {
                  className: [
                    "tall qx-host-workbench-row qx-host-workbench-virtual-row",
                    item.images?.length ? "has-card-media" : "",
                    item.progress != null ? "has-progress" : "",
                  ].filter(Boolean).join(" "),
                })}
                style={{
                  height: workbenchListRowSize(item),
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => onActivate(item.id)}
              >
                <span className={`qx-host-workbench-icon${item.image?.url ? " has-image" : ""}`} aria-hidden="true">
                  {item.image?.url ? (
                    <WorkbenchCachedImage
                      pluginId={pluginId}
                      url={item.image.url}
                      alt=""
                      loading="lazy"
                      style={{ objectFit: item.image.fit || "cover" }}
                    />
                  ) : item.icon || "•"}
                </span>
                <span className="qx-list-copy">
                  <strong className="qx-list-title">{item.title}</strong>
                  {item.subtitle ? <small>{item.subtitle}</small> : null}
                  {item.images?.length ? <WorkbenchListMedia pluginId={pluginId} images={item.images} /> : null}
                  {item.progress != null ? (
                    <span className="qx-host-workbench-progress" aria-label={`${Math.round(item.progress)}%`}>
                      <i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                    </span>
                  ) : null}
                </span>
                {(item.badge || item.meta || item.status) ? (
                  <span className="qx-host-workbench-accessory">
                    {(item.badge || item.meta) ? (
                      <span className={`qx-host-workbench-badge${workbenchToneClass(item.tone)}`}>
                        {item.badge || item.meta}
                      </span>
                    ) : null}
                    <WorkbenchStatus status={item.status} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : shouldShowQxListLoading(Boolean(state.loading), items.length) ? (
        <QxListLoading ariaLabel={loadingText} label={loadingText} rows={6} variant="tall" />
      ) : (
        <div className="qx-content-detail-empty qx-host-workbench-empty">{emptyText}</div>
      )}
    </div>
  );
}

function galleryColumns(width: number, requested: number): number {
  if (!width) return requested;
  const available = Math.max(0, width - 24);
  return Math.max(1, Math.min(requested, Math.floor((available + 10) / 142) || 1));
}

function VirtualWorkbenchGallery({
  pluginId,
  state,
  items,
  selectedIndex,
  listTitle,
  emptyText,
  regionId,
  onActivate,
}: SharedCollectionProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const bindListRef = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    setScrollElement(element);
  }, []);
  useEffect(() => {
    if (!scrollElement) return;
    const update = () => setWidth(scrollElement.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);
  const requestedColumns = Math.max(2, Math.min(8, state.layout?.columns || 4));
  const columns = galleryColumns(width, requestedColumns);
  const gap = 10;
  const horizontalPadding = 24;
  const cardWidth = Math.max(120, (Math.max(width, 320) - horizontalPadding - gap * (columns - 1)) / columns);
  const aspectRatio = state.layout?.aspectRatio || "landscape";
  const cardHeight = cardWidth * (aspectRatio === "portrait" ? 4 / 3 : aspectRatio === "square" ? 1 : 9 / 16) + 52;
  const signature = collectionSignature(state, items);
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: signature,
    enabled: selectedIndex >= 0,
  });
  const virtualizer = useVirtualizer({
    count: Math.ceil(items.length / columns),
    getScrollElement: () => scrollElement,
    getItemKey: (row) => items[row * columns]?.id || row,
    estimateSize: () => cardHeight,
    gap,
    overscan: 2,
  });

  useEffect(() => {
    if (selectedIndex < 0 || !scrollElement) return;
    const frame = window.requestAnimationFrame(() => {
      const start = 12 + Math.floor(selectedIndex / columns) * (cardHeight + gap);
      const end = start + cardHeight;
      const viewportStart = scrollElement.scrollTop;
      const viewportEnd = viewportStart + scrollElement.clientHeight;
      if (start < viewportStart) scrollElement.scrollTop = start;
      else if (end > viewportEnd) scrollElement.scrollTop = Math.max(0, end - scrollElement.clientHeight);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cardHeight, columns, scrollElement, selectedIndex, signature]);

  const densityClass = items.length === 0
    ? " is-empty"
    : items.length <= requestedColumns
      ? " is-sparse"
      : "";
  const canvasStyle: CSSProperties = {
    height: virtualizer.getTotalSize() + 24,
  };

  return (
    <div
      ref={bindListRef}
      className={`qx-content-list qx-host-workbench-gallery is-virtualized aspect-${aspectRatio}${densityClass}`}
      role="listbox"
      {...qxRegionProps(regionId, { initial: true, label: listTitle })}
    >
      {items.length ? (
        <div className="qx-host-workbench-gallery-virtual-canvas" style={canvasStyle}>
          {virtualizer.getVirtualItems().flatMap((virtualRow) => (
            Array.from({ length: columns }, (_, lane) => {
              const index = virtualRow.index * columns + lane;
              const item = items[index];
              if (!item) return null;
              return (
                <button
                  key={item.id}
                  type="button"
                  {...getItemProps(index, {
                    className: "qx-host-workbench-gallery-card qx-host-workbench-gallery-virtual-card",
                    baseClass: false,
                  })}
                  style={{
                    width: cardWidth,
                    height: cardHeight,
                    transform: `translate3d(${12 + lane * (cardWidth + gap)}px, ${12 + virtualRow.start}px, 0)`,
                  }}
                  onClick={() => onActivate(item.id)}
                >
                  <span className="qx-host-workbench-gallery-image">
                    {item.image?.url ? (
                      <WorkbenchCachedImage
                        pluginId={pluginId}
                        url={item.image.url}
                        alt={item.image.alt || ""}
                        loading="lazy"
                        style={{ objectFit: item.image.fit || "cover" }}
                      />
                    ) : (
                      <span aria-hidden="true">{item.icon || "•"}</span>
                    )}
                  </span>
                  <span className="qx-host-workbench-gallery-copy">
                    <strong>{item.title}</strong>
                    {item.subtitle ? <small>{item.subtitle}</small> : null}
                  </span>
                  {(item.badge || item.meta) ? (
                    <span className={`qx-host-workbench-gallery-badge${workbenchToneClass(item.tone)}`}>
                      {item.badge || item.meta}
                    </span>
                  ) : null}
                  <WorkbenchStatus status={item.status} />
                </button>
              );
            })
          ))}
        </div>
      ) : (
        <div className="qx-content-detail-empty qx-host-workbench-empty">{emptyText}</div>
      )}
    </div>
  );
}

export default function PluginWorkbenchCollection(props: WorkbenchCollectionProps) {
  const items = props.state.items || [];
  const shared = { ...props, items };
  if (props.state.layout?.kind === "cards") {
    return (
      <PluginWorkbenchCards
        pluginId={props.pluginId}
        state={props.state}
        selectedIndex={props.selectedIndex}
        listTitle={props.listTitle}
        loadingText={props.loadingText}
        emptyText={props.emptyText}
        regionId={props.regionId}
        onSelect={props.onSelect || props.onActivate}
        onEdit={props.onEdit}
        onOpenLink={props.onOpenLink}
        editingItemId={props.editingItemId}
        renderEditor={props.renderEditor}
      />
    );
  }
  return props.state.layout?.kind === "gallery"
    ? <VirtualWorkbenchGallery {...shared} />
    : <VirtualWorkbenchList {...shared} />;
}

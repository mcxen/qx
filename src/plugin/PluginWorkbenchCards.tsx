import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import { Pin } from "lucide-react";
import { Button } from "../components/ui";
import { QxListLoading, shouldShowQxListLoading } from "../components/QxListLoading";
import QxMediaViewer from "../components/QxMediaViewer";
import { getQxListItemProps } from "../hooks/useQxListSelection";
import { qxRegionProps } from "../hooks/useQxMasterDetail";
import { useT } from "../i18n";
import { WorkbenchCachedImage, WorkbenchStatus, resolveWorkbenchImageUrl } from "./PluginWorkbenchPrimitives";
import {
  layoutWorkbenchMasonry,
  resolveWorkbenchMasonryColumns,
  restoreWorkbenchMasonryScrollTop,
  visibleWorkbenchMasonryIndexes,
  workbenchMasonryScrollAnchor,
  type WorkbenchMasonryLayout,
  type WorkbenchMasonryScrollAnchor,
} from "./workbenchMasonry";
import type { PluginWorkbenchImage, PluginWorkbenchItem, PluginWorkbenchState } from "./workbenchTypes";
import "../styles/workbench-cards.css";

interface PluginWorkbenchCardsProps {
  pluginId: string;
  state: PluginWorkbenchState;
  selectedIndex: number;
  listTitle: string;
  loadingText: string;
  emptyText: string;
  regionId: string;
  onSelect: (id: string) => void;
  onEdit?: (item: PluginWorkbenchItem) => void;
  onOpenLink?: (url: string) => void;
  editingItemId?: string;
  renderEditor?: (item: PluginWorkbenchItem) => ReactNode;
}

const CARDS_PADDING = 12;
const COMFORTABLE_GAP = 12;
const COMPACT_GAP = 8;
const MIN_COLUMN_WIDTH = 280;

function measuredCardHeight(entry: ResizeObserverEntry): number {
  const borderBoxSize = entry.borderBoxSize;
  const blockSize = borderBoxSize?.[0]?.blockSize;
  if (Number.isFinite(blockSize) && (blockSize as number) > 0) return Math.ceil(blockSize as number);
  // Older WebViews may not expose borderBoxSize; a DOM rect includes the
  // card's padding and border and is therefore safer than contentRect.
  const rectHeight = entry.target.getBoundingClientRect().height;
  return Math.max(1, Math.ceil(rectHeight || entry.contentRect.height));
}

/** Content cards keep source order while masonry geometry and virtualization stay in Qx. */
export default function PluginWorkbenchCards({
  pluginId, state, selectedIndex, listTitle, loadingText, emptyText, regionId,
  onSelect, onEdit, onOpenLink, editingItemId, renderEditor,
}: PluginWorkbenchCardsProps) {
  const t = useT();
  const items = state.items || [];
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Map<string, number>>(
    () => new Map<string, number>(),
  );
  const [preview, setPreview] = useState<{ images: PluginWorkbenchImage[]; index: number } | null>(null);
  const cardNodesRef = useRef(new Map<string, HTMLElement>());
  const cardObserverRef = useRef<ResizeObserver | null>(null);
  const cardRefCallbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const scrollFrameRef = useRef<number | null>(null);
  const previousLayoutRef = useRef<WorkbenchMasonryLayout | null>(null);
  const pendingAnchorRef = useRef<WorkbenchMasonryScrollAnchor | undefined>(undefined);
  const previousSelectedIdRef = useRef<string | undefined>(undefined);
  const pendingSelectionScrollRef = useRef<{ id: string; index: number } | undefined>(undefined);

  const compact = state.layout?.density === "compact";
  const gap = compact ? COMPACT_GAP : COMFORTABLE_GAP;
  const requestedColumns = Math.max(1, Math.min(3, state.layout?.columns || 3));
  const itemIdentity = useMemo(() => items.map((item) => item.id).join("\u0000"), [items]);
  const contentWidth = Math.max(0, viewport.width - CARDS_PADDING * 2);
  const columns = resolveWorkbenchMasonryColumns(
    contentWidth,
    requestedColumns,
    gap,
    MIN_COLUMN_WIDTH,
  );
  const columnWidth = columns > 0
    ? Math.max(0, (contentWidth - gap * (columns - 1)) / columns)
    : 0;
  const measurementGeometryKey = `${columns}:${Math.round(columnWidth * 1000) / 1000}:${compact ? "compact" : "comfortable"}`;
  // The cache itself is namespaced by geometry so a late callback from the
  // previous width cannot overwrite the new measurement.
  const geometryMeasuredHeights = measuredHeights;
  const measuredHeightKey = useCallback(
    (id: string) => `${measurementGeometryKey}\u0000${id}`,
    [measurementGeometryKey],
  );
  const layout = useMemo(() => layoutWorkbenchMasonry(
    items.map((item) => ({ id: item.id, height: geometryMeasuredHeights.get(measuredHeightKey(item.id)) })),
    {
      width: contentWidth,
      columns,
      gap,
      estimatedHeight: compact ? 180 : 220,
    },
  ), [columns, compact, contentWidth, gap, geometryMeasuredHeights, itemIdentity, measuredHeightKey]);

  const bindScrollElement = useCallback((element: HTMLDivElement | null) => {
    setScrollElement(element);
  }, []);

  useEffect(() => {
    if (!scrollElement) return;
    const measureViewport = () => {
      setViewport({
        width: scrollElement.clientWidth,
        height: scrollElement.clientHeight,
      });
    };
    measureViewport();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureViewport);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    const activePrefix = `${measurementGeometryKey}\u0000`;
    for (const id of cardRefCallbacksRef.current.keys()) {
      if (!ids.has(id)) cardRefCallbacksRef.current.delete(id);
    }
    setMeasuredHeights((previous) => {
      let changed = false;
      const next = new Map<string, number>();
      for (const [key, height] of previous) {
        const id = key.startsWith(activePrefix) ? key.slice(activePrefix.length) : "";
        if (id && ids.has(id)) next.set(key, height);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [itemIdentity, measurementGeometryKey]);

  const setCardRef = useCallback((id: string, node: HTMLElement | null) => {
    const previous = cardNodesRef.current.get(id);
    if (previous && previous !== node) cardObserverRef.current?.unobserve(previous);
    if (node) {
      cardNodesRef.current.set(id, node);
      cardObserverRef.current?.observe(node);
    } else {
      cardNodesRef.current.delete(id);
    }
  }, []);

  const getCardRef = useCallback((id: string) => {
    const existing = cardRefCallbacksRef.current.get(id);
    if (existing) return existing;
    const callback = (node: HTMLElement | null) => setCardRef(id, node);
    cardRefCallbacksRef.current.set(id, callback);
    return callback;
  }, [setCardRef]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (scrollFrameRef.current != null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollTop(target.scrollTop);
    });
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current != null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useEffect(() => {
    if (!scrollElement || typeof ResizeObserver === "undefined") return;
    const activePrefix = `${measurementGeometryKey}\u0000`;
    const observer = new ResizeObserver((entries) => {
      setMeasuredHeights((previous) => {
        let changed = false;
        const next = new Map(previous);
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-qx-masonry-item-id");
          if (!id) continue;
          const height = measuredCardHeight(entry);
          const key = `${activePrefix}${id}`;
          if (next.get(key) !== height) {
            next.set(key, height);
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    });
    cardObserverRef.current = observer;
    for (const node of cardNodesRef.current.values()) observer.observe(node);
    return () => {
      observer.disconnect();
      if (cardObserverRef.current === observer) cardObserverRef.current = null;
    };
  }, [measurementGeometryKey, scrollElement]);

  // Reflows caused by width, insertion/removal, image decode, and editor
  // growth retain the item at the viewport top instead of jumping to zero.
  useLayoutEffect(() => {
    if (!scrollElement) return;
    const previous = previousLayoutRef.current;
    if (previous && previous !== layout) {
      pendingAnchorRef.current = workbenchMasonryScrollAnchor(previous, scrollElement.scrollTop);
    }
    previousLayoutRef.current = layout;
  }, [layout, scrollElement]);

  useLayoutEffect(() => {
    if (!scrollElement || !pendingAnchorRef.current) return;
    const restored = restoreWorkbenchMasonryScrollTop(layout, pendingAnchorRef.current);
    pendingAnchorRef.current = undefined;
    if (restored == null || Math.abs(scrollElement.scrollTop - restored) < 1) return;
    scrollElement.scrollTop = restored;
    setScrollTop(scrollElement.scrollTop);
  }, [layout, scrollElement]);

  const selectedId = selectedIndex >= 0 ? items[selectedIndex]?.id : undefined;
  const selectedMeasured = selectedId ? geometryMeasuredHeights.has(measuredHeightKey(selectedId)) : false;
  useEffect(() => {
    if (!selectedId) {
      previousSelectedIdRef.current = undefined;
      pendingSelectionScrollRef.current = undefined;
      return;
    }
    if (previousSelectedIdRef.current !== selectedId) {
      previousSelectedIdRef.current = selectedId;
      pendingSelectionScrollRef.current = { id: selectedId, index: selectedIndex };
    }
    const pending = pendingSelectionScrollRef.current;
    if (!scrollElement || !pending || pending.id !== selectedId) return;
    const targetIndex = items.findIndex((item) => item.id === pending.id);
    const position = layout.positions[targetIndex >= 0 ? targetIndex : pending.index];
    if (!position) return;
    const viewportEnd = scrollElement.scrollTop + scrollElement.clientHeight;
    const nextScrollTop = position.y < scrollElement.scrollTop
      ? position.y
      : position.y + position.height > viewportEnd
        ? Math.max(0, position.y + position.height - scrollElement.clientHeight)
        : scrollElement.scrollTop;
    if (Math.abs(nextScrollTop - scrollElement.scrollTop) < 1) return;
    scrollElement.scrollTop = nextScrollTop;
    setScrollTop(scrollElement.scrollTop);
    if (selectedMeasured) pendingSelectionScrollRef.current = undefined;
  }, [itemIdentity, layout, scrollElement, selectedId, selectedIndex, selectedMeasured]);

  useEffect(() => {
    const pending = pendingSelectionScrollRef.current;
    if (!pending || pending.id !== selectedId || !selectedMeasured || !scrollElement) return;
    const targetIndex = items.findIndex((item) => item.id === pending.id);
    const position = layout.positions[targetIndex >= 0 ? targetIndex : pending.index];
    if (!position) return;
    const viewportEnd = scrollElement.scrollTop + scrollElement.clientHeight;
    if (position.y >= scrollElement.scrollTop && position.y + position.height <= viewportEnd) {
      pendingSelectionScrollRef.current = undefined;
    }
  }, [itemIdentity, layout, scrollElement, selectedId, selectedMeasured]);

  const editingIndex = editingItemId ? items.findIndex((item) => item.id === editingItemId) : -1;
  const visibleIndexes = useMemo(() => {
    const indexes = new Set(visibleWorkbenchMasonryIndexes(
      layout,
      scrollTop,
      viewport.height || 480,
      Math.max(480, (viewport.height || 480) * 1.25),
    ));
    for (const index of [selectedIndex, editingIndex]) {
      if (index >= 0 && index < items.length) indexes.add(index);
    }
    return [...indexes].sort((a, b) => a - b);
  }, [editingIndex, items.length, layout, scrollTop, selectedIndex, viewport.height]);

  const markdownComponents = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      if (!href || !/^https?:\/\//i.test(href) || !onOpenLink) return <span data-qx-card-link>{children}</span>;
      return <Button type="button" variant="ghost" role="link" className="qx-workbench-note-link" onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenLink(href);
      }}>{children}</Button>;
    },
  }), [onOpenLink]);

  const openPreview = (images: PluginWorkbenchImage[], index: number) => {
    const next = { images, index };
    setPreview(next);
    void Promise.all(images.map(async (image) => ({
      ...image, url: await resolveWorkbenchImageUrl(pluginId, image.url),
    }))).then((resolved) => setPreview((current) => current === next ? { images: resolved, index } : current));
  };

  return (
    <>
      <div
        ref={bindScrollElement}
        className={`qx-content-list qx-host-workbench-cards${compact ? " is-compact" : ""}`}
        role="listbox"
        data-qx-grid-columns={columns}
        data-qx-grid-layout="masonry"
        {...qxRegionProps(regionId, { initial: true, label: listTitle })}
        onScroll={onScroll}
      >
        {items.length ? (
          <div className="qx-workbench-cards-canvas" style={{ height: layout.contentHeight }}>
            {visibleIndexes.map((index) => {
              const item = items[index];
              const position = layout.positions[index];
              const neighbors = layout.neighbors[index];
              if (!item || !position) return null;
              const editor = renderEditor?.(item);
              const canEdit = Boolean(item.editor && !item.editor.disabled && !item.editor.readOnly && onEdit);
              const images = state.layout?.showImages === false ? [] : item.images?.length ? item.images : item.image ? [item.image] : [];
              const cardStyle: CSSProperties = {
                width: position.width,
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
              };
              return (
                <article
                  key={item.id}
                  ref={getCardRef(item.id)}
                  data-qx-masonry-item-id={item.id}
                  data-qx-masonry-index={index}
                  data-qx-masonry-column={position.column}
                  data-qx-masonry-up={neighbors?.up ?? -1}
                  data-qx-masonry-down={neighbors?.down ?? -1}
                  data-qx-masonry-left={neighbors?.left ?? -1}
                  data-qx-masonry-right={neighbors?.right ?? -1}
                  style={cardStyle}
                  {...getQxListItemProps(index, selectedIndex, { baseClass: false, className: "qx-workbench-note-card" })}
                  onClick={(event) => {
                    if (!(event.target instanceof Element) || event.target.closest("button,a,input,textarea,select")) return;
                    onSelect(item.id);
                  }}
                >
                  {editor || (
                    <>
                      <div className="qx-workbench-note-content" onDoubleClick={(event) => {
                        if (!canEdit || !(event.target instanceof Element) || event.target.closest("a,button,img,input,textarea,select,[data-qx-card-link]")) return;
                        event.preventDefault();
                        onEdit?.(item);
                      }}>
                        {item.title.trim() ? <h3>{item.title}</h3> : null}
                        {(() => {
                          // A declared card body is authoritative. Do not
                          // leak the bounded list subtitle into an empty card.
                          const body = item.card ? item.card.body || "" : item.subtitle || "";
                          return body ? (
                            <div className="qx-workbench-note-body">
                              <ReactMarkdown
                                skipHtml
                                allowedElements={["p", "strong", "em", "del", "code", "pre", "ul", "ol", "li", "blockquote", "a", "br", "hr"]}
                                unwrapDisallowed
                                components={markdownComponents}
                              >{body}</ReactMarkdown>
                            </div>
                          ) : null;
                        })()}
                      </div>
                      {images.length ? (
                        <div className="qx-workbench-note-images">
                          {images.map((image, imageIndex) => (
                            <Button
                              key={`${item.id}:${image.downloadId || imageIndex}`} type="button" variant="ghost"
                              className="qx-workbench-note-image"
                              aria-label={image.alt || t("plugins.workbench.previewImage", "Preview image")}
                              onClick={(event) => { event.stopPropagation(); openPreview(images, imageIndex); }}
                            >
                              <WorkbenchCachedImage pluginId={pluginId} url={image.url} alt={image.alt || ""} loading="lazy" style={{ objectFit: image.fit || "cover" }} />
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      {item.card?.tags?.length ? (
                        <div className="qx-workbench-note-tags">
                          {item.card.tags.map((tag, tagIndex) => <span key={`${tag}:${tagIndex}`} title={tag}>#{tag}</span>)}
                        </div>
                      ) : null}
                      {item.card?.timestamp || item.card?.pinned || item.meta || item.badge ? (
                        <footer className="qx-workbench-note-meta">
                          <span>{item.card?.timestamp || item.meta}</span>
                          {item.badge ? <span>{item.badge}</span> : null}
                          {item.card?.pinned ? <Pin size={12} aria-label={t("plugins.workbench.pinned", "Pinned")} /> : null}
                        </footer>
                      ) : null}
                      <WorkbenchStatus status={item.status} />
                    </>
                  )}
                </article>
              );
            })}
          </div>
        ) : shouldShowQxListLoading(Boolean(state.loading), 0) ? (
          <QxListLoading ariaLabel={loadingText} label={loadingText} rows={4} variant="tall" />
        ) : <div className="qx-content-detail-empty qx-host-workbench-empty">{emptyText}</div>}
      </div>
      <QxMediaViewer open={Boolean(preview)} images={preview?.images || []} initialIndex={preview?.index || 0} onOpenChange={(open) => { if (!open) setPreview(null); }} />
    </>
  );
}

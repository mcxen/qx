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
import remarkGfm from "remark-gfm";
import { Button } from "../components/ui";
import { QxListLoading, shouldShowQxListLoading } from "../components/QxListLoading";
import QxMediaViewer from "../components/QxMediaViewer";
import { getQxListItemProps } from "../hooks/useQxListSelection";
import { qxRegionProps } from "../hooks/useQxMasterDetail";
import { useT } from "../i18n";
import { WorkbenchCachedImage, WorkbenchStatus, resolveWorkbenchImageUrl } from "./PluginWorkbenchPrimitives";
import remarkWorkbenchUnderline from "./workbenchNoteMarkdown";
import {
  layoutWorkbenchMasonry,
  resolveWorkbenchMasonryColumns,
  restoreWorkbenchMasonryEditAnchor,
  restoreWorkbenchMasonryScrollTop,
  visibleWorkbenchMasonryIndexes,
  workbenchMasonryEditAnchor,
  workbenchMasonryScrollAnchor,
  type WorkbenchMasonryLayout,
  type WorkbenchMasonryEditAnchor,
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
  const previousEditingIdRef = useRef<string | undefined>(undefined);
  const editingAnchorRef = useRef<WorkbenchMasonryEditAnchor | undefined>(undefined);
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
  const layoutRef = useRef<WorkbenchMasonryLayout>(layout);
  layoutRef.current = layout;

  const bindScrollElement = useCallback((element: HTMLDivElement | null) => {
    setScrollElement(element);
  }, []);

  const setActualScrollTop = useCallback((next: number) => {
    if (!scrollElement) return;
    const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    const desired = Number.isFinite(next)
      ? Math.min(maxScrollTop, Math.max(0, next))
      : scrollElement.scrollTop;
    if (Math.abs(scrollElement.scrollTop - desired) < 1) return;
    scrollElement.scrollTop = desired;
    const editAnchor = editingAnchorRef.current;
    if (editAnchor) {
      const position = layoutRef.current.positions.find((candidate) => candidate.id === editAnchor.id);
      if (position) {
        editingAnchorRef.current = {
          ...editAnchor,
          index: position.index,
          column: position.column,
          viewportTop: position.y - scrollElement.scrollTop,
        };
      }
    }
    // The browser may clamp against the current canvas height. Always publish
    // the actual value so React's virtualization window cannot drift from DOM.
    setScrollTop(scrollElement.scrollTop);
  }, [scrollElement]);

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
    const editAnchor = editingAnchorRef.current;
    if (editAnchor) {
      const position = layoutRef.current.positions.find((candidate) => candidate.id === editAnchor.id);
      if (position) {
        editingAnchorRef.current = {
          ...editAnchor,
          index: position.index,
          column: position.column,
          viewportTop: position.y - target.scrollTop,
        };
      }
    }
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

  // Editing replaces the card body before the first ResizeObserver callback.
  // Capture its current viewport top once, then keep that anchor current when
  // the user scrolls. This makes editor growth a local reflow instead of a
  // second selection/viewport scroll request.
  useLayoutEffect(() => {
    if (!scrollElement) return;
    const previousEditingId = previousEditingIdRef.current;
    if (editingItemId === previousEditingId) return;
    if (editingItemId) {
      const sourceLayout = previousLayoutRef.current || layout;
      editingAnchorRef.current = workbenchMasonryEditAnchor(
        sourceLayout,
        scrollElement.scrollTop,
        editingItemId,
      ) || workbenchMasonryEditAnchor(layout, scrollElement.scrollTop, editingItemId);
      pendingAnchorRef.current = undefined;
    } else {
      editingAnchorRef.current = undefined;
    }
    previousEditingIdRef.current = editingItemId;
  }, [editingItemId, layout, scrollElement]);

  // Reflows caused by width, insertion/removal, image decode, and editor
  // growth retain the item at the viewport top instead of jumping to zero.
  useLayoutEffect(() => {
    if (!scrollElement) return;
    const previous = previousLayoutRef.current;
    if (previous && previous !== layout) {
      const editingAnchor = editingAnchorRef.current;
      pendingAnchorRef.current = editingItemId && editingAnchor?.id === editingItemId
        ? undefined
        : workbenchMasonryScrollAnchor(previous, scrollElement.scrollTop);
    }
    previousLayoutRef.current = layout;
  }, [editingItemId, layout, scrollElement]);

  // While an editor is active, its top edge is the sole reflow anchor. The
  // target is clamped to the real scroll range, preventing a very tall draft
  // from repeatedly requesting an impossible bottom position.
  useLayoutEffect(() => {
    if (!scrollElement || !editingItemId) return;
    const anchor = editingAnchorRef.current;
    if (!anchor || anchor.id !== editingItemId) return;
    const restored = restoreWorkbenchMasonryEditAnchor(layout, anchor);
    if (restored == null) return;
    setActualScrollTop(restored);
  }, [editingItemId, layout, scrollElement, setActualScrollTop]);

  useLayoutEffect(() => {
    if (!scrollElement || !pendingAnchorRef.current) return;
    if (editingItemId && editingAnchorRef.current?.id === editingItemId) {
      pendingAnchorRef.current = undefined;
      return;
    }
    const restored = restoreWorkbenchMasonryScrollTop(layout, pendingAnchorRef.current);
    pendingAnchorRef.current = undefined;
    if (restored == null) return;
    setActualScrollTop(restored);
  }, [editingItemId, layout, scrollElement, setActualScrollTop]);

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
    // A double-click can select and enter editing in adjacent browser events.
    // The edit anchor captured in layout-effect already owns this card's
    // viewport; letting pending selection scroll it again causes a visible
    // top/bottom tug-of-war.
    if (editingItemId && editingAnchorRef.current?.id === selectedId) {
      pendingSelectionScrollRef.current = undefined;
      return;
    }
    const targetIndex = items.findIndex((item) => item.id === pending.id);
    const position = layout.positions[targetIndex >= 0 ? targetIndex : pending.index];
    if (!position) return;
    const viewportEnd = scrollElement.scrollTop + scrollElement.clientHeight;
    const nextScrollTop = position.y < scrollElement.scrollTop
      ? position.y
      : position.y + position.height > viewportEnd
        ? Math.max(0, position.y + position.height - scrollElement.clientHeight)
        : scrollElement.scrollTop;
    if (Math.abs(nextScrollTop - scrollElement.scrollTop) < 1) {
      if (selectedMeasured) pendingSelectionScrollRef.current = undefined;
      return;
    }
    setActualScrollTop(nextScrollTop);
    if (selectedMeasured) pendingSelectionScrollRef.current = undefined;
  }, [editingItemId, itemIdentity, layout, scrollElement, selectedId, selectedIndex, selectedMeasured, setActualScrollTop]);

  useEffect(() => {
    const pending = pendingSelectionScrollRef.current;
    if (!pending || pending.id !== selectedId || !selectedMeasured || !scrollElement) return;
    if (editingItemId && editingAnchorRef.current?.id === selectedId) {
      pendingSelectionScrollRef.current = undefined;
      return;
    }
    const targetIndex = items.findIndex((item) => item.id === pending.id);
    const position = layout.positions[targetIndex >= 0 ? targetIndex : pending.index];
    if (!position) return;
    const viewportEnd = scrollElement.scrollTop + scrollElement.clientHeight;
    if (position.y >= scrollElement.scrollTop && position.y + position.height <= viewportEnd) {
      pendingSelectionScrollRef.current = undefined;
    }
  }, [editingItemId, itemIdentity, layout, scrollElement, selectedId, selectedMeasured]);

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
    input: ({ checked }: { checked?: boolean }) => (
      <span
        className="qx-workbench-note-task-marker"
        aria-hidden="true"
      >
        {checked ? "☑" : "☐"}
      </span>
    ),
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
                    if (!(event.target instanceof Element) || event.target.closest("button,a,input,textarea,select,[contenteditable='true']")) return;
                    onSelect(item.id);
                  }}
                >
                  {editor || (
                    <>
                      <div className="qx-workbench-note-content" onDoubleClick={(event) => {
                        if (!canEdit || !(event.target instanceof Element) || event.target.closest("a,button,img,input,textarea,select,[contenteditable='true'],[data-qx-card-link]")) return;
                        event.preventDefault();
                        event.stopPropagation();
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
                                remarkPlugins={[remarkGfm, remarkWorkbenchUnderline]}
                                allowedElements={["h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "del", "code", "pre", "ul", "ol", "li", "blockquote", "a", "u", "br", "hr", "input"]}
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

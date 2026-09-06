import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import ReactMarkdown from "react-markdown";
import { Pin } from "lucide-react";
import { Button } from "../components/ui";
import { QxListLoading, shouldShowQxListLoading } from "../components/QxListLoading";
import QxMediaViewer from "../components/QxMediaViewer";
import { getQxListItemProps } from "../hooks/useQxListSelection";
import { qxRegionProps } from "../hooks/useQxMasterDetail";
import { useT } from "../i18n";
import { WorkbenchCachedImage, WorkbenchStatus, resolveWorkbenchImageUrl } from "./PluginWorkbenchPrimitives";
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

/** Content cards keep source order; geometry and virtualization stay in Qx. */
export default function PluginWorkbenchCards({
  pluginId, state, selectedIndex, listTitle, loadingText, emptyText, regionId,
  onSelect, onEdit, onOpenLink, editingItemId, renderEditor,
}: PluginWorkbenchCardsProps) {
  const t = useT();
  const items = state.items || [];
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<{ images: PluginWorkbenchImage[]; index: number } | null>(null);
  useEffect(() => {
    if (!scrollElement) return;
    const measure = () => setWidth(scrollElement.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);
  const compact = state.layout?.density === "compact";
  const gap = compact ? 8 : 12;
  const columns = Math.max(1, Math.min(
    3, state.layout?.columns || 3, Math.floor((Math.max(0, width - 24) + gap) / (280 + gap)) || 1,
  ));
  const selectedRow = Math.floor(selectedIndex / columns);
  const editingRow = Math.floor(items.findIndex((item) => item.id === editingItemId) / columns);
  const rowCount = Math.ceil(items.length / columns);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const visible = defaultRangeExtractor(range);
    // Keep the selected/editing row mounted during scroll, without mounting
    // the entire collection or tying drafts to virtual DOM residency.
    for (const pinnedRow of [selectedRow, editingRow]) {
      if (pinnedRow >= 0 && pinnedRow < rowCount && !visible.includes(pinnedRow)) visible.push(pinnedRow);
    }
    return visible.sort((a, b) => a - b);
  }, [editingRow, rowCount, selectedRow]);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => `${columns}:${items[index * columns]?.id || index}`,
    estimateSize: () => compact ? 200 : 260,
    gap,
    overscan: 2,
    rangeExtractor,
  });
  useEffect(() => {
    if (selectedRow < 0 || selectedRow >= rowCount || !scrollElement) return;
    virtualizer.scrollToIndex(selectedRow, { align: "auto" });
    // Content/image/draft repaint must not scroll the collection to the top.
  }, [selectedRow, rowCount, scrollElement, columns, virtualizer]);
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
        ref={setScrollElement}
        className={`qx-content-list qx-host-workbench-cards${compact ? " is-compact" : ""}`}
        role="listbox"
        data-qx-grid-columns={columns}
        {...qxRegionProps(regionId, { initial: true, label: listTitle })}
      >
        {items.length ? (
          <div className="qx-workbench-cards-canvas" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className="qx-workbench-cards-row"
                style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}
              >
                {items.slice(row.index * columns, (row.index + 1) * columns).map((item, lane) => {
                  const index = row.index * columns + lane;
                  const editor = renderEditor?.(item);
                  const canEdit = Boolean(item.editor && !item.editor.disabled && !item.editor.readOnly && onEdit);
                  const images = state.layout?.showImages === false ? [] : item.images?.length ? item.images : item.image ? [item.image] : [];
                  return (
                    <article
                      key={item.id}
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
                            {item.card?.body || item.subtitle ? (
                              <div className="qx-workbench-note-body">
                                <ReactMarkdown
                                  skipHtml
                                  allowedElements={["p", "strong", "em", "del", "code", "pre", "ul", "ol", "li", "blockquote", "a", "br", "hr"]}
                                  unwrapDisallowed
                                  components={markdownComponents}
                                >{item.card?.body || item.subtitle || ""}</ReactMarkdown>
                              </div>
                            ) : null}
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
            ))}
          </div>
        ) : shouldShowQxListLoading(Boolean(state.loading), 0) ? (
          <QxListLoading ariaLabel={loadingText} label={loadingText} rows={4} variant="tall" />
        ) : <div className="qx-content-detail-empty qx-host-workbench-empty">{emptyText}</div>}
      </div>
      <QxMediaViewer open={Boolean(preview)} images={preview?.images || []} initialIndex={preview?.index || 0} onOpenChange={(open) => { if (!open) setPreview(null); }} />
    </>
  );
}

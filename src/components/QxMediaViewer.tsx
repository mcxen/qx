import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui";
import { useT } from "../i18n";
import { shouldIgnoreBareShortcut } from "../utils/keyboard";

const MEDIA_DECODE_CACHE_TTL_MS = 15 * 60 * 1_000;
const MEDIA_DECODE_CACHE_MAX_ENTRIES = 24;
const mediaDecodeCache = new Map<string, {
  image: HTMLImageElement;
  lastAccessedAt: number;
}>();
let mediaDecodeCacheTimer: ReturnType<typeof setTimeout> | null = null;

function pruneMediaDecodeCache(now = Date.now()) {
  for (const [url, entry] of mediaDecodeCache) {
    if (now - entry.lastAccessedAt < MEDIA_DECODE_CACHE_TTL_MS) continue;
    entry.image.src = "";
    mediaDecodeCache.delete(url);
  }
  while (mediaDecodeCache.size > MEDIA_DECODE_CACHE_MAX_ENTRIES) {
    const oldest = [...mediaDecodeCache.entries()]
      .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];
    if (!oldest) break;
    oldest[1].image.src = "";
    mediaDecodeCache.delete(oldest[0]);
  }
}

function scheduleMediaDecodeCachePrune() {
  if (mediaDecodeCacheTimer) clearTimeout(mediaDecodeCacheTimer);
  mediaDecodeCacheTimer = setTimeout(() => {
    mediaDecodeCacheTimer = null;
    pruneMediaDecodeCache();
    if (mediaDecodeCache.size) scheduleMediaDecodeCachePrune();
  }, MEDIA_DECODE_CACHE_TTL_MS);
}

export interface QxMediaViewerImage {
  url: string;
  alt?: string;
  caption?: string;
  fit?: "cover" | "contain";
}

interface QxMediaViewerProps {
  open: boolean;
  images: QxMediaViewerImage[];
  initialIndex?: number;
  onOpenChange: (open: boolean) => void;
  onDownload?: (image: QxMediaViewerImage) => void | Promise<void>;
  resolveUrl?: (url: string) => Promise<string>;
}

/** Shared host media viewer for built-in readers and plugin Workbench details. */
export default function QxMediaViewer({
  open,
  images,
  initialIndex = 0,
  onOpenChange,
  onDownload,
  resolveUrl,
}: QxMediaViewerProps) {
  const t = useT();
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [metrics, setMetrics] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [source, setSource] = useState<{ url: string; src: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const visibleImageRef = useRef<HTMLImageElement | null>(null);
  const zoomRef = useRef(1);
  const anchorRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const image = images[index];
  const src = resolveUrl ? source?.url === image?.url ? source?.src : undefined : image?.url;
  const failed = Boolean(image && failedUrl === image.url);
  const imageSetKey = useMemo(
    () => images.map((item) => item.url).join("\u0000"),
    [images],
  );

  useEffect(() => {
    if (!open) return;
    setIndex(Math.max(0, Math.min(images.length - 1, initialIndex)));
    zoomRef.current = 1;
    setZoom(1);
    setMetrics(null);
    setFailedUrl(null);
    anchorRef.current = null;
    dragRef.current = null;
  }, [imageSetKey, images.length, initialIndex, open]);

  useEffect(() => {
    if (!open || !image || !resolveUrl) return;
    let active = true;
    void resolveUrl(image.url).then((resolved) => {
      if (active) setSource({ url: image.url, src: resolved });
    }).catch(() => { if (active) setFailedUrl(image.url); });
    return () => { active = false; };
  }, [image?.url, open, resolveUrl]);

  const recordImageMetrics = useCallback((element: HTMLImageElement) => {
    if (!image || element !== visibleImageRef.current || element.naturalWidth <= 0 || element.naturalHeight <= 0) return;
    setMetrics((previous) => previous?.url === image.url
      && previous.width === element.naturalWidth && previous.height === element.naturalHeight ? previous : {
      url: image.url,
      width: element.naturalWidth,
      height: element.naturalHeight,
    });
  }, [image?.url]);

  const setVisibleImageRef = useCallback((element: HTMLImageElement | null) => {
    visibleImageRef.current = element;
    // A decoded cache entry can finish before React attaches onLoad. Reading
    // through the ref at mount makes its natural dimensions available to the
    // zoom layout immediately instead of leaving it in the fit-only fallback.
    if (element?.complete) {
      recordImageMetrics(element);
    } else if (element) {
      void element.decode().then(() => recordImageMetrics(element)).catch(() => {
        // onLoad remains the fallback for formats WebKit cannot decode here.
      });
    }
  }, [recordImageMetrics]);

  const syncPreviewLayout = useCallback(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      const width = Math.max(0, scroll.clientWidth - 4);
      const height = Math.max(0, scroll.clientHeight - 4);
      setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    }
    if (visibleImageRef.current?.complete) {
      recordImageMetrics(visibleImageRef.current);
    }
  }, [recordImageMetrics]);

  const setZoomLevel = useCallback((nextZoom: number, anchor?: { x: number; y: number }) => {
    // WebKit can defer ResizeObserver delivery while a dialog is animating.
    // Read the live scrollport at the interaction boundary, so a click always
    // has both the decoded image and viewport dimensions for its canvas.
    syncPreviewLayout();
    const currentZoom = zoomRef.current;
    const next = Math.max(0.5, Math.min(4, Math.round(nextZoom * 100) / 100));
    if (next === currentZoom) return;

    const scroll = scrollRef.current;
    const rect = scroll?.getBoundingClientRect();
    const imageRect = visibleImageRef.current?.getBoundingClientRect();
    if (scroll && rect && imageRect?.width && imageRect.height) {
      const x = anchor?.x ?? rect.left + scroll.clientWidth / 2;
      const y = anchor?.y ?? rect.top + scroll.clientHeight / 2;
      anchorRef.current = {
        x: (x - imageRect.left) / imageRect.width,
        y: (y - imageRect.top) / imageRect.height,
        offsetX: x - rect.left,
        offsetY: y - rect.top,
      };
    }

    zoomRef.current = next;
    setZoom(next);
  }, [syncPreviewLayout]);

  const resetZoom = useCallback(() => {
    anchorRef.current = null;
    zoomRef.current = 1;
    setZoom(1);
    scrollRef.current?.scrollTo(0, 0);
  }, []);

  const move = useCallback((delta: number) => {
    if (images.length < 2) return;
    resetZoom();
    setMetrics(null);
    setFailedUrl(null);
    setIndex((current) => {
      return (current + delta + images.length) % images.length;
    });
  }, [images.length, resetZoom]);

  const changeZoom = useCallback((delta: number) => {
    setZoomLevel(zoomRef.current + delta);
  }, [setZoomLevel]);

  // A cached image may already be complete when the dialog opens, so its
  // `load` event will not fire again after the viewer resets per-image state.
  // Measure it explicitly; otherwise the zoom percentage changes while the
  // rendered size stays at the fit-to-viewport fallback.
  useEffect(() => {
    if (!open || !image) return;
    const element = visibleImageRef.current;
    if (element?.complete) recordImageMetrics(element);
  }, [image?.url, open, recordImageMetrics]);

  useEffect(() => {
    if (!open || images.length < 2) return;
    const now = Date.now();
    pruneMediaDecodeCache(now);
    const offsets = [0, -1, 1, -2, 2];
    const indexes = offsets.map(
      (offset) => (index + offset + images.length) % images.length,
    );
    let active = true;
    for (const candidateIndex of new Set(indexes)) {
      const originalUrl = images[candidateIndex]?.url;
      if (!originalUrl) continue;
      void (resolveUrl ? resolveUrl(originalUrl) : Promise.resolve(originalUrl)).then((url) => {
        if (!active) return;
        const cached = mediaDecodeCache.get(url);
        if (cached) {
          cached.lastAccessedAt = now;
          mediaDecodeCache.delete(url);
          mediaDecodeCache.set(url, cached);
          return;
        }
        const candidate = new Image();
        candidate.decoding = "async";
        candidate.fetchPriority = candidateIndex === index ? "high" : "low";
        candidate.src = url;
        mediaDecodeCache.set(url, { image: candidate, lastAccessedAt: now });
        void candidate.decode().catch(() => {
          // Visible media retains its normal error behavior; predecode is best effort.
        });
        pruneMediaDecodeCache();
        scheduleMediaDecodeCachePrune();
      }).catch(() => { /* A failed neighbor must not block the selected image. */ });
    }
    return () => { active = false; };
  }, [images, index, open, resolveUrl]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.scrollLeft = 0;
      scroll.scrollTop = 0;
    }
  }, [image?.url, open]);

  useEffect(() => {
    if (!open) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const updateViewport = () => syncPreviewLayout();
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [image?.url, open, stage, syncPreviewLayout]);

  useEffect(() => {
    if (!open) return;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroll.clientHeight : 1;
      if (event.metaKey || event.ctrlKey) {
        setZoomLevel(zoomRef.current * Math.exp(-event.deltaY * unit * 0.0025), { x: event.clientX, y: event.clientY });
      } else {
        scroll.scrollLeft += (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
        if (!event.shiftKey || event.deltaX) scroll.scrollTop += event.deltaY * unit;
      }
    };
    // React's delegated wheel listener is passive; use a local cancellable
    // listener so pinch never zooms the WebView or scrolls the background.
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open, stage, setZoomLevel]);

  const longScreenshot = Boolean(
    image
      && metrics?.url === image.url
      && metrics.height / Math.max(1, metrics.width) >= 3.2,
  );
  const orientation = longScreenshot
    ? "long-screenshot"
    : metrics && image && metrics.url === image.url
      ? metrics.width >= metrics.height ? "landscape" : "portrait"
      : "contain";
  const renderedSize = useMemo(() => {
    if (
      !image
      || metrics?.url !== image.url
      || viewport.width <= 0
      || viewport.height <= 0
    ) {
      return null;
    }
    const naturalWidth = Math.max(1, metrics.width);
    const naturalHeight = Math.max(1, metrics.height);
    const fitScale = longScreenshot
      ? viewport.width / naturalWidth
      : Math.min(
          viewport.width / naturalWidth,
          viewport.height / naturalHeight,
        );
    return {
      width: Math.max(1, naturalWidth * fitScale * zoom),
      height: Math.max(1, naturalHeight * fitScale * zoom),
    };
  }, [image, longScreenshot, metrics, viewport.height, viewport.width, zoom]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const scroll = scrollRef.current;
    const imageRect = visibleImageRef.current?.getBoundingClientRect();
    if (!anchor || !scroll || !imageRect || !renderedSize) return;
    const rect = scroll.getBoundingClientRect();
    scroll.scrollLeft += imageRect.left + anchor.x * imageRect.width - rect.left - anchor.offsetX;
    scroll.scrollTop += imageRect.top + anchor.y * imageRect.height - rect.top - anchor.offsetY;
    anchorRef.current = null;
  }, [renderedSize]);

  return (
    <Dialog open={open && Boolean(image)} onOpenChange={onOpenChange}>
      <DialogContent
        className="qx-host-workbench-media-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          scrollRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => {
          if (event.isComposing) event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.defaultPrevented || shouldIgnoreBareShortcut(event.nativeEvent) || event.altKey || event.metaKey || event.ctrlKey) return;
          const scroll = scrollRef.current;
          if (event.key === "+" || event.key === "=") changeZoom(0.25);
          else if (event.key === "-") changeZoom(-0.25);
          else if (event.key === "0") resetZoom();
          else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            if (scroll && scroll.scrollWidth > scroll.clientWidth + 1) scroll.scrollLeft += event.key === "ArrowRight" ? 60 : -60;
            else move(event.key === "ArrowRight" ? 1 : -1);
          } else if (scroll && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
            if (event.key === "Home") scroll.scrollTop = 0;
            else if (event.key === "End") scroll.scrollTop = scroll.scrollHeight;
            else scroll.scrollTop += (event.key.endsWith("Up") ? -1 : 1) * (event.key.startsWith("Page") ? scroll.clientHeight * 0.9 : 60);
          } else return;
          event.preventDefault();
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="qx-host-workbench-media-close"
          aria-label={t("common.close", "Close")}
          onClick={() => onOpenChange(false)}
        >
          <X size={16} aria-hidden="true" />
        </Button>
        <DialogHeader>
          <DialogTitle>{image?.alt || t("plugins.workbench.imagePreview", "Image Preview")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("plugins.workbench.imagePreviewHint", "Full-size preview of the selected image")}
          </DialogDescription>
        </DialogHeader>
        {image ? (
          <div
            ref={setStage}
            className="qx-host-workbench-media-preview-stage"
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left;
              const edge = Math.min(rect.width * 0.12, 88);
              event.currentTarget.dataset.edge = x < edge ? "previous" : x > rect.width - edge ? "next" : "";
            }}
            onPointerLeave={(event) => { delete event.currentTarget.dataset.edge; }}
          >
            {images.length > 1 ? (
              <div className="qx-host-workbench-media-preview-nav-zone is-previous">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="qx-host-workbench-media-preview-nav"
                  aria-label={t("plugins.workbench.previousImage", "Previous image")}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <div
              ref={scrollRef}
              className={[
                "qx-host-workbench-media-preview-scroll",
                `is-${orientation}`,
                zoom > 1 || longScreenshot ? "is-enlarged" : zoom < 1 ? "is-reduced" : "",
              ].filter(Boolean).join(" ")}
              tabIndex={0}
              aria-busy={!failed && metrics?.url !== image.url}
              aria-label={t("plugins.workbench.imagePreviewHint", "Full-size preview of the selected image")}
              onPointerDown={(event) => {
                const scroll = event.currentTarget;
                if (event.button !== 0 || (scroll.scrollWidth <= scroll.clientWidth && scroll.scrollHeight <= scroll.clientHeight)) return;
                dragRef.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  scrollLeft: scroll.scrollLeft,
                  scrollTop: scroll.scrollTop,
                };
                scroll.setPointerCapture(event.pointerId);
                scroll.classList.add("is-dragging");
                event.preventDefault();
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.currentTarget.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
                event.currentTarget.scrollTop = drag.scrollTop - (event.clientY - drag.y);
                event.preventDefault();
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId !== event.pointerId) return;
                dragRef.current = null;
                event.currentTarget.classList.remove("is-dragging");
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                dragRef.current = null;
                event.currentTarget.classList.remove("is-dragging");
              }}
              onLostPointerCapture={(event) => {
                dragRef.current = null;
                event.currentTarget.classList.remove("is-dragging");
              }}
            >
              {failed ? <span className="qx-host-workbench-media-error" role="status">{t("plugins.workbench.imageUnavailable", "Image unavailable")}</span> : !src ? <span className="qx-host-workbench-media-error" role="status">{t("plugins.workbench.loading", "Loading…")}</span> : renderedSize ? (
                <div
                  className="qx-host-workbench-media-preview-canvas"
                  style={{
                    width: `${Math.max(viewport.width, renderedSize.width)}px`,
                    height: `${Math.max(viewport.height, renderedSize.height)}px`,
                  }}
                >
                  <img
                    key={image.url}
                    ref={setVisibleImageRef}
                    src={src}
                    draggable={false}
                    alt={image.alt || ""}
                    className={zoom === 1 ? undefined : "is-zoomed"}
                    onLoad={(event) => recordImageMetrics(event.currentTarget)}
                    onError={() => setFailedUrl(image.url)}
                    style={{
                      objectFit: image.fit || "contain",
                      width: `${renderedSize.width}px`,
                      height: `${renderedSize.height}px`,
                      maxWidth: "none",
                      maxHeight: "none",
                    } as CSSProperties}
                  />
                </div>
              ) : (
                <img
                  key={image.url}
                  ref={setVisibleImageRef}
                  src={src}
                  draggable={false}
                  alt={image.alt || ""}
                  className={zoom === 1 ? undefined : "is-zoomed"}
                  onLoad={(event) => recordImageMetrics(event.currentTarget)}
                  onError={() => setFailedUrl(image.url)}
                  style={{
                    objectFit: image.fit || "contain",
                    // Keep zoom functional during WebKit's image-metric gap.
                    // Unlike transform, `zoom` participates in layout, so the
                    // scrollport receives a real overflow area for panning.
                    zoom,
                    maxWidth: "100%",
                    maxHeight: "100%",
                  } as CSSProperties}
                />
              )}
            </div>
            <div className="qx-host-workbench-media-zoom">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={zoom <= 0.5}
                aria-label={t("plugins.workbench.zoomOut", "Zoom out")}
                onClick={() => changeZoom(-0.25)}
              >
                <Minus size={14} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="qx-host-workbench-media-zoom-value"
                aria-label={t("plugins.workbench.resetZoom", "Reset zoom")}
                onClick={resetZoom}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={zoom >= 4}
                aria-label={t("plugins.workbench.zoomIn", "Zoom in")}
                onClick={() => changeZoom(0.25)}
              >
                <Plus size={14} aria-hidden="true" />
              </Button>
            </div>
            {images.length > 1 ? (
              <div className="qx-host-workbench-media-preview-nav-zone is-next">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="qx-host-workbench-media-preview-nav"
                  aria-label={t("plugins.workbench.nextImage", "Next image")}
                  onClick={() => move(1)}
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            {images.length > 1 ? (
              <span className="qx-host-workbench-media-preview-count" aria-live="polite">
                {index + 1} / {images.length}
              </span>
            ) : null}
            {onDownload ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`qx-host-workbench-media-download${images.length > 1 ? " has-count" : ""}`}
                aria-label={t("plugins.workbench.downloadImage", "Download original image")}
                onClick={() => void onDownload(image)}
              >
                <Download size={14} aria-hidden="true" />
                <span>{t("plugins.workbench.downloadImage", "Download original")}</span>
              </Button>
            ) : null}
          </div>
        ) : null}
        {image?.caption ? <p>{image.caption}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

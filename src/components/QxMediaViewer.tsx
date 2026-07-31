import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
}

/** Shared host media viewer for built-in readers and plugin Workbench details. */
export default function QxMediaViewer({
  open,
  images,
  initialIndex = 0,
  onOpenChange,
  onDownload,
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const image = images[index];
  const imageSetKey = useMemo(
    () => images.map((item) => item.url).join("\u0000"),
    [images],
  );

  useEffect(() => {
    if (!open) return;
    setIndex(Math.max(0, Math.min(images.length - 1, initialIndex)));
    setZoom(1);
    setMetrics(null);
    dragRef.current = null;
  }, [imageSetKey, images.length, initialIndex, open]);

  const move = useCallback((delta: number) => {
    setZoom(1);
    setMetrics(null);
    setIndex((current) => {
      if (images.length < 2) return current;
      return (current + delta + images.length) % images.length;
    });
  }, [images.length]);

  const changeZoom = useCallback((delta: number) => {
    setZoom((current) =>
      Math.max(0.5, Math.min(4, Math.round((current + delta) * 10) / 10)),
    );
  }, []);

  useEffect(() => {
    if (!open || images.length < 2) return;
    const now = Date.now();
    pruneMediaDecodeCache(now);
    const offsets = [0, -1, 1, -2, 2];
    const indexes = offsets.map(
      (offset) => (index + offset + images.length) % images.length,
    );
    for (const [priorityIndex, candidateIndex] of indexes.entries()) {
      const url = images[candidateIndex]?.url;
      if (!url) continue;
      const cached = mediaDecodeCache.get(url);
      if (cached) {
        cached.lastAccessedAt = now;
        mediaDecodeCache.delete(url);
        mediaDecodeCache.set(url, cached);
        continue;
      }
      const candidate = new Image();
      candidate.decoding = "async";
      candidate.fetchPriority = Math.abs(offsets[priorityIndex]) <= 1 ? "high" : "low";
      candidate.src = url;
      mediaDecodeCache.set(url, { image: candidate, lastAccessedAt: now });
      void candidate.decode().catch(() => {
        // Visible media retains its normal error behavior; predecode is best effort.
      });
    }
    pruneMediaDecodeCache(now);
    scheduleMediaDecodeCachePrune();
  }, [images, index, open]);

  useEffect(() => {
    if (zoom > 1) return;
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.scrollLeft = 0;
      scroll.scrollTop = 0;
    }
  }, [image?.url, zoom]);

  useEffect(() => {
    if (!open) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const updateViewport = () => {
      setViewport({
        width: Math.max(0, scroll.clientWidth - 4),
        height: Math.max(0, scroll.clientHeight - 4),
      });
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [image?.url, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        move(event.key === "ArrowRight" ? 1 : -1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(0.25);
      } else if (event.key === "-") {
        event.preventDefault();
        changeZoom(-0.25);
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [changeZoom, move, open]);

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

  return (
    <Dialog open={open && Boolean(image)} onOpenChange={onOpenChange}>
      <DialogContent className="qx-host-workbench-media-dialog">
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
            className="qx-host-workbench-media-preview-stage"
            onWheel={(event) => {
              if (event.metaKey || event.ctrlKey) {
                event.preventDefault();
                event.stopPropagation();
                setZoom((current) => {
                  const next = current * Math.exp(-event.deltaY * 0.0025);
                  return Math.max(0.5, Math.min(4, Math.round(next * 100) / 100));
                });
                return;
              }
              if (zoom <= 1) return;
              const scroll = scrollRef.current;
              if (!scroll) return;
              event.preventDefault();
              event.stopPropagation();
              scroll.scrollLeft += event.deltaX;
              scroll.scrollTop += event.deltaY;
            }}
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
                zoom > 1 ? "is-enlarged" : zoom < 1 ? "is-reduced" : "",
              ].filter(Boolean).join(" ")}
              tabIndex={0}
              aria-label={t("plugins.workbench.imagePreviewHint", "Full-size preview of the selected image")}
              onPointerDown={(event) => {
                if (zoom <= 1 || event.button !== 0) return;
                const scroll = event.currentTarget;
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
            >
              <img
                key={image.url}
                src={image.url}
                alt={image.alt || ""}
                className={zoom === 1 ? undefined : "is-zoomed"}
                onLoad={(event) => {
                  const element = event.currentTarget;
                  setMetrics({
                    url: image.url,
                    width: element.naturalWidth,
                    height: element.naturalHeight,
                  });
                }}
                style={{
                  objectFit: image.fit || "contain",
                  width: renderedSize ? `${renderedSize.width}px` : undefined,
                  height: renderedSize ? `${renderedSize.height}px` : undefined,
                  maxWidth: renderedSize ? "none" : "100%",
                  maxHeight: renderedSize ? "none" : "100%",
                } as CSSProperties}
              />
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
                onClick={() => setZoom(1)}
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

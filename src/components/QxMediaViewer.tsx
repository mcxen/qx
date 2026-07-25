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
  const decodeCache = useRef(new Map<string, HTMLImageElement>());
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
    const cache = decodeCache.current;
    const indexes = [-2, -1, 1, 2].map(
      (offset) => (index + offset + images.length) % images.length,
    );
    for (const [priorityIndex, candidateIndex] of indexes.entries()) {
      const url = images[candidateIndex]?.url;
      if (!url || cache.has(url)) continue;
      const candidate = new Image();
      candidate.decoding = "async";
      candidate.fetchPriority = priorityIndex === 1 || priorityIndex === 2 ? "high" : "low";
      candidate.src = url;
      cache.set(url, candidate);
      void candidate.decode().catch(() => {
        // Visible media retains its normal error behavior; predecode is best effort.
      });
    }
    while (cache.size > 8) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, [images, index, open]);

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
              event.preventDefault();
              event.stopPropagation();
              setZoom((current) => {
                const next = current * Math.exp(-event.deltaY * 0.0025);
                return Math.max(0.5, Math.min(4, Math.round(next * 100) / 100));
              });
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
              className={[
                "qx-host-workbench-media-preview-scroll",
                `is-${orientation}`,
                zoom > 1 ? "is-enlarged" : zoom < 1 ? "is-reduced" : "",
              ].filter(Boolean).join(" ")}
              tabIndex={0}
              aria-label={t("plugins.workbench.imagePreviewHint", "Full-size preview of the selected image")}
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
                  "--qx-image-zoom-size": `${Math.round(zoom * 100)}%`,
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

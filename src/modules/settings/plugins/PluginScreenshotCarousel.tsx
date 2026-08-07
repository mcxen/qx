import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { InstalledPlugin } from "../../../plugin/types";
import { useT } from "../../../i18n";
import PluginAssetImage from "./PluginAssetImage";

/**
 * Horizontal screenshot carousel for installed plugin details.
 * Supports arrow buttons, keyboard, clickable dots, and pointer swipe.
 */
export default function PluginScreenshotCarousel({
  plugin,
  screenshots,
}: {
  plugin: InstalledPlugin;
  screenshots: string[];
}) {
  const t = useT();
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    deltaX: number;
    dragging: boolean;
  } | null>(null);
  const [index, setIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const count = screenshots.length;

  useEffect(() => {
    setIndex(0);
    setDragOffset(0);
    dragRef.current = null;
  }, [plugin.id, screenshots.join("\0")]);

  const go = useCallback(
    (next: number) => {
      if (count <= 0) return;
      const normalized = ((next % count) + count) % count;
      setIndex(normalized);
      setDragOffset(0);
    },
    [count],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count <= 1) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      go(0);
    } else if (event.key === "End") {
      event.preventDefault();
      go(count - 1);
    }
  };

  const endDrag = (commit: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) {
      setDragOffset(0);
      return;
    }
    const width = trackRef.current?.clientWidth || 1;
    const threshold = Math.min(80, width * 0.18);
    if (commit && Math.abs(drag.deltaX) >= threshold) {
      go(drag.deltaX > 0 ? index - 1 : index + 1);
    } else {
      setDragOffset(0);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (count <= 1 || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      deltaX: 0,
      dragging: true,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !drag.dragging || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    drag.deltaX = deltaX;
    setDragOffset(deltaX);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    endDrag(true);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    endDrag(false);
  };

  if (count === 0) return null;

  const translatePct = -index * 100;
  const width = trackRef.current?.clientWidth || 0;
  const dragPct = width > 0 ? (dragOffset / width) * 100 : 0;
  const transform = `translate3d(calc(${translatePct}% + ${dragPct}%), 0, 0)`;
  const isDragging = Boolean(dragRef.current?.dragging);

  return (
    <div
      className="qx-plugin-screenshot-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-labelledby={labelId}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <span id={labelId} className="sr-only">
        {t("plugins.screenshots", "Screenshots")}
      </span>

      <div
        ref={trackRef}
        className={`qx-plugin-screenshot-viewport${isDragging ? " is-dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          className="qx-plugin-screenshot-track"
          style={{ transform, transition: isDragging ? "none" : undefined }}
        >
          {screenshots.map((screenshot, i) => (
            <div
              key={`${plugin.id}:${screenshot}`}
              className="qx-plugin-screenshot-slide"
              aria-hidden={i !== index}
            >
              <PluginAssetImage
                plugin={plugin}
                asset={screenshot}
                className="qx-plugin-screenshot"
                fallback={t("plugins.preview", "Preview")}
              />
            </div>
          ))}
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="qx-plugin-screenshot-nav is-prev"
            aria-label={t("plugins.screenshots.prev", "Previous screenshot")}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="qx-plugin-screenshot-nav is-next"
            aria-label={t("plugins.screenshots.next", "Next screenshot")}
            onClick={() => go(index + 1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>

          <div className="qx-plugin-screenshot-dots" role="tablist" aria-label={t("plugins.screenshots", "Screenshots")}>
            {screenshots.map((screenshot, i) => (
              <button
                key={`dot-${screenshot}`}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={t("plugins.screenshots.goto", "Screenshot {n}")
                  .replace("{n}", String(i + 1))}
                className={`qx-plugin-screenshot-dot${i === index ? " is-active" : ""}`}
                onClick={() => go(i)}
              />
            ))}
          </div>

          <div className="qx-plugin-screenshot-counter" aria-live="polite">
            {index + 1} / {count}
          </div>
        </>
      )}
    </div>
  );
}

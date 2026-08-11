import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "../../i18n";
import { writeImageFileToClipboard } from "../../system";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.1;
const MIN_EDGE = 64;

function decodePathParam(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Seamless desktop pin: the window *is* the image (no nested chrome frame).
 * Drag to move, wheel / ± resize the window with the image, Esc close.
 */
export default function CapturePinWindow() {
  const t = useT();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const path = useMemo(() => decodePathParam(params.get("path")), [params]);
  const label = useMemo(() => getCurrentWindow().label, []);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [opacity, setOpacity] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 12, y: 12 });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const applyingSize = useRef(false);
  const src = path ? convertFileSrc(path) : "";

  const closePin = useCallback(async () => {
    try {
      await invoke("screencap_pin_close", { label });
    } catch {
      try {
        await getCurrentWindow().close();
      } catch {
        // Best effort.
      }
    }
  }, [label]);

  const copyImage = useCallback(async () => {
    if (!path) return;
    setError(null);
    try {
      await writeImageFileToClipboard(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (copyError) {
      setError(String(copyError));
    }
  }, [path]);

  const pendingZoomRef = useRef(zoom);
  pendingZoomRef.current = zoom;

  const applyWindowSize = useCallback(async (size: { w: number; h: number }) => {
    if (applyingSize.current) return;
    applyingSize.current = true;
    try {
      // Drain coalesced zoom updates so rapid wheel steps don't stick mid-size.
      for (;;) {
        const nextZoom = pendingZoomRef.current;
        const dpr = window.devicePixelRatio || 1;
        // naturalWidth is image pixels; logical size matches 1:1 capture pixels.
        const logicalW = Math.max(MIN_EDGE, (size.w / dpr) * nextZoom);
        const logicalH = Math.max(MIN_EDGE, (size.h / dpr) * nextZoom);
        await getCurrentWindow().setSize(new LogicalSize(logicalW, logicalH));
        if (pendingZoomRef.current === nextZoom) break;
      }
    } catch {
      // Ignore transient size failures during close.
    } finally {
      applyingSize.current = false;
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("qx-capture-pin-body");
    return () => document.body.classList.remove("qx-capture-pin-body");
  }, []);

  useEffect(() => {
    if (!natural) return;
    void applyWindowSize(natural);
  }, [applyWindowSize, natural, zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void closePin();
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyImage();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((value) => Math.min(MAX_ZOOM, value * ZOOM_STEP));
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((value) => Math.max(MIN_ZOOM, value / ZOOM_STEP));
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
        return;
      }
      if (event.key === "[") {
        event.preventDefault();
        setOpacity((value) => Math.max(0.25, Math.round((value - 0.1) * 10) / 10));
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        setOpacity((value) => Math.min(1, Math.round((value + 0.1) * 10) / 10));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePin, copyImage]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.querySelector(".qx-capture-pin-menu")?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  if (!path) {
    return (
      <div className="qx-capture-pin is-error">
        <p>{t("screencap.pin.missing", "Pin image path is missing.")}</p>
        <button type="button" onClick={() => void closePin()}>
          {t("common.close", "Close")}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`qx-capture-pin${menuOpen ? " is-menu-open" : ""}${hover ? " is-hover" : ""}`}
      style={{ opacity }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={(event) => {
        event.preventDefault();
        void closePin();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPos({
          x: Math.min(event.clientX, window.innerWidth - 160),
          y: Math.min(event.clientY, window.innerHeight - 140),
        });
        setMenuOpen(true);
      }}
      onWheel={(event) => {
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
        setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value * direction)));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button, .qx-capture-pin-menu")) return;
        void getCurrentWindow().startDragging().catch(() => {});
      }}
    >
      <img
        className="qx-capture-pin-image"
        src={src}
        alt=""
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;
          const w = image.naturalWidth || image.width;
          const h = image.naturalHeight || image.height;
          if (w > 0 && h > 0) setNatural({ w, h });
        }}
        onError={() => setError(t("screencap.pin.loadFailed", "Could not load pin image."))}
      />
      {(hover || menuOpen) && (
        <button
          type="button"
          className="qx-capture-pin-close"
          aria-label={t("screencap.pin.close", "Close pin")}
          onClick={(event) => {
            event.stopPropagation();
            void closePin();
          }}
        >
          ×
        </button>
      )}
      {error && <div className="qx-capture-pin-error">{error}</div>}
      {copied && (
        <div className="qx-capture-pin-toast" role="status">
          {t("screencap.toast.copied", "Copied")}
        </div>
      )}
      {menuOpen && (
        <div
          className="qx-capture-pin-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void copyImage();
            }}
          >
            {t("screencap.pin.copy", "Copy image")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setZoom(1);
              setMenuOpen(false);
            }}
          >
            {t("screencap.pin.resetZoom", "Actual size")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpacity(1);
              setMenuOpen(false);
            }}
          >
            {t("screencap.pin.resetOpacity", "Reset opacity")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setMenuOpen(false);
              void closePin();
            }}
          >
            {t("screencap.pin.close", "Close pin")}
          </button>
        </div>
      )}
    </div>
  );
}

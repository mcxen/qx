import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "../../i18n";
import { writeImageFileToClipboard } from "../../system";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.12;

function decodePathParam(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Snipaste-style desktop pin: always-on-top floating screenshot surface.
 * Drag to move, wheel to zoom, Esc / double-click to close, ⌘/Ctrl+C to copy.
 */
export default function CapturePinWindow() {
  const t = useT();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const path = useMemo(() => decodePathParam(params.get("path")), [params]);
  const label = useMemo(() => getCurrentWindow().label, []);
  const [zoom, setZoom] = useState(1);
  const [opacity, setOpacity] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 12, y: 12 });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    document.body.classList.add("qx-capture-pin-body");
    return () => document.body.classList.remove("qx-capture-pin-body");
  }, []);

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
        setOpacity((value) => Math.max(0.2, Math.round((value - 0.1) * 10) / 10));
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
      className={`qx-capture-pin${menuOpen ? " is-menu-open" : ""}`}
      style={{ opacity }}
      onDoubleClick={(event) => {
        event.preventDefault();
        void closePin();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPos({ x: event.clientX, y: event.clientY });
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
        // Tauri drag starts from the next pointer move after this call.
        void getCurrentWindow().startDragging().catch(() => {});
      }}
    >
      <img
        className="qx-capture-pin-image"
        src={src}
        alt=""
        draggable={false}
        style={{ transform: `scale(${zoom})` }}
        onError={() => setError(t("screencap.pin.loadFailed", "Could not load pin image."))}
      />
      <div className="qx-capture-pin-chrome" aria-hidden={menuOpen ? undefined : true}>
        <span className="qx-capture-pin-hint">
          {t(
            "screencap.pin.hint",
            "Drag · wheel zoom · Esc close · ⌘/Ctrl+C copy",
          )}
        </span>
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
      </div>
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
            {t("screencap.pin.resetZoom", "Reset zoom")}
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

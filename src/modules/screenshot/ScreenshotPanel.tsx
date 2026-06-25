import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  Camera,
  Copy,
  FileImage,
  FolderOpen,
  MonitorUp,
  Scan,
  Trash2,
} from "lucide-react";
import { useStore, type ScreenshotEntry } from "../../store";
import QxShell from "../../components/QxShell";
import { useEscBack } from "../../hooks/useEscBack";
import ScreenshotEditor from "./ScreenshotEditor";
import WindowPickerDialog from "./WindowPickerDialog";

export const REGION_CAPTURE_EVENT = "qx:screenshot-region-capture";

export function enterRegionCapture() {
  window.dispatchEvent(new Event(REGION_CAPTURE_EVENT));
}

type IslandTone = "neutral" | "success" | "danger";

export default function ScreenshotPanel() {
  const setTab = useStore((state) => state.setTab);
  const screenshotCapture = useStore((state) => state.screenshotCapture);
  const [recent, setRecent] = useState<ScreenshotEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<IslandTone>("neutral");
  const [showWindowPicker, setShowWindowPicker] = useState(false);

  const loadRecent = useCallback(async () => {
    try {
      const res = await invoke<ScreenshotEntry[]>("get_recent_screenshots", {
        limit: 50,
      });
      setRecent(res);
    } catch {
      // History is best-effort; capture actions surface their own errors.
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const setStatus = useCallback((next: string | null, nextTone: IslandTone = "neutral") => {
    setMessage(next);
    setTone(nextTone);
    if (next && nextTone === "success") {
      window.setTimeout(() => setMessage(null), 2200);
    }
  }, []);

  const showScreenshot = useCallback((entry: ScreenshotEntry) => {
    setActivePath(entry.path);
    setPreviewSrc(convertFileSrc(entry.path));
    setStatus(null);
  }, [setStatus]);

  useEffect(() => {
    if (screenshotCapture.previewPath) {
      const entry = {
        path: screenshotCapture.previewPath,
        timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
      };
      showScreenshot(entry);
      void loadRecent();
    }
    if (screenshotCapture.error) {
      setStatus(screenshotCapture.error, "danger");
    }
  }, [
    loadRecent,
    screenshotCapture.error,
    screenshotCapture.previewPath,
    setStatus,
    showScreenshot,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter((screenshot) =>
      (screenshot.path.split("/").pop() ?? "").toLowerCase().includes(q),
    );
  }, [query, recent]);

  useEffect(() => {
    setSelected((cur) => Math.min(cur, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const selectedItem = filtered[selected];

  const captureFull = useCallback(async () => {
    setStatus("Capturing", "neutral");
    try {
      const result = await invoke<ScreenshotEntry>("take_screenshot");
      showScreenshot(result);
      setStatus("Saved", "success");
      void loadRecent();
    } catch (error) {
      setStatus(String(error), "danger");
    }
  }, [loadRecent, setStatus, showScreenshot]);

  const captureAll = useCallback(async () => {
    setStatus("Capturing displays", "neutral");
    try {
      const result = await invoke<ScreenshotEntry>("capture_all_monitors");
      showScreenshot(result);
      setStatus("Saved", "success");
      void loadRecent();
    } catch (error) {
      setStatus(String(error), "danger");
    }
  }, [loadRecent, setStatus, showScreenshot]);

  const startAreaSelect = useCallback(() => {
    setStatus("Select area", "neutral");
    enterRegionCapture();
  }, [setStatus]);

  const captureWindow = useCallback(
    async (windowId: number) => {
      setShowWindowPicker(false);
      setStatus("Capturing window", "neutral");
      try {
        const result = await invoke<ScreenshotEntry>("capture_window", { windowId });
        showScreenshot(result);
        setStatus("Saved", "success");
        void loadRecent();
      } catch (error) {
        setStatus(String(error), "danger");
      }
    },
    [loadRecent, setStatus, showScreenshot],
  );

  const copyOriginal = useCallback(async () => {
    if (!activePath) return;
    try {
      await invoke("copy_screenshot_to_clipboard", { path: activePath });
      setStatus("Copied original", "success");
    } catch (error) {
      setStatus(`Copy failed: ${error}`, "danger");
    }
  }, [activePath, setStatus]);

  const openInPreview = useCallback(async () => {
    if (!activePath) return;
    try {
      await invoke("open_in_preview", { path: activePath });
    } catch (error) {
      setStatus(`Open failed: ${error}`, "danger");
    }
  }, [activePath, setStatus]);

  const deleteScreenshot = useCallback(async () => {
    if (!activePath) return;
    try {
      await invoke("delete_screenshot", { path: activePath });
      setActivePath(null);
      setPreviewSrc(null);
      setStatus("Deleted", "success");
      void loadRecent();
    } catch (error) {
      setStatus(`Delete failed: ${error}`, "danger");
    }
  }, [activePath, loadRecent, setStatus]);

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: { active: showWindowPicker || activePath !== null, close: () => {
      if (showWindowPicker) setShowWindowPicker(false);
      else {
        setActivePath(null);
        setPreviewSrc(null);
      }
    } },
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: () => setTab("launcher"),
  });

  const handleKeyDown = (event: React.KeyboardEvent) => {
    escKeyDown(event);
    if (event.key === "Escape") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (event.key === "Enter" && selectedItem) {
      event.preventDefault();
      showScreenshot(selectedItem);
    }
  };

  const searchSlot = (
    <div className="qx-search-wrap">
      <span className="qx-search-icon" aria-hidden="true" />
      <input
        type="text"
        value={query}
        autoFocus
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        placeholder="Filter screenshots..."
        className="qx-plugin-search"
      />
    </div>
  );

  const context = (
    <div className="qx-shot-context">
      <div className="qx-action-panel">
        <div className="qx-action-title">Capture</div>
        <button className="qx-action-item" onClick={captureFull}>
          <Camera size={14} />
          <span>Full Screen</span>
        </button>
        <button className="qx-action-item" onClick={startAreaSelect}>
          <Scan size={14} />
          <span>Select Area</span>
        </button>
        <button className="qx-action-item" onClick={() => setShowWindowPicker(true)}>
          <FileImage size={14} />
          <span>Window</span>
        </button>
        <button className="qx-action-item" onClick={captureAll}>
          <MonitorUp size={14} />
          <span>All Displays</span>
        </button>
      </div>

      <div className="qx-action-panel">
        <div className="qx-action-title">Original</div>
        <button className="qx-action-item" disabled={!activePath} onClick={copyOriginal}>
          <Copy size={14} />
          <span>Copy Original</span>
        </button>
        <button className="qx-action-item" disabled={!activePath} onClick={openInPreview}>
          <FolderOpen size={14} />
          <span>Open File</span>
        </button>
        <button className="qx-action-item danger" disabled={!activePath} onClick={deleteScreenshot}>
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      </div>

      {activePath && (
        <div className="qx-shot-info">
          <div className="qx-action-title">File</div>
          <div className="qx-shot-info-name">{activePath.split("/").pop()}</div>
          {previewSrc && <img src={previewSrc} alt="" />}
        </div>
      )}
    </div>
  );

  const itemCount = filtered.length;
  const islandLabel = message
    ? tone === "danger"
      ? "Screenshot Error"
      : message
    : activePath
      ? "Editing"
      : screenshotCapture.status === "idle"
        ? "Screenshot"
        : "Capturing";

  return (
    <QxShell
      title="Screenshot"
      search={searchSlot}
      onBack={() => setTab("launcher")}
      onKeyDown={handleKeyDown}
      context={context}
      island={{
        label: islandLabel,
        detail: message && tone === "danger"
          ? message
          : activePath
            ? activePath.split("/").pop()
            : `${recent.length} captures`,
        tone,
      }}
      primaryAction={{ label: activePath ? "Export" : "Capture Full", onClick: activePath ? undefined : captureFull, disabled: Boolean(activePath) }}
      secondaryAction={{ label: activePath ? "Copy Original" : "Select Area", onClick: activePath ? copyOriginal : startAreaSelect }}
      className="qx-shot-shell"
    >
      <div className="qx-shot-layout">
        <aside className="qx-shot-history">
          <div className="qx-section-header">
            <span>Recent</span>
            <span>{itemCount}</span>
          </div>
          {filtered.length === 0 ? (
            <div className="qx-empty-state">
              {recent.length === 0 ? "No screenshots yet" : "No matching screenshots"}
            </div>
          ) : (
            filtered.map((screenshot, index) => {
              const active = index === selected;
              return (
                <button
                  key={screenshot.path}
                  type="button"
                  className={`qx-list-row compact${active ? " is-active" : ""}`}
                  onClick={() => {
                    setSelected(index);
                    showScreenshot(screenshot);
                  }}
                >
                  <span className="qx-list-icon" aria-hidden="true">
                    <span className="qx-symbol-icon image" />
                  </span>
                  <span className="qx-list-copy">
                    <span className="qx-list-title">{screenshot.path.split("/").pop()}</span>
                    <span className="qx-list-subtitle">{screenshot.timestamp}</span>
                  </span>
                </button>
              );
            })
          )}
        </aside>

        <section className="qx-shot-workspace">
          <ScreenshotEditor
            activePath={activePath}
            onStatus={setStatus}
            onSaved={() => {
              setStatus("Saved", "success");
              void loadRecent();
            }}
          />
        </section>
      </div>

      {showWindowPicker && (
        <WindowPickerDialog
          onSelect={(windowId) => void captureWindow(windowId)}
          onCancel={() => setShowWindowPicker(false)}
        />
      )}
    </QxShell>
  );
}

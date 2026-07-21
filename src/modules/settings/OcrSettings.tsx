import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSettingsStore } from "./store";
import { Button, Row, Toggle, Select, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { setPendingModuleLaunch } from "../../search/moduleSurfaces";
import { getQxDesktopPlatform } from "../../utils/keyboard";
import {
  ocrClearHistory,
  ocrDeleteHistory,
  ocrListHistory,
  type OcrHistoryEntry,
} from "../../system/ocr";

interface DownloadProgress {
  percent: number;
  status: string;
}

export default function OcrSettings() {
  const { settings, patch } = useSettingsStore();
  const t = useT();
  const setTab = useStore((s) => s.setTab);
  const adv = settings.advanced;

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadDone, setDownloadDone] = useState(false);
  const [history, setHistory] = useState<OcrHistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      setHistoryBusy(true);
      setHistoryError(null);
      const rows = await ocrListHistory(80);
      setHistory(rows);
      if (selectedId && !rows.some((row) => row.id === selectedId)) {
        setSelectedId(rows[0]?.id ?? null);
      } else if (!selectedId && rows[0]) {
        setSelectedId(rows[0].id);
      }
    } catch (error) {
      setHistoryError(String(error));
    } finally {
      setHistoryBusy(false);
    }
  }, [selectedId]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<DownloadProgress>("ocr-download-progress", (event) => {
        setProgress(event.payload);
        if (event.payload.percent >= 100) {
          setDownloadDone(true);
          setDownloading(false);
        }
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (adv.ocr_enabled) void refreshHistory();
  }, [adv.ocr_enabled, refreshHistory]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setProgress(null);
    setDownloadDone(false);
    try {
      await invoke("download_ocr_model", { size: adv.ocr_model_size });
    } catch (e) {
      console.error("download_ocr_model failed", e);
      setDownloading(false);
    }
  }, [adv.ocr_model_size]);

  const selected = history.find((row) => row.id === selectedId) ?? history[0] ?? null;
  const isOarOcr = adv.ocr_engine === "oar-ocr";
  const isMac = getQxDesktopPlatform() === "macos";

  useEffect(() => {
    if (!isMac && adv.ocr_engine === "apple-vision") {
      patch("advanced", { ...adv, ocr_engine: "oar-ocr" });
    }
  }, [adv, isMac, patch]);

  const copySelected = async () => {
    if (!selected?.text) return;
    try {
      await writeText(selected.text);
    } catch {
      /* ignore */
    }
  };

  const openInEditor = () => {
    if (!selected?.text?.trim()) return;
    setPendingModuleLaunch({
      tab: "documents",
      surface: "import",
      params: {
        content: selected.text,
        title:
          selected.text.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 48) || "OCR",
      },
    });
    setTab("documents");
  };

  const deleteSelected = async () => {
    if (!selected) return;
    try {
      await ocrDeleteHistory(selected.id);
      await refreshHistory();
    } catch (error) {
      setHistoryError(String(error));
    }
  };

  const clearAll = async () => {
    try {
      await ocrClearHistory();
      setHistory([]);
      setSelectedId(null);
    } catch (error) {
      setHistoryError(String(error));
    }
  };

  return (
    <div className="qx-settings-page">
      <SettingsCard title={t("ocr.capture.title", "Recognition")}>
        <Row
          title={t("ocr.enable", "Enable OCR")}
          description={t(
            "ocr.enable.desc",
            "Enable optical character recognition for screenshots, clipboard images, and plugins.",
          )}
        >
          <Toggle
            value={adv.ocr_enabled}
            onChange={(v) => patch("advanced", { ...adv, ocr_enabled: v })}
          />
        </Row>
      </SettingsCard>

      {adv.ocr_enabled && (
        <>
          <SettingsCard title={t("ocr.engine.title", "Engine")}>
            <Row
              title={t("ocr.engine", "OCR Engine")}
              description={t("ocr.engine.desc", "Choose the OCR backend engine.")}
            >
              <Select
                value={adv.ocr_engine}
                onChange={(v) => patch("advanced", { ...adv, ocr_engine: v })}
                options={[
                  ...(isMac
                    ? [{
                        value: "apple-vision",
                        label: t(
                          "ocr.engine.appleVision",
                          "Apple Vision (macOS native, no download)",
                        ),
                      }]
                    : []),
                  {
                    value: "oar-ocr",
                    label: t(
                      "ocr.engine.oarOcr",
                      isMac
                        ? "OAR-OCR pack (uses Apple Vision runtime)"
                        : "Windows OCR (OAR model pack optional)",
                    ),
                  },
                ]}
              />
            </Row>
          </SettingsCard>

          {isOarOcr && (
            <SettingsCard title={t("ocr.model.title", "OAR Model")}>
              <Row
                title={t("ocr.modelSize", "Model Size")}
                description={t(
                  "ocr.modelSize.desc",
                  "Larger models are more accurate but use more disk space and memory.",
                )}
              >
                <Select
                  value={adv.ocr_model_size}
                  onChange={(v) => patch("advanced", { ...adv, ocr_model_size: v })}
                  options={[
                    { value: "tiny", label: t("ocr.size.tiny", "Tiny (~5MB)") },
                    { value: "small", label: t("ocr.size.small", "Small (~15MB)") },
                    { value: "medium", label: t("ocr.size.medium", "Medium (~30MB)") },
                  ]}
                />
              </Row>

              <Row
                title={t("ocr.download", "Download OCR Models")}
                description={t(
                  "ocr.download.desc",
                  "Download the selected OCR model pack (optional; recognition uses the OS engine today).",
                )}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading
                    ? t("ocr.downloading", "Downloading…")
                    : t("ocr.downloadBtn", "Download OCR Models")}
                </Button>
              </Row>

              {progress && (
                <div className="qx-settings-progress">
                  <div className="qx-settings-progress-track">
                    <div
                      className="qx-settings-progress-fill"
                      style={{ width: `${Math.min(progress.percent, 100)}%` }}
                    />
                  </div>
                  <div className="qx-settings-progress-label">{progress.status}</div>
                </div>
              )}

              {downloadDone && (
                <div className="qx-settings-success">
                  {t("ocr.downloadComplete", "Download complete!")}
                </div>
              )}
            </SettingsCard>
          )}

          <SettingsCard
            title={t("ocr.history.title", "OCR History")}
            description={t(
              "ocr.history.desc",
              "Recent recognition results from screenshots and clipboard images.",
            )}
          >
            <div className="qx-ocr-history">
              <div className="qx-ocr-history-toolbar">
                <Button variant="secondary" size="sm" onClick={() => void refreshHistory()} disabled={historyBusy}>
                  {t("ocr.history.refresh", "Refresh")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void clearAll()} disabled={history.length === 0}>
                  {t("ocr.history.clear", "Clear All")}
                </Button>
              </div>
              {historyError && <div className="qx-settings-error">{historyError}</div>}
              {history.length === 0 ? (
                <div className="qx-empty-state qx-ocr-history-empty">
                  {historyBusy
                    ? t("common.loading", "Loading")
                    : t("ocr.history.empty", "No OCR history yet. Capture a screenshot with OCR or run OCR on a clipboard image.")}
                </div>
              ) : (
                <div className="qx-ocr-history-layout">
                  <ul className="qx-ocr-history-list" role="listbox">
                    {history.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={`qx-ocr-history-row${selected?.id === row.id ? " is-active" : ""}`}
                          onClick={() => setSelectedId(row.id)}
                        >
                          <span className="qx-ocr-history-preview">
                            {row.text.replace(/\s+/g, " ").trim().slice(0, 72) || "—"}
                          </span>
                          <span className="qx-ocr-history-meta">
                            {row.createdAt} · {row.source} · {row.charCount}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {selected && (
                    <div className="qx-ocr-history-detail">
                      <pre className="qx-ocr-history-text">{selected.text}</pre>
                      <div className="qx-ocr-history-actions">
                        <Button variant="secondary" size="sm" onClick={() => void copySelected()}>
                          {t("ocr.history.copy", "Copy Text")}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={openInEditor}>
                          {t("ocr.history.openEditor", "Open in Text Toolbox")}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => void deleteSelected()}>
                          {t("ocr.history.delete", "Delete")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SettingsCard>
        </>
      )}
    </div>
  );
}

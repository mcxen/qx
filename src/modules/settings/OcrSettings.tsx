import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore } from "./store";
import { Row, Toggle, Select } from "../../components/ui";
import { useT } from "../../i18n";

interface DownloadProgress {
  percent: number;
  status: string;
}

export default function OcrSettings() {
  const { settings, patch } = useSettingsStore();
  const t = useT();
  const adv = settings.advanced;

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadDone, setDownloadDone] = useState(false);

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

  const isOarOcr = adv.ocr_engine === "oar-ocr";

  return (
    <div className="qx-settings-page">
      <Row
        title={t("ocr.enable", "Enable OCR")}
        description={t("ocr.enable.desc", "Enable optical character recognition for images.")}
      >
        <Toggle
          value={adv.ocr_enabled}
          onChange={(v) => patch("advanced", { ...adv, ocr_enabled: v })}
        />
      </Row>

      {adv.ocr_enabled && (
        <>
          <Row
            title={t("ocr.engine", "OCR Engine")}
            description={t("ocr.engine.desc", "Choose the OCR backend engine.")}
          >
            <Select
              value={adv.ocr_engine}
              onChange={(v) => patch("advanced", { ...adv, ocr_engine: v })}
              options={[
                { value: "apple-vision", label: t("ocr.engine.appleVision", "Apple Vision (macOS native, no download)") },
                { value: "oar-ocr", label: t("ocr.engine.oarOcr", "OAR-OCR (cross-platform, needs model download)") },
              ]}
            />
          </Row>

          {isOarOcr && (
            <>
              <Row
                title={t("ocr.modelSize", "Model Size")}
                description={t("ocr.modelSize.desc", "Larger models are more accurate but use more disk space and memory.")}
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
                description={t("ocr.download.desc", "Download the selected OCR model to enable OAR-OCR recognition.")}
              >
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="qx-command-button primary"
                >
                  {downloading ? t("ocr.downloading", "Downloading…") : t("ocr.downloadBtn", "Download OCR Models")}
                </button>
              </Row>

              {progress && (
                <div style={{ padding: "8px 0" }}>
                  <div
                    style={{
                      width: "100%",
                      height: 8,
                      background: "var(--qx-border-1)",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(progress.percent, 100)}%`,
                        height: "100%",
                        background: "var(--qx-accent)",
                        borderRadius: 4,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--qx-text-secondary)",
                      marginTop: 4,
                    }}
                  >
                    {progress.status}
                  </div>
                </div>
              )}

              {downloadDone && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--qx-success)",
                    padding: "4px 0 8px",
                  }}
                >
                  {t("ocr.downloadComplete", "Download complete!")}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

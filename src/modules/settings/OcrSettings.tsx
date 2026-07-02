import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore } from "./store";
import { Button, Row, Toggle, Select, SettingsCard } from "../../components/ui";
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
      <SettingsCard
        title={t("ocr.capture.title", "Recognition")}
        description={t("ocr.capture.desc", "Enable OCR features used by screenshots, clipboard images, and plugins.")}
      >
        <Row
          title={t("ocr.enable", "Enable OCR")}
          description={t("ocr.enable.desc", "Enable optical character recognition for images.")}
        >
          <Toggle
            value={adv.ocr_enabled}
            onChange={(v) => patch("advanced", { ...adv, ocr_enabled: v })}
          />
        </Row>
      </SettingsCard>

      {adv.ocr_enabled && (
        <>
          <SettingsCard
            title={t("ocr.engine.title", "Engine")}
            description={t("ocr.engine.cardDesc", "Choose the local OCR backend for recognition jobs.")}
          >
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
          </SettingsCard>

          {isOarOcr && (
            <SettingsCard
              title={t("ocr.model.title", "OAR Model")}
              description={t("ocr.model.desc", "Select and download the recognition model used by OAR-OCR.")}
            >
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading ? t("ocr.downloading", "Downloading…") : t("ocr.downloadBtn", "Download OCR Models")}
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
        </>
      )}
    </div>
  );
}

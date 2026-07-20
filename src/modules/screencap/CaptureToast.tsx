import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useT } from "../../i18n";
import { revealSystemPath, writeImageFileToClipboard } from "../../system";

interface Props {
  path: string;
  onOpen: () => void;
  onDismiss: () => void;
}

/** Brief post-screenshot card with open / copy / reveal. */
export default function CaptureToast({ path, onOpen, onDismiss }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = convertFileSrc(path);
  const fileName = path.split(/[\\/]/).pop() ?? path;

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4500);
    return () => window.clearTimeout(timer);
  }, [path, onDismiss]);

  const copy = async () => {
    setError(null);
    try {
      await writeImageFileToClipboard(path);
      setCopied(true);
    } catch (copyError) {
      setError(String(copyError));
    }
  };

  const reveal = async () => {
    try {
      await revealSystemPath(path);
    } catch (revealError) {
      setError(String(revealError));
    }
  };

  return (
    <div className="qx-capture-toast" role="status">
      <button type="button" className="qx-capture-toast-thumb" onClick={onOpen} aria-label={t("screencap.toast.open", "Open")}>
        <img src={src} alt="" />
      </button>
      <div className="qx-capture-toast-body">
        <strong>{t("screencap.toast.saved", "Screenshot saved")}</strong>
        <span>{fileName}</span>
        {error && <small className="is-error">{error}</small>}
        <div className="qx-capture-toast-actions">
          <button type="button" onClick={onOpen}>{t("screencap.toast.open", "Open")}</button>
          <button type="button" onClick={() => void copy()}>
            {copied ? t("screencap.toast.copied", "Copied") : t("screencap.toast.copy", "Copy")}
          </button>
          <button type="button" onClick={() => void reveal()}>{t("screencap.toast.reveal", "Show")}</button>
          <button type="button" className="is-ghost" onClick={onDismiss}>{t("common.dismiss", "Dismiss")}</button>
        </div>
      </div>
    </div>
  );
}

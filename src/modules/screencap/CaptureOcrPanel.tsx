import { useEffect, useRef, useState } from "react";
import { Redo2, Save, ScanText, Undo2 } from "lucide-react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { ocrRecognizePath } from "../../system/ocr";
import { readCaptureOcrDraft, saveCaptureOcrDraft } from "./captureOcrDrafts";

interface Props {
  path: string;
}

const MAX_HISTORY = 100;

export default function CaptureOcrPanel({ path }: Props) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = readCaptureOcrDraft(path) ?? "";
    setText(stored);
    setHistory([stored]);
    setHistoryIndex(0);
    setEditing(false);
    setRecognizing(false);
    setError("");
    setSaved(false);
  }, [path]);

  useEffect(() => {
    if (!editing) return;
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(text.length, text.length);
  }, [editing]);

  const recognize = async () => {
    setRecognizing(true);
    setError("");
    setSaved(false);
    try {
      const result = await ocrRecognizePath(path, "screenshot");
      const recognized = result.text.trim();
      if (!recognized) {
        setText("");
        setHistory([""]);
        setHistoryIndex(0);
        setError(t("screencap.preview.ocr.noText", "No text was recognized in this screenshot."));
        return;
      }
      setText(recognized);
      setHistory([recognized]);
      setHistoryIndex(0);
      setEditing(false);
      saveCaptureOcrDraft(path, recognized);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRecognizing(false);
    }
  };

  const updateText = (next: string) => {
    const nextHistory = [...history.slice(0, historyIndex + 1), next].slice(-MAX_HISTORY);
    setText(next);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setSaved(false);
  };

  const moveHistory = (nextIndex: number) => {
    const bounded = Math.max(0, Math.min(nextIndex, history.length - 1));
    setHistoryIndex(bounded);
    setText(history[bounded] ?? "");
    setSaved(false);
  };

  const save = () => {
    saveCaptureOcrDraft(path, text);
    setEditing(false);
    setHistory([text]);
    setHistoryIndex(0);
    setSaved(true);
  };

  return (
    <section className="qx-screencap-ocr" aria-label={t("screencap.preview.ocr.title", "Image text recognition")}>
      <header className="qx-screencap-ocr-header">
        <div>
          <strong>{t("screencap.preview.ocr.title", "Image text recognition")}</strong>
          <span>{t("screencap.preview.ocr.description", "Recognize text in the current screenshot")}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={recognizing}
          onClick={() => void recognize()}
        >
          <ScanText size={14} aria-hidden="true" />
          {recognizing
            ? t("ocr.running", "Recognizing…")
            : t("screencap.preview.ocr.recognize", "Recognize text")}
        </Button>
      </header>

      <div className={`qx-screencap-ocr-box${editing ? " is-editing" : ""}`}>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => updateText(event.target.value)}
            aria-label={t("screencap.preview.ocr.editor", "Recognized text editor")}
          />
        ) : (
          <div
            className={`qx-screencap-ocr-text${text ? "" : " is-empty"}`}
            role="textbox"
            aria-readonly="true"
            tabIndex={text ? 0 : -1}
            title={text ? t("screencap.preview.ocr.doubleClick", "Double-click to edit") : undefined}
            onDoubleClick={() => text && setEditing(true)}
          >
            {text || t("screencap.preview.ocr.empty", "Select Recognize text to extract text from this screenshot.")}
          </div>
        )}

        {editing ? (
          <div className="qx-screencap-ocr-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={historyIndex <= 0}
              title={t("common.undo", "Undo")}
              aria-label={t("common.undo", "Undo")}
              onClick={() => moveHistory(historyIndex - 1)}
            >
              <Undo2 size={15} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={historyIndex >= history.length - 1}
              title={t("common.redo", "Redo")}
              aria-label={t("common.redo", "Redo")}
              onClick={() => moveHistory(historyIndex + 1)}
            >
              <Redo2 size={15} aria-hidden="true" />
            </Button>
            <Button type="button" size="sm" onClick={save}>
              <Save size={14} aria-hidden="true" />
              {t("common.save", "Save")}
            </Button>
          </div>
        ) : text ? (
          <span className="qx-screencap-ocr-hint">
            {saved
              ? t("screencap.preview.ocr.saved", "Saved")
              : t("screencap.preview.ocr.doubleClick", "Double-click to edit")}
          </span>
        ) : null}
      </div>

      {error ? <p className="qx-screencap-ocr-error">{error}</p> : null}
    </section>
  );
}

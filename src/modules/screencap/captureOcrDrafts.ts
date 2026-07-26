const STORAGE_KEY = "qx.screencap.ocr-drafts.v1";
const MAX_DRAFTS = 50;

interface CaptureOcrDraft {
  path: string;
  text: string;
  updatedAt: number;
}

function readAll(): CaptureOcrDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CaptureOcrDraft => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Partial<CaptureOcrDraft>;
      return typeof value.path === "string"
        && typeof value.text === "string"
        && typeof value.updatedAt === "number";
    });
  } catch {
    return [];
  }
}

export function readCaptureOcrDraft(path: string): string | null {
  return readAll().find((entry) => entry.path === path)?.text ?? null;
}

export function saveCaptureOcrDraft(path: string, text: string): void {
  const next = [
    { path, text, updatedAt: Date.now() },
    ...readAll().filter((entry) => entry.path !== path),
  ]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // OCR recognition remains usable when browser storage is unavailable.
  }
}

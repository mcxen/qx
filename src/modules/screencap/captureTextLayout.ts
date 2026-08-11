export const CAPTURE_TEXT_LINE_HEIGHT = 1.2;
export const CAPTURE_TEXT_HORIZONTAL_PADDING_EM = 0.22;
export const CAPTURE_TEXT_MIN_HORIZONTAL_PADDING = 2;
export const CAPTURE_TEXT_VERTICAL_PADDING = 2;

let textMeasureContext: CanvasRenderingContext2D | null = null;
const glyphWidthCache = new Map<number, Map<string, number>>();

function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!textMeasureContext) {
    textMeasureContext = document.createElement("canvas").getContext("2d");
  }
  return textMeasureContext;
}

export function captureTextPadding(fontSize: number): number {
  return Math.max(CAPTURE_TEXT_MIN_HORIZONTAL_PADDING, fontSize * CAPTURE_TEXT_HORIZONTAL_PADDING_EM);
}

export function shouldCommitCaptureTextChange(
  sessionComposing: boolean,
  eventComposing: boolean,
): boolean {
  return !sessionComposing && !eventComposing;
}

export function shouldFinishCaptureTextEditing(
  key: string,
  shiftKey: boolean,
  eventComposing: boolean,
  legacyKeyCode: number,
  sessionComposing: boolean,
): boolean {
  if (eventComposing || sessionComposing) return false;
  if (key === "Enter") return !shiftKey && legacyKeyCode !== 229;
  return key === "Escape";
}

export function projectCaptureTextCornerScale(
  horizontalDelta: number,
  verticalDelta: number,
  width: number,
  height: number,
): number {
  const denominator = width * width + height * height;
  if (denominator <= 0) return 1;
  return 1 + (
    horizontalDelta * width + verticalDelta * height
  ) / denominator;
}

export function measureCaptureTextWidth(text: string, fontSize: number): number {
  const context = getTextMeasureContext();
  if (!context) return Math.max(1, Array.from(text).length) * fontSize;
  context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  return context.measureText(text || "字").width;
}

function measureCaptureGlyphWidth(character: string, fontSize: number): number {
  let fontCache = glyphWidthCache.get(fontSize);
  if (!fontCache) {
    fontCache = new Map();
    glyphWidthCache.set(fontSize, fontCache);
  }
  const cached = fontCache.get(character);
  if (cached != null) return cached;
  const width = measureCaptureTextWidth(character, fontSize);
  fontCache.set(character, width);
  return width;
}

export function wrapCaptureTextLines(
  text: string,
  fontSize: number,
  maxContentWidth: number,
): string[] {
  const widthLimit = Math.max(1, maxContentWidth);
  const output: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      output.push("");
      continue;
    }
    let line = "";
    let lineWidth = 0;
    for (const character of Array.from(paragraph)) {
      const characterWidth = measureCaptureGlyphWidth(character, fontSize);
      if (line && lineWidth + characterWidth > widthLimit) {
        output.push(line);
        line = character;
        lineWidth = characterWidth;
      } else {
        line += character;
        lineWidth += characterWidth;
      }
    }
    output.push(line);
  }
  return output.length > 0 ? output : [""];
}

export function measureCaptureTextBox(
  text: string,
  fontSize: number,
  minimumWidth: number,
  maximumWidth: number,
): { width: number; height: number; lines: string[] } {
  const padding = captureTextPadding(fontSize);
  const widestExplicitLine = Math.max(
    ...text.split("\n").map((line) => measureCaptureTextWidth(line || "字", fontSize)),
  );
  const width = Math.max(
    Math.min(minimumWidth, maximumWidth),
    Math.min(maximumWidth, widestExplicitLine + padding * 2),
  );
  const lines = wrapCaptureTextLines(text, fontSize, Math.max(1, width - padding * 2));
  const height = Math.max(
    fontSize * CAPTURE_TEXT_LINE_HEIGHT + CAPTURE_TEXT_VERTICAL_PADDING * 2,
    lines.length * fontSize * CAPTURE_TEXT_LINE_HEIGHT + CAPTURE_TEXT_VERTICAL_PADDING * 2,
  );
  return { width, height, lines };
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n";
import {
  CAPTURE_TEXT_EDIT_MAX_SCALE,
  CAPTURE_TEXT_EDIT_READABLE_PX,
  CAPTURE_TEXT_MAX_FONT_SIZE,
  CAPTURE_TEXT_MIN_FONT_SIZE,
  type CaptureAnnotation,
  type Rect,
} from "./useCaptureAnnotations";
import {
  captureTextEditScale,
  measureCaptureTextBox,
  projectCaptureTextCornerScale,
  shouldCommitCaptureTextChange,
  shouldFinishCaptureTextEditing,
} from "./captureTextLayout";

type TextAnnotation = Extract<CaptureAnnotation, { type: "text" }>;
type ResizeCorner = "nw" | "ne" | "se" | "sw";
type ResizeEdge = "n" | "e" | "s" | "w";
type ResizeHandle = ResizeCorner | ResizeEdge;

type TextInteraction =
  | {
      kind: "move";
      id: string;
      startX: number;
      startY: number;
      left: number;
      top: number;
      width: number;
      height: number;
    }
  | {
      kind: "resize";
      id: string;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      left: number;
      top: number;
      width: number;
      height: number;
      fontSize: number;
      text: string;
    };

interface CaptureTextAnnotationsProps {
  selection: Rect;
  annotations: TextAnnotation[];
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<TextAnnotation, "x" | "y" | "w" | "h" | "fontSize" | "text">>,
  ) => void;
  onDelete: (id: string) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Editable text annotations with direct manipulation and proportional corner scaling. */
export function CaptureTextAnnotations({
  selection,
  annotations,
  activeId,
  onActiveChange,
  onUpdate,
  onDelete,
}: CaptureTextAnnotationsProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const composingIdRef = useRef<string | null>(null);
  const annotationsRef = useRef(annotations);
  const interaction = useRef<TextInteraction | null>(null);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  annotationsRef.current = annotations;

  useEffect(() => {
    if (!activeId) {
      setEditingId(null);
      composingIdRef.current = null;
      return;
    }
    const annotation = annotations.find((item) => item.id === activeId);
    if (!annotation) {
      onActiveChange(null);
      setEditingId(null);
      composingIdRef.current = null;
      return;
    }
    if (!annotation.text) setEditingId(activeId);
  }, [activeId, annotations, onActiveChange]);

  useEffect(() => {
    let finishTimer: number | null = null;
    const onDocumentPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      // Let the focused textarea deliver compositionend/blur before selection
      // state can unmount it. Blur owns the final DOM-value commit and empty-box
      // cleanup, so clicking outside cannot discard a just-confirmed candidate.
      finishTimer = window.setTimeout(() => {
        setEditingId(null);
        composingIdRef.current = null;
        onActiveChange(null);
      }, 0);
    };
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => {
      if (finishTimer != null) window.clearTimeout(finishTimer);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    };
  }, [onActiveChange]);

  useEffect(() => {
    if (!interactionId) return undefined;

    let animationFrame: number | null = null;
    let pendingPoint: { x: number; y: number } | null = null;

    const applyPointerMove = (clientX: number, clientY: number) => {
      const current = interaction.current;
      if (!current || current.id !== interactionId) return;

      if (current.kind === "move") {
        const left = clamp(
          current.left + clientX - current.startX,
          0,
          Math.max(0, selection.w - current.width),
        );
        const top = clamp(
          current.top + clientY - current.startY,
          0,
          Math.max(0, selection.h - current.height),
        );
        onUpdate(current.id, {
          x: left / selection.w,
          y: top / selection.h,
        });
        return;
      }

      if (current.handle.length === 1) {
        const layout = measureCaptureTextBox(
          current.text,
          current.fontSize,
          current.width,
          current.width,
        );
        const minimumHeight = Math.min(layout.height, selection.h);
        if (current.handle === "e" || current.handle === "w") {
          const anchorX = current.handle === "w"
            ? current.left + current.width
            : current.left;
          const direction = current.handle === "w" ? -1 : 1;
          const maximumWidth = current.handle === "w"
            ? anchorX
            : selection.w - anchorX;
          const width = clamp(
            current.width + (clientX - current.startX) * direction,
            16,
            Math.max(16, maximumWidth),
          );
          const left = current.handle === "w" ? anchorX - width : anchorX;
          const reflowed = measureCaptureTextBox(
            current.text,
            current.fontSize,
            width,
            width,
          );
          const height = Math.max(current.height, Math.min(reflowed.height, selection.h));
          const top = clamp(current.top, 0, Math.max(0, selection.h - height));
          onUpdate(current.id, {
            x: left / selection.w,
            y: top / selection.h,
            w: width / selection.w,
            h: height / selection.h,
          });
          return;
        }
        const anchorY = current.handle === "n"
          ? current.top + current.height
          : current.top;
        const direction = current.handle === "n" ? -1 : 1;
        const maximumHeight = current.handle === "n"
          ? anchorY
          : selection.h - anchorY;
        const height = clamp(
          current.height + (clientY - current.startY) * direction,
          minimumHeight,
          Math.max(minimumHeight, maximumHeight),
        );
        const top = current.handle === "n" ? anchorY - height : anchorY;
        onUpdate(current.id, {
          y: top / selection.h,
          h: height / selection.h,
        });
        return;
      }

      const horizontalDirection = current.handle.includes("w") ? -1 : 1;
      const verticalDirection = current.handle.includes("n") ? -1 : 1;
      const horizontalDelta = (clientX - current.startX) * horizontalDirection;
      const verticalDelta = (clientY - current.startY) * verticalDirection;
      // A corner is exclusively a proportional scale handle. Project the
      // pointer movement onto the box diagonal so font and frame change as one
      // stable transform instead of switching behavior based on drag angle.
      const anchorX = current.handle.includes("w")
        ? current.left + current.width
        : current.left;
      const anchorY = current.handle.includes("n")
        ? current.top + current.height
        : current.top;
      const maximumHorizontalScale = current.handle.includes("w")
        ? anchorX / current.width
        : (selection.w - anchorX) / current.width;
      const maximumVerticalScale = current.handle.includes("n")
        ? anchorY / current.height
        : (selection.h - anchorY) / current.height;
      const minimumScale = Math.max(
        CAPTURE_TEXT_MIN_FONT_SIZE / current.fontSize,
        16 / current.width,
        18 / current.height,
      );
      const maximumScale = Math.max(
        minimumScale,
        Math.min(
          CAPTURE_TEXT_MAX_FONT_SIZE / current.fontSize,
          maximumHorizontalScale,
          maximumVerticalScale,
        ),
      );
      const scale = clamp(
        projectCaptureTextCornerScale(
          horizontalDelta,
          verticalDelta,
          current.width,
          current.height,
        ),
        minimumScale,
        maximumScale,
      );
      const width = current.width * scale;
      const height = current.height * scale;
      const left = current.handle.includes("w") ? anchorX - width : anchorX;
      const top = current.handle.includes("n") ? anchorY - height : anchorY;
      onUpdate(current.id, {
        x: left / selection.w,
        y: top / selection.h,
        w: width / selection.w,
        h: height / selection.h,
        fontSize: current.fontSize * scale,
      });
    };

    const flushPendingPoint = () => {
      animationFrame = null;
      const point = pendingPoint;
      pendingPoint = null;
      if (point) applyPointerMove(point.x, point.y);
    };

    const onWindowPointerMove = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      pendingPoint = { x: event.clientX, y: event.clientY };
      if (animationFrame == null) {
        animationFrame = window.requestAnimationFrame(flushPendingPoint);
      }
    };

    const finishInteraction = () => {
      if (animationFrame != null) {
        window.cancelAnimationFrame(animationFrame);
        flushPendingPoint();
      }
      interaction.current = null;
      setInteractionId(null);
    };
    window.addEventListener("pointermove", onWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", finishInteraction, { once: true });
    window.addEventListener("pointercancel", finishInteraction, { once: true });
    return () => {
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", finishInteraction);
      window.removeEventListener("pointercancel", finishInteraction);
    };
  }, [interactionId, onUpdate, selection.h, selection.w]);

  const finishEditing = (id: string, text: string) => {
    setEditingId(null);
    composingIdRef.current = null;
    if (!text.trim()) {
      onDelete(id);
      onActiveChange(null);
    }
  };

  const layoutText = useCallback((id: string, rawText: string, persistText = true) => {
    const annotation = annotationsRef.current.find((item) => item.id === id);
    if (!annotation) return "";
    const text = rawText.replace(/\r/g, "");
    const maximumWidth = Math.max(1, selection.w - annotation.x * selection.w);
    // Flameshot-style floor so the frame does not collapse to one glyph while typing.
    const preferredMin = Math.min(
      maximumWidth,
      Math.max(
        annotation.w * selection.w,
        annotation.fontSize * 0.62 * 4 + Math.max(4, annotation.fontSize * 0.44),
      ),
    );
    const layout = measureCaptureTextBox(
      text,
      annotation.fontSize,
      preferredMin,
      maximumWidth,
    );
    const height = Math.min(layout.height, selection.h);
    const currentTop = annotation.y * selection.h;
    const top = clamp(currentTop, 0, Math.max(0, selection.h - height));
    onUpdate(id, {
      ...(persistText ? { text } : {}),
      w: layout.width / selection.w,
      h: height / selection.h,
      y: top / selection.h,
    });
    return text;
  }, [onUpdate, selection.h, selection.w]);

  const beginMove = (event: PointerEvent<HTMLDivElement>, annotation: TextAnnotation) => {
    const target = event.target as HTMLElement;
    if (target.closest("textarea, button, .qx-region-picker-text-resize, .qx-region-picker-text-editor")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setEditingId(null);
    onActiveChange(annotation.id);
    interaction.current = {
      kind: "move",
      id: annotation.id,
      startX: event.clientX,
      startY: event.clientY,
      left: annotation.x * selection.w,
      top: annotation.y * selection.h,
      width: annotation.w * selection.w,
      height: annotation.h * selection.h,
    };
    setInteractionId(annotation.id);
  };

  const beginResize = (
    event: PointerEvent<HTMLButtonElement>,
    annotation: TextAnnotation,
    handle: ResizeHandle,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setEditingId(null);
    onActiveChange(annotation.id);
    interaction.current = {
      kind: "resize",
      id: annotation.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      left: annotation.x * selection.w,
      top: annotation.y * selection.h,
      width: annotation.w * selection.w,
      height: annotation.h * selection.h,
      fontSize: annotation.fontSize,
      text: annotation.text,
    };
    setInteractionId(annotation.id);
  };

  return (
    <div
      ref={rootRef}
      className="qx-region-picker-text-annotations"
      aria-label={t("screencap.picker.textAnnotations", "Text annotations")}
    >
      {annotations.map((annotation) => {
        const selected = activeId === annotation.id;
        const editing = editingId === annotation.id;
        const realWidth = annotation.w * selection.w;
        const realHeight = annotation.h * selection.h;
        const realLeft = annotation.x * selection.w;
        const realTop = annotation.y * selection.h;
        const editScale = editing
          ? captureTextEditScale(
            annotation.fontSize,
            CAPTURE_TEXT_EDIT_READABLE_PX,
            CAPTURE_TEXT_EDIT_MAX_SCALE,
          )
          : 1;
        const magnified = editing && editScale > 1.01;
        const displayFont = annotation.fontSize * editScale;
        const maxDisplayWidth = Math.max(1, selection.w - realLeft);
        const displayPreferredMin = Math.min(
          maxDisplayWidth,
          Math.max(
            realWidth * editScale,
            displayFont * 0.62 * 6 + Math.max(4, displayFont * 0.44),
          ),
        );
        const displayLayout = magnified
          ? measureCaptureTextBox(
            annotation.text,
            displayFont,
            displayPreferredMin,
            maxDisplayWidth,
          )
          : { width: realWidth, height: realHeight, lines: [] as string[] };
        const displayWidth = magnified
          ? Math.min(displayLayout.width, maxDisplayWidth)
          : realWidth;
        const displayHeight = magnified
          ? Math.min(displayLayout.height, Math.max(realHeight, selection.h - realTop))
          : realHeight;
        const spaceBelow = selection.h - realTop - realHeight;
        const placeMagnifierBelow = !magnified || spaceBelow >= displayHeight + 10
          || realTop < displayHeight + 10;

        const bindTextarea = {
          defaultValue: annotation.text,
          "aria-label": t("screencap.picker.editText", "Edit annotation text"),
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
            const shouldPersist = shouldCommitCaptureTextChange(
              composingIdRef.current === annotation.id,
              (event.nativeEvent as InputEvent).isComposing,
            );
            // Native IME preedit remains visible in the uncontrolled
            // textarea. It participates in frame measurement without
            // entering the persisted annotation until compositionend.
            layoutText(annotation.id, event.currentTarget.value, shouldPersist);
          },
          onCompositionStart: () => {
            composingIdRef.current = annotation.id;
          },
          onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
            composingIdRef.current = null;
            layoutText(annotation.id, event.currentTarget.value);
          },
          onBlur: (event: FocusEvent<HTMLTextAreaElement>) => {
            const text = layoutText(annotation.id, event.currentTarget.value);
            finishEditing(annotation.id, text);
          },
          onPointerDown: (event: PointerEvent<HTMLTextAreaElement>) => {
            event.stopPropagation();
          },
          onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
            event.stopPropagation();
            const nativeEvent = event.nativeEvent;
            if (shouldFinishCaptureTextEditing(
              event.key,
              event.shiftKey,
              nativeEvent.isComposing,
              nativeEvent.keyCode,
              composingIdRef.current === annotation.id,
            )) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          },
          style: { color: annotation.color },
        };

        return (
          <div
            key={annotation.id}
            className={[
              "qx-region-picker-text-box",
              selected ? "is-selected" : "",
              editing ? "is-editing" : "",
              magnified ? "is-magnified" : "",
              interactionId === annotation.id ? "is-interacting" : "",
            ].filter(Boolean).join(" ")}
            style={{
              left: realLeft,
              top: realTop,
              width: realWidth,
              height: realHeight,
              fontSize: annotation.fontSize,
            }}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key !== "Backspace" && event.key !== "Delete") return;
              if ((event.target as HTMLElement).closest("textarea")) return;
              event.preventDefault();
              event.stopPropagation();
              onDelete(annotation.id);
              onActiveChange(null);
              setEditingId(null);
            }}
            onPointerDown={(event) => beginMove(event, annotation)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onActiveChange(annotation.id);
              setEditingId(annotation.id);
            }}
          >
            {selected && !editing && (
              <>
                <button
                  type="button"
                  className="qx-region-picker-text-delete"
                  aria-label={t("screencap.picker.deleteText", "Delete text annotation")}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(annotation.id);
                    onActiveChange(null);
                    setEditingId(null);
                  }}
                >
                  <X size={12} strokeWidth={2.4} aria-hidden="true" />
                </button>
                {(["nw", "ne", "se", "sw"] as const).map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    className={`qx-region-picker-text-resize is-${corner}`}
                    aria-label={t("screencap.picker.resizeText", "Resize text annotation")}
                    onPointerDown={(event) => beginResize(event, annotation, corner)}
                  />
                ))}
                {(["n", "e", "s", "w"] as const).map((edge) => (
                  <button
                    key={edge}
                    type="button"
                    className={`qx-region-picker-text-edge is-${edge}`}
                    aria-label={t("screencap.picker.resizeTextEdge", "Resize text box edge")}
                    onPointerDown={(event) => beginResize(event, annotation, edge)}
                  />
                ))}
              </>
            )}
            {editing ? (
              magnified ? (
                <>
                  <span
                    className="qx-region-picker-text-ghost"
                    style={{ color: annotation.color }}
                    aria-hidden="true"
                  >
                    {annotation.text || "\u00a0"}
                  </span>
                  <div
                    className={`qx-region-picker-text-editor is-magnified-panel${placeMagnifierBelow ? " is-below" : " is-above"}`}
                    style={{
                      width: displayWidth,
                      height: displayHeight,
                      fontSize: displayFont,
                      color: annotation.color,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <div className="qx-region-picker-text-editor-label">
                      {t("screencap.picker.textEditMagnifier", "Editing · auto-zoomed")}
                    </div>
                    <textarea
                      autoFocus
                      placeholder={t("screencap.picker.textPrompt", "Type annotation text")}
                      {...bindTextarea}
                    />
                  </div>
                </>
              ) : (
                <textarea
                  autoFocus
                  placeholder={t("screencap.picker.textPrompt", "Type annotation text")}
                  {...bindTextarea}
                />
              )
            ) : (
              <span
                style={{ color: annotation.color }}
                role="button"
                tabIndex={-1}
                aria-label={t("screencap.picker.moveOrEditText", "Move or edit annotation text")}
              >
                {annotation.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

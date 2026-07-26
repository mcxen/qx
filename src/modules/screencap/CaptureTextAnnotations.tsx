import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useT } from "../../i18n";
import type { CaptureAnnotation, Rect } from "./useCaptureAnnotations";

type TextAnnotation = Extract<CaptureAnnotation, { type: "text" }>;

interface CaptureTextAnnotationsProps {
  selection: Rect;
  annotations: TextAnnotation[];
  onUpdate: (id: string, patch: Partial<Pick<TextAnnotation, "x" | "y" | "text">>) => void;
  onDelete: (id: string) => void;
}

/** Transparent, editable text boxes that remain movable after placement. */
export function CaptureTextAnnotations({ selection, annotations, onUpdate, onDelete }: CaptureTextAnnotationsProps) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, annotation: TextAnnotation) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    drag.current = { id: annotation.id, x: event.clientX, y: event.clientY, originX: annotation.x, originY: annotation.y, moved: false };
    setSelectedId(annotation.id);
    setDraggingId(annotation.id);
  };

  useEffect(() => {
    if (!draggingId) return undefined;
    const onWindowPointerMove = (event: globalThis.PointerEvent) => {
      const current = drag.current;
      if (!current || current.id !== draggingId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) > 3) current.moved = true;
      if (!current.moved) return;
      event.preventDefault();
      onUpdate(current.id, {
        x: Math.max(0, Math.min(1, current.originX + dx / selection.w)),
        y: Math.max(0.04, Math.min(1, current.originY + dy / selection.h)),
      });
    };
    const finishDrag = () => {
      const current = drag.current;
      drag.current = null;
      setDraggingId(null);
      if (current && !current.moved) setSelectedId(current.id);
    };
    window.addEventListener("pointermove", onWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", finishDrag, { once: true });
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [draggingId, onUpdate, selection.h, selection.w]);

  return (
    <div className="qx-region-picker-text-annotations" aria-label={t("screencap.picker.textAnnotations", "Text annotations")}>
      {annotations.map((annotation) => (
        <div
          key={annotation.id}
          className={`qx-region-picker-text-box${selectedId === annotation.id ? " is-selected" : ""}${editingId === annotation.id ? " is-editing" : ""}`}
          style={{ left: annotation.x * selection.w, top: annotation.y * selection.h }}
          tabIndex={selectedId === annotation.id ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key !== "Backspace" && event.key !== "Delete") return;
            event.preventDefault();
            event.stopPropagation();
            onDelete(annotation.id);
            setSelectedId(null);
            setEditingId(null);
          }}
          onPointerDown={(event) => onPointerDown(event, annotation)}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setEditingId(annotation.id);
          }}
        >
          {selectedId === annotation.id && editingId !== annotation.id && (
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
                setSelectedId(null);
              }}
            >
              ×
            </button>
          )}
          {editingId === annotation.id ? (
            <textarea
              autoFocus
              value={annotation.text}
              aria-label={t("screencap.picker.editText", "Edit annotation text")}
              onChange={(event) => onUpdate(annotation.id, { text: event.target.value })}
              onBlur={() => setEditingId(null)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Backspace" || event.key === "Delete") event.stopPropagation();
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  setEditingId(null);
                }
                if (event.key === "Escape") setEditingId(null);
              }}
              style={{ color: annotation.color }}
            />
          ) : (
            <span
              style={{ color: annotation.color }}
              role="button"
              tabIndex={0}
              aria-label={t("screencap.picker.moveOrEditText", "Move or edit annotation text")}
            >
              {annotation.text}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

import { useRef, useState, type PointerEvent } from "react";
import { useT } from "../../i18n";
import type { CaptureAnnotation, Rect } from "./useCaptureAnnotations";

type TextAnnotation = Extract<CaptureAnnotation, { type: "text" }>;

interface CaptureTextAnnotationsProps {
  selection: Rect;
  annotations: TextAnnotation[];
  onUpdate: (id: string, patch: Partial<Pick<TextAnnotation, "x" | "y" | "text">>) => void;
}

/** Transparent, editable text boxes that remain movable after placement. */
export function CaptureTextAnnotations({ selection, annotations, onUpdate }: CaptureTextAnnotationsProps) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, annotation: TextAnnotation) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { id: annotation.id, x: event.clientX, y: event.clientY, originX: annotation.x, originY: annotation.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) > 3) current.moved = true;
    if (!current.moved) return;
    onUpdate(current.id, {
      x: Math.max(0, Math.min(1, current.originX + dx / selection.w)),
      y: Math.max(0.04, Math.min(1, current.originY + dy / selection.h)),
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    drag.current = null;
    if (current && !current.moved) setEditingId(current.id);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="qx-region-picker-text-annotations" aria-label="Text annotations">
      {annotations.map((annotation) => (
        <div
          key={annotation.id}
          className={`qx-region-picker-text-box${editingId === annotation.id ? " is-editing" : ""}`}
          style={{ left: annotation.x * selection.w, top: annotation.y * selection.h }}
        >
          {editingId === annotation.id ? (
            <input
              autoFocus
              value={annotation.text}
              aria-label={t("screencap.picker.editText", "Edit annotation text")}
              onChange={(event) => onUpdate(annotation.id, { text: event.target.value })}
              onBlur={() => setEditingId(null)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") setEditingId(null);
                if (event.key === "Escape") setEditingId(null);
              }}
            />
          ) : (
            <button
              type="button"
              style={{ color: annotation.color }}
              onPointerDown={(event) => onPointerDown(event, annotation)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              aria-label={t("screencap.picker.moveOrEditText", "Move or edit annotation text")}
            >
              {annotation.text}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

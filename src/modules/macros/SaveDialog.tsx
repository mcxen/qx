import { useT } from "../../i18n";

interface SaveDialogProps {
  stepCount: number;
  name: string;
  setName: (v: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}

export default function SaveDialog({
  stepCount,
  name,
  setName,
  onSave,
  onDiscard,
}: SaveDialogProps) {
  const t = useT();
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      e.preventDefault();
      e.stopPropagation();
      onSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDiscard();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        maxWidth: 360,
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--qx-text-tertiary)",
          textAlign: "center",
        }}
      >
        {t("macros.stepsCaptured", "{n} steps captured").replace("{n}", String(stepCount))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="qx-inline-input"
          style={{ flex: 1 }}
          placeholder={t("macros.namePlaceholder", "Macro name…")}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="qx-command-button primary"
          onClick={onSave}
          disabled={!name.trim()}
        >
          {t("macros.save", "Save macro")}
        </button>
        <button className="qx-command-button" onClick={onDiscard}>
          {t("macros.discard", "Discard")}
        </button>
      </div>
    </div>
  );
}

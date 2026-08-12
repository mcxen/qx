import { Check, Copy, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";

/** Jan-style local date under each message (short month + time). */
export function formatQxAiMessageDate(timestamp: number | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface QxAiMessageActionsProps {
  role: "user" | "assistant" | "system";
  timestamp?: number;
  copied?: boolean;
  disabled?: boolean;
  /** Show regenerate on the last completed assistant turn (Jan). */
  canRegenerate?: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRegenerate?: () => void;
}

/**
 * Jan MessageItem footer: date + copy / edit / delete (+ regenerate for last assistant).
 * User: hover/focus reveal, right-aligned.
 * Assistant: date always visible; action icons reveal on hover/focus.
 */
export function QxAiMessageActions({
  role,
  timestamp,
  copied = false,
  disabled = false,
  canRegenerate = false,
  onCopy,
  onEdit,
  onDelete,
  onRegenerate,
}: QxAiMessageActionsProps) {
  const t = useT();
  const date = formatQxAiMessageDate(timestamp);
  if (role === "system") return null;

  return (
    <div
      className={`qx-jan-message-actions is-${role}`}
      data-qx-ai="message-actions"
      data-role={role}
    >
      {date ? (
        <time
          className="qx-jan-message-date"
          dateTime={new Date(timestamp ?? 0).toISOString()}
        >
          {date}
        </time>
      ) : null}
      <div className="qx-jan-message-action-btns">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          title={t(copied ? "qxai.message.copied" : "qxai.message.copy", copied ? "Copied" : "Copy")}
          aria-label={t(
            copied ? "qxai.message.copied" : "qxai.message.copy",
            copied ? "Copied" : "Copy",
          )}
          onClick={onCopy}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          title={t("qxai.message.edit", "Edit message")}
          aria-label={t("qxai.message.edit", "Edit message")}
          onClick={onEdit}
        >
          <Pencil size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          title={t("qxai.message.delete", "Delete message")}
          aria-label={t("qxai.message.delete", "Delete message")}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </Button>
        {role === "assistant" && canRegenerate && onRegenerate ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            title={t("qxai.message.regenerate", "Regenerate")}
            aria-label={t("qxai.message.regenerate", "Regenerate")}
            onClick={onRegenerate}
          >
            <RefreshCw size={14} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

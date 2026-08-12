import type { HTMLAttributes, RefObject } from "react";
import { Loader2 } from "lucide-react";
import { QxListLoading, shouldShowQxListLoading } from "../../components/QxListLoading";
import { qxRegionProps, type QxMasterDetailIds } from "../../hooks/useQxMasterDetail";
import { useT } from "../../i18n";
import type { G4fConversation, QxAiConversationRun } from "./store";

interface QxAiConversationListProps {
  listRef: RefObject<HTMLDivElement | null>;
  regionIds: QxMasterDetailIds;
  conversations: G4fConversation[];
  runs: Record<string, QxAiConversationRun>;
  selectedId: string | null;
  loading: boolean;
  listQuery: string;
  getItemProps: (index: number) => HTMLAttributes<HTMLButtonElement>;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  hasActiveConversation: boolean;
}

export default function QxAiConversationList({
  listRef,
  regionIds,
  conversations,
  runs,
  selectedId,
  loading,
  listQuery,
  getItemProps,
  onSelect,
  onOpen,
  hasActiveConversation,
}: QxAiConversationListProps) {
  const t = useT();

  return (
    <div
      ref={listRef}
      className="qx-content-list qx-plugin-list qx-ai-conversation-list"
      role="listbox"
      aria-label={t("qxai.conversations", "Conversations")}
      {...qxRegionProps(regionIds.list, {
        label: t("qxai.conversations", "Conversations"),
        initial: !hasActiveConversation,
        scroll: true,
      })}
    >
      <div className="qx-section-header">
        <span style={{ flex: 1 }}>{t("qxai.conversations", "Conversations")}</span>
        <span>{conversations.length}</span>
      </div>
      {shouldShowQxListLoading(loading, conversations.length) && (
        <QxListLoading
          ariaLabel={t("qxai.loadingProviders", "Loading providers…")}
          label={t("qxai.loadingProviders", "Loading providers…")}
          rows={5}
          showMeta={false}
          showIcon={false}
        />
      )}
      {conversations.map((item, index) => (
        <button
          key={item.id}
          type="button"
          {...getItemProps(index)}
          aria-selected={item.id === selectedId}
          onClick={() => onSelect(item.id)}
          onDoubleClick={() => onOpen(item.id)}
        >
          <span className="qx-list-copy">
            <span className="qx-list-title">
              {item.name}
              {runs[item.id]?.streaming ? (
                <Loader2
                  size={13}
                  className="qx-spin"
                  aria-label={t("qxai.background.active", "Running in background")}
                />
              ) : null}
            </span>
            <span className="qx-list-subtitle">
              {item.provider} · {item.model}
            </span>
          </span>
        </button>
      ))}
      {conversations.length === 0 && !loading && (
        <div className="qx-empty-state">
          {listQuery.trim()
            ? t("qxai.noMatch", "No matching conversations.")
            : t(
                "qxai.emptyList",
                "No conversations yet. Use New Chat in the bottom bar.",
              )}
        </div>
      )}
    </div>
  );
}

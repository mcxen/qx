import { useMemo, useRef } from "react";
import { useQxListSelection } from "../hooks/useQxListSelection";
import type {
  PluginWorkbenchDetail,
  PluginWorkbenchField,
  PluginWorkbenchState,
} from "./workbenchTypes";
import { useT } from "../i18n";

interface PluginWorkbenchViewProps {
  state: PluginWorkbenchState;
  onSelect: (id: string) => void;
}

function toneClass(tone: string | undefined): string {
  return tone && tone !== "neutral" ? ` tone-${tone}` : "";
}

function WorkbenchFields({ fields }: { fields?: PluginWorkbenchField[] }) {
  if (!fields?.length) return null;
  return (
    <dl className="qx-host-workbench-fields">
      {fields.map((field, index) => (
        <div key={`${field.label}-${index}`} className={toneClass(field.tone)}>
          <dt>{field.label}</dt>
          <dd>{field.value == null || field.value === "" ? "—" : String(field.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function WorkbenchDetail({ detail, emptyText }: { detail?: PluginWorkbenchDetail; emptyText: string }) {
  if (!detail) {
    return <div className="qx-content-detail-empty">{emptyText}</div>;
  }
  return (
    <div className="qx-content-detail-scroll" data-qx-region-scroll>
      {detail.title ? <h2 className="qx-content-detail-heading">{detail.title}</h2> : null}
      {detail.subtitle ? <div className="qx-content-detail-meta">{detail.subtitle}</div> : null}
      {detail.body ? <p className="qx-host-workbench-body">{detail.body}</p> : null}
      <WorkbenchFields fields={detail.fields} />
      {detail.sections?.map((section, index) => (
        <section className="qx-host-workbench-section" key={`${section.title || "section"}-${index}`}>
          {section.title ? <h3>{section.title}</h3> : null}
          {section.body ? <p>{section.body}</p> : null}
          <WorkbenchFields fields={section.fields} />
        </section>
      ))}
    </div>
  );
}

export default function PluginWorkbenchView({ state, onSelect }: PluginWorkbenchViewProps) {
  const t = useT();
  const items = state.items || [];
  const selectedIndex = useMemo(() => {
    if (!items.length) return -1;
    const index = items.findIndex((item) => String(item.id ?? item.title) === String(state.selectedId ?? ""));
    return index >= 0 ? index : 0;
  }, [items, state.selectedId]);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const listRef = useRef<HTMLDivElement>(null);
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: `${state.query || ""}:${items.map((item) => item.id ?? item.title).join("\0")}`,
    enabled: selectedIndex >= 0,
  });
  const detail = selected?.detail || state.detail;

  return (
    <div className="qx-host-workbench" aria-busy={state.loading || undefined}>
      {(state.meta || state.error) && (
        <div className="qx-host-workbench-status">
          {state.meta ? <span>{state.meta}</span> : null}
          {state.error ? <span className="is-danger">{state.error}</span> : null}
        </div>
      )}
      <div className="qx-content-split qx-host-workbench-split">
        <div
          ref={listRef}
          className="qx-content-list qx-plugin-list"
          role="listbox"
          tabIndex={0}
          data-qx-region="plugin-workbench-list"
          data-qx-region-initial="true"
        >
          {items.length ? items.map((item, index) => {
            const id = String(item.id ?? item.title);
            return (
              <button
                key={id}
                type="button"
                {...getItemProps(index, { className: "tall qx-host-workbench-row" })}
                onClick={() => onSelect(id)}
              >
                <span className="qx-host-workbench-icon" aria-hidden="true">{item.icon || "•"}</span>
                <span className="qx-list-main">
                  <strong className="qx-list-title">{item.title}</strong>
                  {item.subtitle ? <small>{item.subtitle}</small> : null}
                  {item.progress != null ? (
                    <span className="qx-host-workbench-progress" aria-label={`${Math.round(item.progress)}%`}>
                      <i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                    </span>
                  ) : null}
                </span>
                {(item.badge || item.meta) ? (
                  <span className={`qx-host-workbench-badge${toneClass(item.tone)}`}>
                    {item.badge || item.meta}
                  </span>
                ) : <span />}
              </button>
            );
          }) : (
            <div className="qx-content-detail-empty">
              {state.emptyText || (state.loading
                ? t("plugins.workbench.loading", "Loading…")
                : t("plugins.workbench.empty", "No results"))}
            </div>
          )}
        </div>
        <section
          className="qx-content-detail qx-plugin-detail"
          tabIndex={0}
          data-qx-region="plugin-workbench-detail"
        >
          <WorkbenchDetail
            detail={detail}
            emptyText={t("plugins.workbench.select", "Select an item")}
          />
        </section>
      </div>
    </div>
  );
}

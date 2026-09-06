import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import QxResizableSplit from "../components/QxResizableSplit";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  Textarea,
} from "../components/ui";
import type {
  PluginWorkbenchControl,
  PluginWorkbenchDetail,
  PluginWorkbenchField,
  PluginWorkbenchImage,
  PluginWorkbenchChart,
  PluginWorkbenchInlineContent,
  PluginWorkbenchReplyContent,
  PluginWorkbenchState,
  PluginWorkbenchEditEvent,
  PluginWorkbenchEditResult,
  PluginWorkbenchItem,
} from "./workbenchTypes";
import { useT } from "../i18n";
import { qxMasterDetailIds, qxRegionProps } from "../hooks/useQxMasterDetail";
import QxReplyList from "../components/QxReplyList";
import QxMediaViewer, { type QxMediaViewerImage } from "../components/QxMediaViewer";
import { resolvePluginAssetUrl } from "./pluginRuntimeTransport";
import {
  useWorkbenchReadingPosition,
  workbenchReadingPositionKey,
} from "./useWorkbenchReadingPosition";
import PluginWorkbenchCollection from "./PluginWorkbenchCollection";
import {
  WorkbenchCachedImage,
  WorkbenchStatus,
  resolveWorkbenchImageUrl,
  workbenchToneClass,
} from "./PluginWorkbenchPrimitives";
import { resolveWorkbenchDetailMetadata } from "./workbenchDetailMetadata";
import { useWorkbenchEditSession } from "./workbenchEditSession";
import PluginWorkbenchInlineEditor from "./PluginWorkbenchInlineEditor";

export const PLUGIN_WORKBENCH_REGIONS = qxMasterDetailIds("plugin-workbench");

const WORKBENCH_LIST_WIDTH_KEY = "qx:workbench:list-width";

interface PluginWorkbenchViewProps {
  pluginId: string;
  state: PluginWorkbenchState;
  detailOpen: boolean;
  onActivate: (id: string) => void;
  onSelect?: (id: string) => void;
  onInput: (id: string, value: string) => void;
  onAction: (id: string) => void;
  onDownload: (id: string) => void;
  onEdit?: (event: PluginWorkbenchEditEvent) => Promise<PluginWorkbenchEditResult>;
  onOpenLink?: (url: string) => void;
  /** Host navigation guard; null unregisters the active editor session. */
  registerNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void;
}

function WorkbenchInlineAsset({
  pluginId,
  part,
}: {
  pluginId: string;
  part: Extract<PluginWorkbenchInlineContent, { type: "asset-image" }>;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl(undefined);
    setFailed(false);
    void resolvePluginAssetUrl(pluginId, part.assetPath).then((resolved) => {
      if (!active) return;
      if (resolved) setUrl(resolved);
      else setFailed(true);
    });
    return () => { active = false; };
  }, [part.assetPath, pluginId]);
  if (!url || failed) return <span>{part.alt || ""}</span>;
  return (
    <img
      className="qx-reply-inline-asset"
      src={url}
      alt={part.alt || ""}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function WorkbenchInlineRemoteImage({
  pluginId,
  image,
}: {
  pluginId: string;
  image: PluginWorkbenchImage;
}) {
  return (
    <WorkbenchCachedImage
      pluginId={pluginId}
      className="qx-reply-inline-asset"
      url={image.url}
      alt={image.alt || ""}
      loading="lazy"
    />
  );
}

function WorkbenchReplyBody({
  pluginId,
  body,
  content,
}: {
  pluginId: string;
  body: string;
  content?: PluginWorkbenchReplyContent[];
}) {
  if (!content?.length) return body;
  return content.map((part, index) => {
    if (part.type === "text") return <span key={`text-${index}`}>{part.text}</span>;
    if (part.type === "asset-image") {
      return <WorkbenchInlineAsset key={`${part.assetPath}-${index}`} pluginId={pluginId} part={part} />;
    }
    return <WorkbenchInlineRemoteImage key={`${part.image.url}-${index}`} pluginId={pluginId} image={part.image} />;
  });
}

function WorkbenchInlineTextContent({
  pluginId,
  content,
}: {
  pluginId: string;
  content: Array<Exclude<PluginWorkbenchInlineContent, { type: "image" }>>;
}) {
  return (
    <p className="qx-host-workbench-body">
      {content.map((part, index) => part.type === "text" ? (
        <span key={`text-${index}`}>{part.text}</span>
      ) : (
        <WorkbenchInlineAsset key={`${part.assetPath}-${index}`} pluginId={pluginId} part={part} />
      ))}
    </p>
  );
}

function WorkbenchFields({ fields }: { fields?: PluginWorkbenchField[] }) {
  if (!fields?.length) return null;
  return (
    <dl className="qx-host-workbench-fields">
      {fields.map((field, index) => (
        <div key={`${field.label}-${index}`} className={workbenchToneClass(field.tone)}>
          <dt>{field.label}</dt>
          <dd>{field.value == null || field.value === "" ? "—" : String(field.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function WorkbenchChart({ chart }: { chart?: PluginWorkbenchChart }) {
  if (!chart || chart.type !== "line") return null;
  const points = chart.points
    .filter((point) => Number.isFinite(Number(point.value)))
    .slice(-240)
    .map((point) => ({ ...point, value: Number(point.value) }));
  if (points.length < 2) return null;

  const width = 640;
  const height = 220;
  const left = 12;
  const right = 12;
  const top = 22;
  const bottom = 28;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(Math.abs(max) * 0.001, max - min, 0.01);
  const yMin = min - span * 0.08;
  const yMax = max + span * 0.08;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + (index * plotWidth) / Math.max(1, points.length - 1);
  const y = (value: number) => top + ((yMax - value) * plotHeight) / Math.max(0.01, yMax - yMin);
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = `${left},${height - bottom} ${line} ${width - right},${height - bottom}`;
  const firstLabel = points[0]?.label || "";
  const lastPoint = points[points.length - 1];
  const latestValue = values[values.length - 1];
  const lastLabel = lastPoint?.label || "";
  const latest = chart.value || String(latestValue);
  const ariaLabel = [chart.title, chart.subtitle, chart.valueLabel, latest].filter(Boolean).join(" — ");

  return (
    <section className="qx-host-workbench-chart" aria-label={ariaLabel || "Line chart"}>
      {(chart.title || chart.subtitle || chart.value) ? (
        <header className="qx-host-workbench-chart-header">
          <div>
            {chart.title ? <h3>{chart.title}</h3> : null}
            {chart.subtitle ? <p>{chart.subtitle}</p> : null}
          </div>
          {chart.value ? (
            <div className="qx-host-workbench-chart-value">
              {chart.valueLabel ? <span>{chart.valueLabel}</span> : null}
              <strong>{chart.value}</strong>
            </div>
          ) : null}
        </header>
      ) : null}
      <div className="qx-host-workbench-chart-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel || "Line chart"}>
          {[0, 0.5, 1].map((ratio) => {
            const gridY = top + ratio * plotHeight;
            return (
              <line
                key={ratio}
                x1={left}
                x2={width - right}
                y1={gridY}
                y2={gridY}
                className="qx-host-workbench-chart-grid"
              />
            );
          })}
          <polygon points={area} className="qx-host-workbench-chart-area" />
          <polyline points={line} className="qx-host-workbench-chart-line" />
          <circle
            cx={x(points.length - 1)}
            cy={y(latestValue || 0)}
            r="4"
            className="qx-host-workbench-chart-dot"
          />
          <text x={left} y={height - 8} className="qx-host-workbench-chart-label">{firstLabel}</text>
          <text x={width - right} y={height - 8} textAnchor="end" className="qx-host-workbench-chart-label">{lastLabel}</text>
          {chart.unit ? (
            <text x={width - right} y={top - 7} textAnchor="end" className="qx-host-workbench-chart-unit">{chart.unit}</text>
          ) : null}
        </svg>
      </div>
    </section>
  );
}

function WorkbenchDetailImage({
  pluginId,
  image,
  collection,
  onPreview,
  unavailableText,
  previewText,
}: {
  pluginId: string;
  image: PluginWorkbenchImage;
  collection?: PluginWorkbenchImage[];
  onPreview: (image: PluginWorkbenchImage, collection: PluginWorkbenchImage[]) => void;
  unavailableText: string;
  previewText: string;
}) {
  const [failed, setFailed] = useState(false);
  const content = failed ? (
    <span className="qx-host-workbench-media-error">{unavailableText}</span>
  ) : (
    <WorkbenchCachedImage
      pluginId={pluginId}
      key={image.url}
      url={image.url}
      alt={image.alt || ""}
      style={{ objectFit: image.fit || "contain" }}
      onError={() => setFailed(true)}
    />
  );
  const className = `qx-host-workbench-detail-image aspect-${image.aspectRatio || "auto"}`;
  return (
    <figure className="qx-host-workbench-media">
      {image.zoomable !== false && !failed ? (
        <button
          type="button"
          className={`${className} is-zoomable`}
          onClick={() => onPreview(image, collection?.length ? collection : [image])}
          aria-label={image.alt ? `${previewText}: ${image.alt}` : previewText}
        >
          {content}
          <Maximize2 className="qx-host-workbench-media-expand" size={15} aria-hidden="true" />
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
      {image.caption ? <figcaption>{image.caption}</figcaption> : null}
    </figure>
  );
}

function WorkbenchMediaCollection({
  pluginId,
  images,
  layout,
  onPreview,
  unavailableText,
  previewText,
  previousText,
  nextText,
}: {
  pluginId: string;
  images: PluginWorkbenchImage[];
  layout: "grid" | "horizontal";
  onPreview: (image: PluginWorkbenchImage, collection: PluginWorkbenchImage[]) => void;
  unavailableText: string;
  previewText: string;
  previousText: string;
  nextText: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const horizontal = layout === "horizontal";
  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(images.length - 1, index));
    setActiveIndex(next);
    stripRef.current?.children[next]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!horizontal || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    event.stopPropagation();
    moveTo(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
  };
  return (
    <div className={`qx-host-workbench-media-collection${horizontal ? " is-horizontal" : ""}`}>
      {horizontal && images.length > 1 ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="qx-host-workbench-media-strip-nav is-previous"
          disabled={activeIndex === 0}
          aria-label={previousText}
          onClick={() => moveTo(activeIndex - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
      ) : null}
      <div
        ref={stripRef}
        className={`qx-host-workbench-media-grid${horizontal ? " is-horizontal" : ""}`}
        data-qx-scrollbar-horizontal-lift={horizontal ? 10 : undefined}
        tabIndex={horizontal ? 0 : undefined}
        aria-label={horizontal ? previewText : undefined}
        onKeyDown={onKeyDown}
      >
        {images.map((image, index) => (
          <WorkbenchDetailImage
            key={`${image.url}-${index}`}
            pluginId={pluginId}
            image={image}
            onPreview={(selected) => onPreview(selected, images)}
            unavailableText={unavailableText}
            previewText={previewText}
          />
        ))}
      </div>
      {horizontal && images.length > 1 ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="qx-host-workbench-media-strip-nav is-next"
            disabled={activeIndex === images.length - 1}
            aria-label={nextText}
            onClick={() => moveTo(activeIndex + 1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
          <span className="qx-host-workbench-media-strip-count" aria-live="polite">
            {activeIndex + 1} / {images.length}
          </span>
        </>
      ) : null}
    </div>
  );
}

function WorkbenchDetail({
  pluginId,
  readingKey,
  detail,
  emptyText,
  onInput,
  onAction,
  onPreview,
  unavailableText,
  previewText,
  previousText,
  nextText,
}: {
  pluginId: string;
  readingKey: string;
  detail?: PluginWorkbenchDetail;
  emptyText: string;
  onInput: (id: string, value: string) => void;
  onAction: (id: string) => void;
  onPreview: (image: PluginWorkbenchImage, collection: PluginWorkbenchImage[]) => void;
  unavailableText: string;
  previewText: string;
  previousText: string;
  nextText: string;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  useWorkbenchReadingPosition(detail ? readingKey : null, scrollRef);
  if (!detail) {
    return <div className="qx-content-detail-empty">{emptyText}</div>;
  }
  const controlRows: Array<{
    id: string;
    label?: string;
    action?: NonNullable<PluginWorkbenchControl["group"]>["action"];
    controls: PluginWorkbenchControl[];
    grouped: boolean;
  }> = [];
  for (const control of detail.form?.controls || []) {
    const groupId = control.group?.id;
    const previous = controlRows[controlRows.length - 1];
    if (groupId && previous?.grouped && previous.id === groupId) {
      previous.controls.push(control);
      continue;
    }
    controlRows.push({
      id: groupId || control.id,
      label: control.group?.label,
      action: control.group?.action,
      controls: [control],
      grouped: Boolean(groupId),
    });
  }
  const renderControl = (control: PluginWorkbenchControl) => (
    <label key={control.id}>
      <span>{control.label}</span>
      {control.type === "select" ? (
        control.disabled || !control.options?.length ? (
          <Input value={control.value} disabled aria-label={control.label} />
        ) : (
          <Select
            value={control.value}
            options={control.options}
            ariaLabel={control.label}
            onChange={(value) => onInput(control.id, value)}
          />
        )
      ) : control.type === "textarea" ? (
        <Textarea
          value={control.value}
          rows={control.rows}
          placeholder={control.placeholder}
          disabled={control.disabled}
          onChange={(event) => onInput(control.id, event.currentTarget.value)}
        />
      ) : (
        <Input
          type={control.type === "number" ? "number" : "text"}
          value={control.value}
          placeholder={control.placeholder}
          disabled={control.disabled}
          onChange={(event) => onInput(control.id, event.currentTarget.value)}
        />
      )}
    </label>
  );
  const detailMedia = (
    <>
      {detail.image?.url ? (
        <WorkbenchDetailImage
          key={detail.image.url}
          pluginId={pluginId}
          image={detail.image}
          onPreview={onPreview}
          unavailableText={unavailableText}
          previewText={previewText}
        />
      ) : null}
      {detail.images?.length ? (
        <WorkbenchMediaCollection
          pluginId={pluginId}
          images={detail.images}
          layout={detail.imageLayout || "grid"}
          onPreview={onPreview}
          unavailableText={unavailableText}
          previewText={previewText}
          previousText={previousText}
          nextText={nextText}
        />
      ) : null}
    </>
  );
  const contentImages = detail.content
    ?.flatMap((block) => block.type === "image" ? [block.image] : [])
    || [];
  const inlineTextContent = detail.content?.filter((block): block is Exclude<PluginWorkbenchInlineContent, { type: "image" }> => block.type !== "image") || [];
  const detailContent = detail.content?.length && contentImages.length === 0 ? (
    <div className="qx-host-workbench-content">
      <WorkbenchInlineTextContent pluginId={pluginId} content={inlineTextContent} />
    </div>
  ) : detail.content?.length ? (
    <div className="qx-host-workbench-content">
      {detail.content.map((block, index) => block.type === "text" ? (
        <p className="qx-host-workbench-body" key={`text-${index}`}>{block.text}</p>
      ) : block.type === "asset-image" ? (
        <p className="qx-host-workbench-body qx-host-workbench-inline-body" key={`asset-${block.assetPath}-${index}`}>
          <WorkbenchInlineAsset pluginId={pluginId} part={block} />
        </p>
      ) : (
        <WorkbenchDetailImage
          key={`image-${block.image.url}-${index}`}
          pluginId={pluginId}
          image={block.image}
          collection={contentImages}
          onPreview={onPreview}
          unavailableText={unavailableText}
          previewText={previewText}
        />
      ))}
    </div>
  ) : detail.body ? (
    <p className="qx-host-workbench-body">{detail.body}</p>
  ) : null;
  const detailMetadata = resolveWorkbenchDetailMetadata(detail);
  return (
    <div ref={scrollRef} className="qx-content-detail-scroll" data-qx-region-scroll>
      {detail.mediaPlacement !== "after-body" ? detailMedia : null}
      {detail.title ? <h2 className="qx-content-detail-heading">{detail.title}</h2> : null}
      {detailMetadata.items.length ? (
        <div className="qx-content-detail-meta qx-host-workbench-detail-meta">
          {detailMetadata.items.map((item) => (
            <span key={item.key} className={workbenchToneClass(item.tone).trim() || undefined}>
              {item.text}
            </span>
          ))}
        </div>
      ) : null}
      <WorkbenchStatus status={detail.status} />
      {detail.form ? (
        <section className="qx-host-workbench-form">
          {detail.form.title ? <h3>{detail.form.title}</h3> : null}
          {detail.form.description ? <p>{detail.form.description}</p> : null}
          <div className="qx-host-workbench-form-controls">
            {controlRows.map((row) => row.grouped ? (
              <fieldset className="qx-host-workbench-form-group" key={row.id}>
                <legend className="sr-only">{row.label || row.id}</legend>
                <div className="qx-host-workbench-form-group-header">
                  <span>{row.label || row.id}</span>
                  {row.action ? (
                    <Button
                      type="button"
                      variant={row.action.tone === "danger" ? "destructive" : "outline"}
                      size="sm"
                      disabled={row.action.disabled}
                      onClick={() => onAction(row.action!.id)}
                    >
                      {row.action.label}
                    </Button>
                  ) : null}
                </div>
                <div className="qx-host-workbench-form-group-controls">
                  {row.controls.map(renderControl)}
                </div>
              </fieldset>
            ) : row.controls.map(renderControl))}
          </div>
          {detail.form.actions?.length ? (
            <div className="qx-host-workbench-form-actions">
              {detail.form.actions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant={action.tone === "danger" ? "destructive" : action.primary ? "default" : "outline"}
                  size="sm"
                  disabled={action.disabled}
                  onClick={() => onAction(action.id)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {detailContent}
      {detail.mediaPlacement === "after-body" ? detailMedia : null}
      <WorkbenchChart chart={detail.chart} />
      <WorkbenchFields fields={detailMetadata.fields} />
      {detail.sections?.map((section, index) => (
        <section className="qx-host-workbench-section" key={`${section.title || "section"}-${index}`}>
          {section.title ? <h3>{section.title}</h3> : null}
          {section.body ? <p>{section.body}</p> : null}
          <WorkbenchFields fields={section.fields} />
        </section>
      ))}
      {detail.replies ? (
        <QxReplyList
          title={detail.replies.title || t("plugins.workbench.replies", "Replies")}
          total={detail.replies.total}
          items={detail.replies.items.map((reply) => ({
            id: reply.id,
            floor: reply.floor,
            author: reply.author,
            parentId: reply.parentId,
            depth: reply.depth,
            replyToAuthor: reply.replyToAuthor,
            likeCount: reply.likeCount,
            createdAt: reply.createdAt,
            originalPoster: reply.originalPoster,
            body: (
              <WorkbenchReplyBody
                pluginId={pluginId}
                body={reply.body}
                content={reply.content}
              />
            ),
          }))}
          loading={detail.replies.status?.state === "loading"}
          loadingText={
            detail.replies.status?.label
            || t("plugins.workbench.replies.loading", "Loading replies…")
          }
          error={
            detail.replies.status?.state === "error"
              ? detail.replies.status.error || detail.replies.status.label
              : undefined
          }
          emptyText={
            detail.replies.emptyText
            || t("plugins.workbench.replies.empty", "No replies yet.")
          }
          originalPosterLabel={t("plugins.workbench.replies.op", "OP")}
        />
      ) : null}
    </div>
  );
}

export default function PluginWorkbenchView({
  pluginId,
  state,
  detailOpen,
  onActivate,
  onSelect,
  onInput,
  onAction,
  onDownload,
  onEdit,
  onOpenLink,
  registerNavigationGuard,
}: PluginWorkbenchViewProps) {
  const t = useT();
  const [preview, setPreview] = useState<{
    images: PluginWorkbenchImage[];
    index: number;
  } | null>(null);
  const items = state.items || [];
  const selectedIndex = useMemo(() => {
    if (!items.length) return -1;
    const index = items.findIndex((item) => item.id === String(state.selectedId ?? ""));
    return index >= 0 ? index : 0;
  }, [items, state.selectedId]);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const detail = selected?.detail || state.detail;
  const detailScope = JSON.stringify([
    state.tabs?.find((tab) => tab.active)?.id || "",
    ...(state.filters || []).map((filter) => [filter.id, filter.value]),
  ]);
  const readingKey = workbenchReadingPositionKey(
    pluginId,
    detailScope,
    selected?.id || "__panel__",
  );
  const gallery = state.layout?.kind === "gallery";
  const loadingText = state.emptyText || t("plugins.workbench.loading", "Loading…");
  const activeTabLabel = state.tabs?.find((tab) => tab.active)?.label;
  const listTitle = state.query?.trim()
    ? t("plugins.workbench.searchResults", "Search Results")
    : activeTabLabel || state.title || t("plugins.workbench.items", "Items");
  const densityClass = items.length === 0
    ? " is-empty"
    : items.length <= (state.layout?.columns || 4)
      ? " is-sparse"
      : "";
  const detailOnly = items.length === 0 && Boolean(state.detail);
  type DirtyDecision = "save" | "discard" | "continue";
  const [dirtyPrompt, setDirtyPrompt] = useState<{ title: string } | null>(null);
  const dirtyPromptRef = useRef<{
    promise: Promise<DirtyDecision>;
    resolve: (decision: DirtyDecision) => void;
  } | null>(null);
  const confirmDiscard = useCallback((title: string) => {
    const existing = dirtyPromptRef.current;
    if (existing) return existing.promise;
    let resolveDecision: (decision: DirtyDecision) => void = () => {};
    const promise = new Promise<DirtyDecision>((resolve) => {
      resolveDecision = resolve;
    });
    dirtyPromptRef.current = { promise, resolve: resolveDecision };
    setDirtyPrompt({ title });
    return promise;
  }, []);
  const resolveDirtyPrompt = useCallback((decision: DirtyDecision) => {
    const current = dirtyPromptRef.current;
    if (!current) return;
    dirtyPromptRef.current = null;
    setDirtyPrompt(null);
    current.resolve(decision);
  }, []);
  useEffect(() => () => resolveDirtyPrompt("continue"), [resolveDirtyPrompt]);
  const canEditItem = useCallback((itemId: string) => {
    const editor = state.items?.find((item) => item.id === itemId)?.editor;
    return Boolean(editor && !editor.disabled && !editor.readOnly && onEdit);
  }, [onEdit, state.items]);
  const editSession = useWorkbenchEditSession({
    onEdit,
    confirmDiscard,
    canEditItem,
    messages: {
      inlineUnavailable: t("plugins.workbench.editor.inlineUnavailable", "Inline editing is unavailable."),
      unavailable: t("plugins.workbench.editor.unavailable", "Editing is no longer available for this note."),
      conflict: t("plugins.workbench.editor.conflict", "Conflict — review and retry"),
      saveError: t("plugins.workbench.editor.saveError", "Could not save this note."),
      startError: t("plugins.workbench.editor.error", "Could not edit this note"),
      byteLimit: (limit) => t("plugins.workbench.editor.byteLimit", "Text exceeds the {n} byte limit.").replace("{n}", String(limit)),
    },
  });
  const canNavigate = useCallback(async () => {
    const current = editSession.session;
    if (!current) return true;
    if (current.status === "starting" || current.status === "saving") return false;
    if (current.value !== current.baseline) {
      const decision = await confirmDiscard(current.item.title);
      if (decision === "continue") return false;
      if (decision === "save") return editSession.save();
    }
    return editSession.discard();
  }, [confirmDiscard, editSession]);
  useEffect(() => {
    registerNavigationGuard?.(editSession.session ? canNavigate : null);
  }, [canNavigate, registerNavigationGuard]);
  useEffect(() => () => registerNavigationGuard?.(null), [registerNavigationGuard]);
  const renderCardEditor = state.layout?.kind === "cards" && editSession.session
    ? (item: PluginWorkbenchItem) => item.id === editSession.session?.itemId ? (
        <PluginWorkbenchInlineEditor
          session={editSession.session}
          onInput={editSession.input}
          onSave={editSession.save}
          onCancel={editSession.cancel}
        />
      ) : null
    : undefined;
  const openPreview = (image: PluginWorkbenchImage, collection: PluginWorkbenchImage[]) => {
    const images = collection.length ? collection : [image];
    const index = Math.max(0, images.findIndex((candidate) => candidate === image || candidate.url === image.url));
    void Promise.all(images.map(async (candidate) => ({
      ...candidate,
      url: await resolveWorkbenchImageUrl(pluginId, candidate.url),
    }))).then((resolved) => setPreview({ images: resolved, index }));
  };
  const downloadPreviewImage = useCallback(async (image: QxMediaViewerImage) => {
    const workbenchImage = image as PluginWorkbenchImage;
    if (workbenchImage.downloadId) {
      onDownload(workbenchImage.downloadId);
      return;
    }
    const dataUrl = image.url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is);
    if (dataUrl) {
      await invoke("plugin_system_save_download", {
        filename: image.alt || "qx-image",
        mimeType: dataUrl[1],
        dataBase64: dataUrl[2],
      });
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = image.url;
    anchor.download = image.alt || "qx-image";
    anchor.click();
  }, [onDownload]);

  const collection = (
    <PluginWorkbenchCollection
      pluginId={pluginId}
      state={state}
      selectedIndex={selectedIndex}
      listTitle={listTitle}
      loadingText={loadingText}
      emptyText={state.emptyText || (state.loading
        ? t("plugins.workbench.loading", "Loading…")
        : t("plugins.workbench.empty", "No results"))}
      regionId={PLUGIN_WORKBENCH_REGIONS.list}
      onActivate={onActivate}
      onSelect={onSelect}
      onEdit={state.layout?.kind === "cards" && onEdit
        ? (item) => { void editSession.start(item); }
        : undefined}
      onOpenLink={state.layout?.kind === "cards" ? onOpenLink : undefined}
      editingItemId={editSession.session?.itemId}
      renderEditor={renderCardEditor}
    />
  );

  return (
    <div className="qx-host-workbench" aria-busy={state.loading || undefined}>
      {(state.meta || state.error) && (
        <div className="qx-host-workbench-status">
          {state.meta ? <span>{state.meta}</span> : null}
          {state.error ? <span className="is-danger">{state.error}</span> : null}
        </div>
      )}
      {detailOnly ? (
        <div
          className="qx-content-detail qx-plugin-detail qx-host-workbench-detail-only"
          {...qxRegionProps(PLUGIN_WORKBENCH_REGIONS.detail, {
            initial: true,
            label: t("plugins.workbench.detail", "Detail"),
            scroll: true,
          })}
        >
          <WorkbenchDetail
            pluginId={pluginId}
            readingKey={readingKey}
            detail={state.detail}
            emptyText={t("plugins.workbench.select", "Select an item")}
            onInput={onInput}
            onAction={onAction}
            onPreview={openPreview}
            unavailableText={t("plugins.workbench.imageUnavailable", "Image unavailable")}
            previewText={t("plugins.workbench.imagePreview", "Image Preview")}
            previousText={t("plugins.workbench.previousImage", "Previous image")}
            nextText={t("plugins.workbench.nextImage", "Next image")}
          />
        </div>
      ) : detailOpen ? (
        <QxResizableSplit
          className={`qx-content-split qx-host-workbench-split has-detail${gallery ? " is-gallery" : ""}${densityClass}`}
          storageKey={WORKBENCH_LIST_WIDTH_KEY}
          defaultLeftWidth={null}
          resetLeftWidth={null}
          minLeftWidth={220}
          minRightWidth={320}
          separatorLabel={t("plugins.workbench.resizeList", "Resize list and detail")}
        >
          {collection}
          <div
            className="qx-content-detail qx-plugin-detail"
            {...qxRegionProps(PLUGIN_WORKBENCH_REGIONS.detail, {
              label: t("plugins.workbench.detail", "Detail"),
              scroll: true,
            })}
          >
            <WorkbenchDetail
              pluginId={pluginId}
              readingKey={readingKey}
              detail={detail}
              emptyText={t("plugins.workbench.select", "Select an item")}
              onInput={onInput}
              onAction={onAction}
              onPreview={openPreview}
              unavailableText={t("plugins.workbench.imageUnavailable", "Image unavailable")}
              previewText={t("plugins.workbench.imagePreview", "Image Preview")}
              previousText={t("plugins.workbench.previousImage", "Previous image")}
              nextText={t("plugins.workbench.nextImage", "Next image")}
            />
          </div>
        </QxResizableSplit>
      ) : collection}
      <QxMediaViewer
        open={Boolean(preview)}
        images={preview?.images || []}
        initialIndex={preview?.index || 0}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        onDownload={downloadPreviewImage}
      />
      {dirtyPrompt ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) resolveDirtyPrompt("continue");
          }}
        >
          <DialogContent className="qx-host-workbench-dirty-dialog">
            <DialogHeader>
              <DialogTitle>{t("plugins.workbench.editor.dirty.title", "Unsaved draft")}</DialogTitle>
              <DialogDescription>
                {dirtyPrompt.title} · {t("plugins.workbench.editor.dirty.description", "Save the draft, discard changes, or continue editing?")}
              </DialogDescription>
            </DialogHeader>
            <div className="qx-host-workbench-dirty-actions">
              <Button type="button" variant="default" onClick={() => {
                resolveDirtyPrompt("save");
              }}>
                {t("plugins.workbench.editor.dirty.save", "Save draft")}
              </Button>
              <Button type="button" variant="destructive" onClick={() => {
                resolveDirtyPrompt("discard");
              }}>
                {t("plugins.workbench.editor.dirty.discard", "Discard changes")}
              </Button>
              <Button type="button" variant="outline" onClick={() => {
                resolveDirtyPrompt("continue");
              }}>
                {t("plugins.workbench.editor.dirty.continue", "Continue editing")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

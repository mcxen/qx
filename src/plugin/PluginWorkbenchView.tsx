import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QxListLoading, shouldShowQxListLoading } from "../components/QxListLoading";
import { useQxListSelection } from "../hooks/useQxListSelection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Select,
} from "../components/ui";
import type {
  PluginWorkbenchAsyncStatus,
  PluginWorkbenchControl,
  PluginWorkbenchDetail,
  PluginWorkbenchField,
  PluginWorkbenchImage,
  PluginWorkbenchState,
} from "./workbenchTypes";
import { useT } from "../i18n";
import { qxMasterDetailIds, qxRegionProps } from "../hooks/useQxMasterDetail";
import QxReplyList from "../components/QxReplyList";

export const PLUGIN_WORKBENCH_REGIONS = qxMasterDetailIds("plugin-workbench");

const WORKBENCH_LIST_WIDTH_KEY = "qx:workbench:list-width";
const DEFAULT_WORKBENCH_LIST_WIDTH = 420;

function clampWorkbenchListWidth(value: number, splitWidth: number): number {
  return Math.round(Math.max(220, Math.min(Math.max(220, splitWidth - 328), value)));
}

function readWorkbenchListWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = Number(window.localStorage.getItem(WORKBENCH_LIST_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function persistWorkbenchListWidth(value: number | null): void {
  try {
    if (value == null) window.localStorage.removeItem(WORKBENCH_LIST_WIDTH_KEY);
    else window.localStorage.setItem(WORKBENCH_LIST_WIDTH_KEY, String(value));
  } catch {
    // Resizing remains available when a private WebView blocks persistence.
  }
}

interface PluginWorkbenchViewProps {
  state: PluginWorkbenchState;
  detailOpen: boolean;
  onActivate: (id: string) => void;
  onInput: (id: string, value: string) => void;
  onAction: (id: string) => void;
  onDownload: (id: string) => void;
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

function WorkbenchStatus({ status }: { status?: PluginWorkbenchAsyncStatus }) {
  if (!status) return null;
  const Icon = status.state === "loading"
    ? LoaderCircle
    : status.state === "error"
      ? AlertTriangle
      : CheckCircle2;
  const copy = status.state === "error"
    ? status.error || status.label
    : status.label;
  return (
    <div
      className={`qx-host-workbench-async is-${status.state}`}
      role={status.state === "error" ? "alert" : "status"}
    >
      <Icon
        size={14}
        aria-hidden="true"
        className={status.state === "loading" ? "qx-loading-spinner" : undefined}
      />
      {copy ? <span>{copy}</span> : null}
      {status.progress != null ? <span>{Math.round(status.progress)}%</span> : null}
    </div>
  );
}

function WorkbenchDetailImage({
  image,
  collection,
  onPreview,
  unavailableText,
  previewText,
}: {
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
    <img
      key={image.url}
      src={image.url}
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
  images,
  layout,
  onPreview,
  unavailableText,
  previewText,
  previousText,
  nextText,
}: {
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

function WorkbenchListMedia({ images }: { images: PluginWorkbenchImage[] }) {
  return (
    <span className="qx-host-workbench-list-media" aria-hidden="true">
      {images.map((image, index) => (
        <span className="qx-host-workbench-list-media-image" key={`${image.url}-${index}`}>
          <img
            src={image.url}
            alt=""
            loading="lazy"
            style={{ objectFit: image.fit || "cover" }}
          />
        </span>
      ))}
    </span>
  );
}

function WorkbenchDetail({
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
          image={detail.image}
          onPreview={onPreview}
          unavailableText={unavailableText}
          previewText={previewText}
        />
      ) : null}
      {detail.images?.length ? (
        <WorkbenchMediaCollection
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
  const detailContent = detail.content?.length ? (
    <div className="qx-host-workbench-content">
      {detail.content.map((block, index) => block.type === "text" ? (
        <p className="qx-host-workbench-body" key={`text-${index}`}>{block.text}</p>
      ) : (
        <WorkbenchDetailImage
          key={`image-${block.image.url}-${index}`}
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
  return (
    <div className="qx-content-detail-scroll" data-qx-region-scroll>
      {detail.mediaPlacement !== "after-body" ? detailMedia : null}
      {detail.title ? <h2 className="qx-content-detail-heading">{detail.title}</h2> : null}
      {detail.subtitle ? <div className="qx-content-detail-meta">{detail.subtitle}</div> : null}
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
      <WorkbenchFields fields={detail.fields} />
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
            createdAt: reply.createdAt,
            originalPoster: reply.originalPoster,
            body: reply.body,
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
  state,
  detailOpen,
  onActivate,
  onInput,
  onAction,
  onDownload,
}: PluginWorkbenchViewProps) {
  const t = useT();
  const [preview, setPreview] = useState<{
    images: PluginWorkbenchImage[];
    index: number;
  } | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewMetrics, setPreviewMetrics] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const previewDecodeCache = useRef(new Map<string, HTMLImageElement>());
  const [listWidth, setListWidth] = useState(readWorkbenchListWidth);
  const splitRef = useRef<HTMLDivElement>(null);
  const items = state.items || [];
  const selectedIndex = useMemo(() => {
    if (!items.length) return -1;
    const index = items.findIndex((item) => item.id === String(state.selectedId ?? ""));
    return index >= 0 ? index : 0;
  }, [items, state.selectedId]);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const listRef = useRef<HTMLDivElement>(null);
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: `${state.query || ""}:${items.map((item) => item.id).join("\0")}`,
    enabled: selectedIndex >= 0,
  });
  const detail = selected?.detail || state.detail;
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
  const galleryStyle = gallery
    ? { "--qx-workbench-gallery-columns": state.layout?.columns || 4 } as CSSProperties
    : undefined;
  const detailOnly = items.length === 0 && Boolean(state.detail);
  const openPreview = (image: PluginWorkbenchImage, collection: PluginWorkbenchImage[]) => {
    const images = collection.length ? collection : [image];
    const index = Math.max(0, images.findIndex((candidate) => candidate === image || candidate.url === image.url));
    setPreviewZoom(1);
    setPreviewMetrics(null);
    setPreview({ images, index });
  };
  const movePreview = (delta: number) => {
    setPreviewZoom(1);
    setPreviewMetrics(null);
    setPreview((current) => {
      if (!current || current.images.length < 2) return current;
      const index = (current.index + delta + current.images.length) % current.images.length;
      return { ...current, index };
    });
  };
  const changePreviewZoom = (delta: number) => {
    setPreviewZoom((current) => Math.max(0.5, Math.min(4, Math.round((current + delta) * 10) / 10)));
  };
  const changePreviewZoomByWheel = (deltaY: number) => {
    setPreviewZoom((current) => {
      const next = current * Math.exp(-deltaY * 0.0025);
      return Math.max(0.5, Math.min(4, Math.round(next * 100) / 100));
    });
  };
  const previewImage = preview?.images[preview.index];
  const downloadPreviewImage = useCallback(async () => {
    if (!previewImage) return;
    if (previewImage.downloadId) {
      onDownload(previewImage.downloadId);
      return;
    }
    const dataUrl = previewImage.url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is);
    if (dataUrl) {
      await invoke("plugin_system_save_download", {
        filename: previewImage.alt || "qx-image",
        mimeType: dataUrl[1],
        dataBase64: dataUrl[2],
      });
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = previewImage.url;
    anchor.download = previewImage.alt || "qx-image";
    anchor.click();
  }, [onDownload, previewImage]);
  const previewIsLongScreenshot = Boolean(
    previewImage
      && previewMetrics?.url === previewImage.url
      && previewMetrics.height / Math.max(1, previewMetrics.width) >= 3.2,
  );
  const previewOrientation = previewIsLongScreenshot
    ? "long-screenshot"
    : previewMetrics && previewImage && previewMetrics.url === previewImage.url
      ? previewMetrics.width >= previewMetrics.height
        ? "landscape"
        : "portrait"
      : "contain";

  useEffect(() => {
    if (!preview || preview.images.length < 2) return;
    const cache = previewDecodeCache.current;
    const count = preview.images.length;
    const indexes = [-2, -1, 1, 2].map(
      (offset) => (preview.index + offset + count) % count,
    );
    for (const [priorityIndex, index] of indexes.entries()) {
      const url = preview.images[index]?.url;
      if (!url || cache.has(url)) continue;
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = priorityIndex === 1 || priorityIndex === 2 ? "high" : "low";
      image.src = url;
      cache.set(url, image);
      void image.decode().catch(() => {
        // The visible image keeps its normal error UI; predecode is best effort.
      });
    }
    while (cache.size > 8) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    const onPreviewKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        movePreview(event.key === "ArrowRight" ? 1 : -1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changePreviewZoom(0.25);
      } else if (event.key === "-") {
        event.preventDefault();
        changePreviewZoom(-0.25);
      } else if (event.key === "0") {
        event.preventDefault();
        setPreviewZoom(1);
      }
    };
    window.addEventListener("keydown", onPreviewKeyDown, true);
    return () => window.removeEventListener("keydown", onPreviewKeyDown, true);
  }, [preview]);

  const updateListWidth = useCallback((clientX: number) => {
    const split = splitRef.current;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    const next = clampWorkbenchListWidth(clientX - rect.left, rect.width);
    setListWidth(next);
    persistWorkbenchListWidth(next);
  }, []);

  const startListResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    updateListWidth(event.clientX);
    const onMove = (moveEvent: PointerEvent) => updateListWidth(moveEvent.clientX);
    const onUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [updateListWidth]);

  const nudgeListWidth = useCallback((delta: number) => {
    const splitWidth = splitRef.current?.getBoundingClientRect().width ?? 980;
    const next = clampWorkbenchListWidth(
      (listWidth ?? DEFAULT_WORKBENCH_LIST_WIDTH) + delta,
      splitWidth,
    );
    setListWidth(next);
    persistWorkbenchListWidth(next);
  }, [listWidth]);

  const onListResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    nudgeListWidth(event.key === "ArrowLeft" ? -24 : 24);
  }, [nudgeListWidth]);

  const collection = gallery ? (
    <div
      ref={listRef}
      className={`qx-content-list qx-host-workbench-gallery aspect-${state.layout?.aspectRatio || "landscape"}${densityClass}`}
      style={galleryStyle}
      role="listbox"
      {...qxRegionProps(PLUGIN_WORKBENCH_REGIONS.list, { initial: true, label: listTitle })}
    >
      {items.length ? items.map((item, index) => {
        const id = item.id;
        return (
          <button
            key={id}
            type="button"
            {...getItemProps(index, { className: "qx-host-workbench-gallery-card", baseClass: false })}
            onClick={() => onActivate(id)}
          >
            <span className="qx-host-workbench-gallery-image">
              {item.image?.url ? (
                <img
                  src={item.image.url}
                  alt={item.image.alt || ""}
                  loading="lazy"
                  style={{ objectFit: item.image.fit || "cover" }}
                />
              ) : (
                <span aria-hidden="true">{item.icon || "•"}</span>
              )}
            </span>
            <span className="qx-host-workbench-gallery-copy">
              <strong>{item.title}</strong>
              {item.subtitle ? <small>{item.subtitle}</small> : null}
            </span>
            {(item.badge || item.meta) ? (
              <span className={`qx-host-workbench-gallery-badge${toneClass(item.tone)}`}>
                {item.badge || item.meta}
              </span>
            ) : null}
            <WorkbenchStatus status={item.status} />
          </button>
        );
      }) : (
        <div className="qx-content-detail-empty qx-host-workbench-empty">
          {state.emptyText || (state.loading
            ? t("plugins.workbench.loading", "Loading…")
            : t("plugins.workbench.empty", "No results"))}
        </div>
      )}
    </div>
  ) : (
    <div
      ref={listRef}
      className="qx-content-list qx-plugin-list qx-host-workbench-list"
      role="listbox"
      {...qxRegionProps(PLUGIN_WORKBENCH_REGIONS.list, { initial: true, label: listTitle })}
    >
      <div className="qx-section-header qx-host-workbench-list-header">
        <span>{listTitle}</span>
        <span>{state.loading ? "…" : items.length}</span>
      </div>
      {items.length ? items.map((item, index) => {
        const id = item.id;
        return (
          <button
            key={id}
            type="button"
            {...getItemProps(index, {
              className: [
                "tall qx-host-workbench-row",
                item.images?.length ? "has-card-media" : "",
                item.progress != null ? "has-progress" : "",
              ].filter(Boolean).join(" "),
            })}
            onClick={() => onActivate(id)}
          >
            <span className={`qx-host-workbench-icon${item.image?.url ? " has-image" : ""}`} aria-hidden="true">
              {item.image?.url ? (
                <img
                  src={item.image.url}
                  alt=""
                  loading="lazy"
                  style={{ objectFit: item.image.fit || "cover" }}
                />
              ) : item.icon || "•"}
            </span>
            <span className="qx-list-copy">
              <strong className="qx-list-title">{item.title}</strong>
              {item.subtitle ? <small>{item.subtitle}</small> : null}
              {item.images?.length ? <WorkbenchListMedia images={item.images} /> : null}
              {item.progress != null ? (
                <span className="qx-host-workbench-progress" aria-label={`${Math.round(item.progress)}%`}>
                  <i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                </span>
              ) : null}
            </span>
            {(item.badge || item.meta || item.status) ? (
              <span className="qx-host-workbench-accessory">
                {(item.badge || item.meta) ? (
                  <span className={`qx-host-workbench-badge${toneClass(item.tone)}`}>
                    {item.badge || item.meta}
                  </span>
                ) : null}
                <WorkbenchStatus status={item.status} />
              </span>
            ) : null}
          </button>
        );
      }) : shouldShowQxListLoading(Boolean(state.loading), items.length) ? (
        <QxListLoading
          ariaLabel={loadingText}
          label={loadingText}
          rows={6}
          variant="tall"
        />
      ) : (
        <div className="qx-content-detail-empty qx-host-workbench-empty">
          {state.emptyText || t("plugins.workbench.empty", "No results")}
        </div>
      )}
    </div>
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
        <div
          ref={splitRef}
          className={`qx-content-split qx-host-workbench-split has-detail${gallery ? " is-gallery" : ""}${densityClass}`}
          style={listWidth
            ? { "--qx-workbench-list-w": `${listWidth}px` } as CSSProperties
            : undefined}
        >
          {collection}
          <div
            className="qx-host-workbench-resize-handle"
            role="separator"
            aria-label={t("plugins.workbench.resizeList", "Resize list and detail")}
            aria-orientation="vertical"
            aria-valuenow={listWidth ?? undefined}
            tabIndex={0}
            data-qx-search-focus="preserve"
            onPointerDown={startListResize}
            onKeyDown={onListResizeKeyDown}
            onDoubleClick={() => {
              setListWidth(null);
              persistWorkbenchListWidth(null);
            }}
          />
          <div
            className="qx-content-detail qx-plugin-detail"
            {...qxRegionProps(PLUGIN_WORKBENCH_REGIONS.detail, {
              label: t("plugins.workbench.detail", "Detail"),
              scroll: true,
            })}
          >
            <WorkbenchDetail
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
        </div>
      ) : collection}
      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="qx-host-workbench-media-dialog">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="qx-host-workbench-media-close"
            aria-label={t("common.close", "Close")}
            onClick={() => setPreview(null)}
          >
            <X size={16} aria-hidden="true" />
          </Button>
          <DialogHeader>
            <DialogTitle>{previewImage?.alt || t("plugins.workbench.imagePreview", "Image Preview")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("plugins.workbench.imagePreviewHint", "Full-size preview of the selected image")}
            </DialogDescription>
          </DialogHeader>
          {previewImage ? (
            <div
              className="qx-host-workbench-media-preview-stage"
              onWheel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                changePreviewZoomByWheel(event.deltaY);
              }}
            >
              {preview && preview.images.length > 1 ? (
                <div className="qx-host-workbench-media-preview-nav-zone is-previous">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="qx-host-workbench-media-preview-nav"
                    aria-label={t("plugins.workbench.previousImage", "Previous image")}
                    onClick={() => movePreview(-1)}
                  >
                    <ChevronLeft size={20} aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
              <div
                className={[
                  "qx-host-workbench-media-preview-scroll",
                  `is-${previewOrientation}`,
                  previewZoom > 1 ? "is-enlarged" : previewZoom < 1 ? "is-reduced" : "",
                ].filter(Boolean).join(" ")}
                tabIndex={0}
                aria-label={t("plugins.workbench.imagePreviewHint", "Full-size preview of the selected image")}
              >
                <img
                  key={previewImage.url}
                  src={previewImage.url}
                  alt={previewImage.alt || ""}
                  className={previewZoom === 1 ? undefined : "is-zoomed"}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setPreviewMetrics({
                      url: previewImage.url,
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }}
                  style={{
                    objectFit: previewImage.fit || "contain",
                    "--qx-image-zoom-size": `${Math.round(previewZoom * 100)}%`,
                  } as CSSProperties}
                />
              </div>
              <div className="qx-host-workbench-media-zoom">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={previewZoom <= 0.5}
                  aria-label={t("plugins.workbench.zoomOut", "Zoom out")}
                  onClick={() => changePreviewZoom(-0.25)}
                >
                  <Minus size={14} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="qx-host-workbench-media-zoom-value"
                  aria-label={t("plugins.workbench.resetZoom", "Reset zoom")}
                  onClick={() => setPreviewZoom(1)}
                >
                  {Math.round(previewZoom * 100)}%
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={previewZoom >= 4}
                  aria-label={t("plugins.workbench.zoomIn", "Zoom in")}
                  onClick={() => changePreviewZoom(0.25)}
                >
                  <Plus size={14} aria-hidden="true" />
                </Button>
              </div>
              {preview && preview.images.length > 1 ? (
                <div className="qx-host-workbench-media-preview-nav-zone is-next">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="qx-host-workbench-media-preview-nav"
                    aria-label={t("plugins.workbench.nextImage", "Next image")}
                    onClick={() => movePreview(1)}
                  >
                    <ChevronRight size={20} aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
              {preview && preview.images.length > 1 ? (
                <span className="qx-host-workbench-media-preview-count" aria-live="polite">
                  {preview.index + 1} / {preview.images.length}
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`qx-host-workbench-media-download${preview && preview.images.length > 1 ? " has-count" : ""}`}
                aria-label={t("plugins.workbench.downloadImage", "Download original image")}
                onClick={() => void downloadPreviewImage()}
              >
                <Download size={14} aria-hidden="true" />
                <span>{t("plugins.workbench.downloadImage", "Download original")}</span>
              </Button>
            </div>
          ) : null}
          {previewImage?.caption ? <p>{previewImage.caption}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

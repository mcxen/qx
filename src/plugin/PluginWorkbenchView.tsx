import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Maximize2,
  X,
} from "lucide-react";
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

export const PLUGIN_WORKBENCH_REGIONS = qxMasterDetailIds("plugin-workbench");

interface PluginWorkbenchViewProps {
  state: PluginWorkbenchState;
  detailOpen: boolean;
  onActivate: (id: string) => void;
  onInput: (id: string, value: string) => void;
  onAction: (id: string) => void;
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
  onPreview,
  unavailableText,
  previewText,
}: {
  image: PluginWorkbenchImage;
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
          onClick={() => onPreview(image, [image])}
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
  return (
    <div className="qx-content-detail-scroll" data-qx-region-scroll>
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

export default function PluginWorkbenchView({
  state,
  detailOpen,
  onActivate,
  onInput,
  onAction,
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
    setPreview({ images, index });
  };
  const movePreview = (delta: number) => {
    setPreview((current) => {
      if (!current || current.images.length < 2) return current;
      const index = (current.index + delta + current.images.length) % current.images.length;
      return { ...current, index };
    });
  };
  const previewImage = preview?.images[preview.index];

  useEffect(() => {
    if (!preview) return;
    const onPreviewKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      movePreview(event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onPreviewKeyDown, true);
    return () => window.removeEventListener("keydown", onPreviewKeyDown, true);
  }, [preview]);

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
            {...getItemProps(index, { className: "tall qx-host-workbench-row" })}
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
        <div className={`qx-content-split qx-host-workbench-split has-detail${gallery ? " is-gallery" : ""}${densityClass}`}>
          {collection}
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
            <div className="qx-host-workbench-media-preview-stage">
              {preview && preview.images.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="qx-host-workbench-media-preview-nav is-previous"
                  aria-label={t("plugins.workbench.previousImage", "Previous image")}
                  onClick={() => movePreview(-1)}
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </Button>
              ) : null}
              <img
                key={previewImage.url}
                src={previewImage.url}
                alt={previewImage.alt || ""}
                style={{ objectFit: previewImage.fit || "contain" }}
              />
              {preview && preview.images.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="qx-host-workbench-media-preview-nav is-next"
                  aria-label={t("plugins.workbench.nextImage", "Next image")}
                  onClick={() => movePreview(1)}
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </Button>
              ) : null}
              {preview && preview.images.length > 1 ? (
                <span className="qx-host-workbench-media-preview-count" aria-live="polite">
                  {preview.index + 1} / {preview.images.length}
                </span>
              ) : null}
            </div>
          ) : null}
          {previewImage?.caption ? <p>{previewImage.caption}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import type { PluginIslandDisplayInput } from "./types";

export type PluginWorkbenchTone = "neutral" | "success" | "warning" | "danger" | "accent";

export interface PluginWorkbenchField {
  label: string;
  value: string | number | boolean | null;
  tone?: PluginWorkbenchTone;
}

export interface PluginWorkbenchSection {
  title?: string;
  body?: string;
  fields?: PluginWorkbenchField[];
}

export interface PluginWorkbenchControl {
  /** Stable identifier returned to the plugin in `onInput`. */
  id: string;
  label: string;
  value: string;
  type?: "text" | "number" | "select";
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Consecutive controls with the same group id are rendered in one managed
   * fieldset. The first occurrence supplies the label and optional group action.
   */
  group?: {
    id: string;
    label?: string;
    action?: PluginWorkbenchAction;
  };
}

export interface PluginWorkbenchForm {
  title?: string;
  description?: string;
  controls: PluginWorkbenchControl[];
  /** Visible management actions rendered below the controls. */
  actions?: PluginWorkbenchAction[];
}

export interface PluginWorkbenchImage {
  url: string;
  alt?: string;
  fit?: "cover" | "contain";
  /**
   * Detail media defaults to `auto`; gallery cards continue to use the
   * collection layout aspect ratio. This keeps portrait and unusually wide
   * images usable in a narrow detail pane.
   */
  aspectRatio?: "auto" | "landscape" | "square" | "portrait";
  /** Opens the host-owned image preview. Defaults to true for detail media. */
  zoomable?: boolean;
  caption?: string;
}

export interface PluginWorkbenchAsyncStatus {
  state: "loading" | "success" | "error";
  label?: string;
  error?: string;
  progress?: number;
}

/** Pure-data detail model rendered by Qx; HTML is intentionally not accepted. */
export interface PluginWorkbenchDetail {
  title?: string;
  subtitle?: string;
  /** Optional large media preview rendered above the structured detail. */
  image?: PluginWorkbenchImage;
  /**
   * Optional media collection rendered by the host. Use this for community
   * posts and other records with multiple images.
   */
  images?: PluginWorkbenchImage[];
  /** Host media layout. Defaults to `grid`; `horizontal` enables a filmstrip. */
  imageLayout?: "grid" | "horizontal";
  /** Item-local asynchronous state; does not replace the usable cached detail. */
  status?: PluginWorkbenchAsyncStatus;
  body?: string;
  /** Host-rendered form controls; values remain controlled by plugin state. */
  form?: PluginWorkbenchForm;
  fields?: PluginWorkbenchField[];
  sections?: PluginWorkbenchSection[];
}

export interface PluginWorkbenchAction {
  id: string;
  label: string;
  /** Optional manifest command. Host executes it outside the panel runtime. */
  command?: string;
  kbd?: string;
  primary?: boolean;
  disabled?: boolean;
  /** Action chrome only distinguishes default/primary/danger; other tones are item status semantics. */
  tone?: PluginWorkbenchTone;
}

export interface PluginWorkbenchItem {
  /** Stable, unique business identifier. Required for selection and Actions. */
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  icon?: string;
  /** Remote/data image rendered by the host in gallery mode. */
  image?: PluginWorkbenchImage;
  /** Per-item async state for refresh, metadata, thumbnail, or batch work. */
  status?: PluginWorkbenchAsyncStatus;
  progress?: number;
  tone?: PluginWorkbenchTone | string;
  /** Structured detail rendered by the host. */
  detail?: PluginWorkbenchDetail;
  /** Item-scoped QxShell actions. */
  actions?: PluginWorkbenchAction[];
  /** Kept inside the plugin runtime for handlers; never crosses into host rendering. */
  raw?: unknown;
}

export interface PluginWorkbenchState {
  /** Monotonic publication revision. The host ignores an older async snapshot. */
  revision?: number;
  title?: string;
  meta?: string;
  error?: string | null;
  loading?: boolean;
  query?: string;
  queryPlaceholder?: string;
  /** Host-rendered collection layout. List remains the backwards-compatible default. */
  layout?: {
    kind: "list" | "gallery";
    /** Gallery column hint; the host still collapses columns responsively. */
    columns?: number;
    aspectRatio?: "landscape" | "square" | "portrait";
  };
  tabs?: Array<{ id: string; label: string; active?: boolean }>;
  actions?: PluginWorkbenchAction[];
  items?: PluginWorkbenchItem[];
  selectedId?: string | null;
  /** Detail for dashboards without a selected row. Selected item detail wins. */
  detail?: PluginWorkbenchDetail;
  emptyText?: string;
  /** Optional island projection. null dismisses the plugin island session. */
  island?: PluginIslandDisplayInput | null;
  /**
   * Bind this view to a manifest `mode: "no-view"` + `interval` command.
   * The command keeps running while the panel is closed; Qx notifies the
   * mounted Workbench after each completion so it can reload persisted data.
   */
  backgroundPoll?: { command: string };
}

export interface PluginWorkbenchItemsUpdate {
  /** Insert new ids and shallow-replace existing ids without rebuilding the collection. */
  upsert?: PluginWorkbenchItem[];
  /** Remove ids after applying upserts. */
  removeIds?: string[];
  /** Optional stable id order; omitted ids retain their relative order at the end. */
  order?: string[];
  selectedId?: string | null;
}

export interface PluginWorkbenchController {
  /** Publish a shallow state update while retaining omitted fields. */
  update: (patch: Partial<PluginWorkbenchState>) => void;
  /** Publish a keyed collection mutation suitable for incremental/batch async results. */
  updateItems: (update: PluginWorkbenchItemsUpdate) => void;
  getState: () => PluginWorkbenchState;
}

export type PluginWorkbenchEvent =
  | { kind: "query"; value: string }
  | { kind: "tab"; id: string }
  | { kind: "select"; id: string }
  | { kind: "input"; id: string; value: string; selectedId?: string }
  | { kind: "action"; id: string; selectedId?: string }
  | { kind: "commandComplete"; command: string; at: number }
  | { kind: "backgroundPoll"; command: string; at: number; ok: boolean; error?: string };

export interface PluginWorkbenchPayload {
  pluginId: string;
  runtimeId: string;
  state: PluginWorkbenchState;
}

function shortText(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  return String(value).slice(0, max);
}

function normalizeTone(value: unknown): PluginWorkbenchTone | undefined {
  return value === "success" || value === "warning" || value === "danger" || value === "accent"
    ? value
    : value === "neutral"
      ? "neutral"
      : undefined;
}

function normalizeFields(value: unknown): PluginWorkbenchField[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 48).map((raw) => {
    const field = (raw || {}) as Record<string, unknown>;
    const rawValue = field.value;
    return {
      label: shortText(field.label, 120) || "",
      value:
        typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean" || rawValue == null
          ? rawValue as PluginWorkbenchField["value"]
          : shortText(JSON.stringify(rawValue), 2_000) || "",
      tone: normalizeTone(field.tone),
    };
  }).filter((field) => Boolean(field.label));
}

function normalizeForm(value: unknown): PluginWorkbenchForm | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const seen = new Set<string>();
  const controls = Array.isArray(raw.controls)
    ? raw.controls.slice(0, 64).map((entry) => {
        const control = (entry || {}) as Record<string, unknown>;
        const id = shortText(control.id, 256)?.trim() || "";
        const options = Array.isArray(control.options)
          ? control.options.slice(0, 64).map((option) => {
              const item = (option || {}) as Record<string, unknown>;
              return {
                label: shortText(item.label, 160) || shortText(item.value, 500) || "",
                value: shortText(item.value, 500) || "",
              };
            }).filter((option) => Boolean(option.value))
          : [];
        return {
          id,
          label: shortText(control.label, 160) || id,
          value: shortText(control.value, 2_000) || "",
          type: control.type === "number" || control.type === "select" ? control.type : "text",
          options,
          placeholder: shortText(control.placeholder, 500),
          disabled: control.disabled === true,
          group: (() => {
            if (!control.group || typeof control.group !== "object") return undefined;
            const group = control.group as Record<string, unknown>;
            const groupId = shortText(group.id, 128)?.trim();
            if (!groupId) return undefined;
            return {
              id: groupId,
              label: shortText(group.label, 160),
              action: normalizeActions([group.action])[0],
            };
          })(),
        } satisfies PluginWorkbenchControl;
      }).filter((control) => {
        if (!control.id || seen.has(control.id)) return false;
        seen.add(control.id);
        return true;
      })
    : [];
  if (!controls.length) return undefined;
  return {
    title: shortText(raw.title, 160),
    description: shortText(raw.description, 1_000),
    controls,
    actions: normalizeActions(raw.actions),
  };
}

function normalizeAsyncStatus(value: unknown): PluginWorkbenchAsyncStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.state !== "loading" && raw.state !== "success" && raw.state !== "error") return undefined;
  const progress = Number(raw.progress);
  return {
    state: raw.state,
    label: shortText(raw.label, 240),
    error: shortText(raw.error, 1_000),
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : undefined,
  };
}

function normalizeDetail(value: unknown): PluginWorkbenchDetail | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const sections = Array.isArray(raw.sections)
    ? raw.sections.slice(0, 16).map((entry) => {
        const section = (entry || {}) as Record<string, unknown>;
        return {
          title: shortText(section.title, 160),
          body: shortText(section.body, 8_000),
          fields: normalizeFields(section.fields),
        };
      })
    : [];
  const detail = {
    title: shortText(raw.title, 240),
    subtitle: shortText(raw.subtitle, 500),
    image: normalizeImage(raw.image, true),
    images: Array.isArray(raw.images)
      ? raw.images.slice(0, 24)
          .map((image) => normalizeImage(image, true))
          .filter((image): image is PluginWorkbenchImage => Boolean(image))
      : [],
    imageLayout: raw.imageLayout === "horizontal" ? "horizontal" as const : "grid" as const,
    status: normalizeAsyncStatus(raw.status),
    body: shortText(raw.body, 12_000),
    form: normalizeForm(raw.form),
    fields: normalizeFields(raw.fields),
    sections,
  };
  return detail.title || detail.subtitle || detail.image || detail.images.length || detail.status || detail.body || detail.form || detail.fields.length || detail.sections.length
    ? detail
    : undefined;
}

function normalizeActions(value: unknown): PluginWorkbenchAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map((entry) => {
    const raw = (entry || {}) as Record<string, unknown>;
    const shortcut = shortText(raw.kbd, 64)?.trim();
    return {
      id: shortText(raw.id, 128) || "",
      label: shortText(raw.label, 180) || shortText(raw.id, 128) || "Action",
      command: shortText(raw.command, 128),
      kbd: shortcut && !/^esc(?:ape)?$/i.test(shortcut) ? shortcut : undefined,
      primary: raw.primary === true,
      disabled: raw.disabled === true,
      tone: normalizeTone(raw.tone),
    };
  }).filter((action) => Boolean(action.id));
}

function normalizeImage(value: unknown, detail = false): PluginWorkbenchItem["image"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== "string") return undefined;
  const url = raw.url.trim();
  const isHttps = /^https:\/\//i.test(url);
  const isDataImage = /^data:image\//i.test(url);
  // Reject oversized URLs instead of truncating them into invalid images.
  if ((!isHttps && !isDataImage) || (isHttps && url.length > 4_000) || url.length > 2_000_000) {
    return undefined;
  }
  return {
    url,
    alt: shortText(raw.alt, 500),
    fit: raw.fit === "contain" || (detail && raw.fit !== "cover") ? "contain" : "cover",
    aspectRatio:
      raw.aspectRatio === "landscape" || raw.aspectRatio === "square" || raw.aspectRatio === "portrait"
        ? raw.aspectRatio
        : detail || raw.aspectRatio === "auto"
          ? "auto"
          : undefined,
    zoomable: raw.zoomable == null ? detail : raw.zoomable === true,
    caption: shortText(raw.caption, 500),
  };
}

/** Trust boundary for iframe → React workbench data. */
export function normalizePluginWorkbenchState(value: unknown): PluginWorkbenchState {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const seenItemIds = new Set<string>();
  const items = Array.isArray(raw.items)
    ? raw.items.slice(0, 500).map((entry, index) => {
        const item = (entry || {}) as Record<string, unknown>;
        const progress = Number(item.progress);
        const title = shortText(item.title, 500) || `Item ${index + 1}`;
        return {
          id: shortText(item.id, 256) || "",
          title,
          subtitle: shortText(item.subtitle, 1_000),
          meta: shortText(item.meta, 240),
          badge: shortText(item.badge, 120),
          icon: shortText(item.icon, 24),
          image: normalizeImage(item.image),
          status: normalizeAsyncStatus(item.status),
          progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : undefined,
          tone: normalizeTone(item.tone),
          detail: normalizeDetail(item.detail),
          actions: normalizeActions(item.actions),
        } satisfies PluginWorkbenchItem;
      }).filter((item) => {
        const id = String(item.id);
        if (!id || seenItemIds.has(id)) return false;
        seenItemIds.add(id);
        return true;
      })
    : [];
  const seenTabIds = new Set<string>();
  let activeTabSeen = false;
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.slice(0, 16).map((entry) => {
        const tab = (entry || {}) as Record<string, unknown>;
        const active = tab.active === true && !activeTabSeen;
        if (active) activeTabSeen = true;
        return {
          id: shortText(tab.id, 64) || "",
          label: shortText(tab.label, 120) || shortText(tab.id, 64) || "Tab",
          active,
        };
      }).filter((tab) => {
        if (!tab.id || seenTabIds.has(tab.id)) return false;
        seenTabIds.add(tab.id);
        return true;
      })
    : [];
  if (tabs.length && !tabs.some((tab) => tab.active)) tabs[0].active = true;
  const hasIsland = Object.prototype.hasOwnProperty.call(raw, "island");
  const layoutRaw = raw.layout && typeof raw.layout === "object"
    ? raw.layout as Record<string, unknown>
    : null;
  const galleryColumns = Number(layoutRaw?.columns);
  const layout: NonNullable<PluginWorkbenchState["layout"]> = layoutRaw?.kind === "gallery"
    ? {
        kind: "gallery" as const,
        columns: Number.isFinite(galleryColumns)
          ? Math.max(2, Math.min(8, Math.round(galleryColumns)))
          : undefined,
        aspectRatio: layoutRaw.aspectRatio === "square" || layoutRaw.aspectRatio === "portrait"
          ? layoutRaw.aspectRatio
          : "landscape",
      }
    : { kind: "list" as const };
  const backgroundPollRaw = raw.backgroundPoll && typeof raw.backgroundPoll === "object"
    ? raw.backgroundPoll as Record<string, unknown>
    : null;
  const backgroundPollCommand = shortText(backgroundPollRaw?.command, 128);
  const islandRaw = raw.island && typeof raw.island === "object"
    ? raw.island as Record<string, unknown>
    : null;
  const island: PluginIslandDisplayInput | null = islandRaw
    ? {
        primary: shortText(islandRaw.primary, 80) || "",
        secondary: shortText(islandRaw.secondary, 120),
        tone: islandRaw.tone === "success" || islandRaw.tone === "warning" || islandRaw.tone === "danger"
          ? islandRaw.tone
          : "neutral",
        progress: Number.isFinite(Number(islandRaw.progress))
          ? Math.max(0, Math.min(100, Number(islandRaw.progress)))
          : undefined,
        activity: islandRaw.activity === "wave" || islandRaw.activity === "dots" || islandRaw.activity === "spinner" || islandRaw.activity === "pulse"
          ? islandRaw.activity
          : undefined,
        action: islandRaw.action && typeof islandRaw.action === "object"
          ? {
              label: shortText((islandRaw.action as Record<string, unknown>).label, 40) || "",
              command: shortText((islandRaw.action as Record<string, unknown>).command, 128) || "",
              icon: (() => {
                const icon = (islandRaw.action as Record<string, unknown>).icon;
                return icon === "pause" || icon === "play" || icon === "stop" || icon === "open"
                  ? icon
                  : undefined;
              })(),
              variant: (islandRaw.action as Record<string, unknown>).variant === "danger"
                ? "danger"
                : "default",
            }
          : undefined,
        countdown: (() => {
          if (!islandRaw.countdown || typeof islandRaw.countdown !== "object") return undefined;
          const countdown = islandRaw.countdown as Record<string, unknown>;
          const endsAt = typeof countdown.endsAt === "number" ? countdown.endsAt : Number.NaN;
          const remainingMs = typeof countdown.remainingMs === "number" ? countdown.remainingMs : Number.NaN;
          const durationMs = typeof countdown.durationMs === "number" ? countdown.durationMs : Number.NaN;
          if ((!Number.isFinite(endsAt) || endsAt <= 0) && !Number.isFinite(remainingMs)) return undefined;
          return {
            endsAt: Number.isFinite(endsAt) && endsAt > 0
              ? Math.min(Date.now() + 30 * 86_400_000, endsAt)
              : undefined,
            remainingMs: Number.isFinite(remainingMs)
              ? Math.max(0, Math.min(30 * 86_400_000, remainingMs))
              : undefined,
            durationMs: Number.isFinite(durationMs)
              ? Math.max(1_000, Math.min(30 * 86_400_000, durationMs))
              : undefined,
            paused: countdown.paused === true,
          };
        })(),
      }
    : null;
  return {
    revision: Number.isFinite(Number(raw.revision))
      ? Math.max(0, Math.floor(Number(raw.revision)))
      : undefined,
    title: shortText(raw.title, 240),
    meta: shortText(raw.meta, 500),
    error: raw.error == null ? null : shortText(raw.error, 2_000),
    loading: raw.loading === true,
    query: shortText(raw.query, 500) || "",
    queryPlaceholder: shortText(raw.queryPlaceholder, 120),
    layout,
    tabs,
    actions: normalizeActions(raw.actions),
    items,
    selectedId: raw.selectedId == null ? null : shortText(raw.selectedId, 256),
    detail: normalizeDetail(raw.detail),
    emptyText: shortText(raw.emptyText, 500),
    ...(backgroundPollCommand ? { backgroundPoll: { command: backgroundPollCommand } } : {}),
    ...(hasIsland ? { island } : {}),
  };
}

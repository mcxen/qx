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

/** Pure-data detail model rendered by Qx; HTML is intentionally not accepted. */
export interface PluginWorkbenchDetail {
  title?: string;
  subtitle?: string;
  body?: string;
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
  tone?: PluginWorkbenchTone;
}

export interface PluginWorkbenchItem {
  id?: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  icon?: string;
  /** Remote/data image rendered by the host in gallery mode. */
  image?: {
    url: string;
    alt?: string;
    fit?: "cover" | "contain";
  };
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

export type PluginWorkbenchEvent =
  | { kind: "query"; value: string }
  | { kind: "tab"; id: string }
  | { kind: "select"; id: string }
  | { kind: "action"; id: string; selectedId?: string }
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
  return {
    title: shortText(raw.title, 240),
    subtitle: shortText(raw.subtitle, 500),
    body: shortText(raw.body, 12_000),
    fields: normalizeFields(raw.fields),
    sections,
  };
}

function normalizeActions(value: unknown): PluginWorkbenchAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map((entry) => {
    const raw = (entry || {}) as Record<string, unknown>;
    return {
      id: shortText(raw.id, 128) || "",
      label: shortText(raw.label, 180) || shortText(raw.id, 128) || "Action",
      command: shortText(raw.command, 128),
      kbd: shortText(raw.kbd, 64),
      primary: raw.primary === true,
      disabled: raw.disabled === true,
      tone: normalizeTone(raw.tone),
    };
  }).filter((action) => Boolean(action.id));
}

function normalizeImage(value: unknown): PluginWorkbenchItem["image"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const url = shortText(raw.url, 4_000);
  if (!url || (!/^https:\/\//i.test(url) && !/^data:image\//i.test(url))) return undefined;
  return {
    url,
    alt: shortText(raw.alt, 500),
    fit: raw.fit === "contain" ? "contain" : "cover",
  };
}

/** Trust boundary for iframe → React workbench data. */
export function normalizePluginWorkbenchState(value: unknown): PluginWorkbenchState {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items.slice(0, 500).map((entry, index) => {
        const item = (entry || {}) as Record<string, unknown>;
        const progress = Number(item.progress);
        return {
          id: shortText(item.id, 256) || String(index),
          title: shortText(item.title, 500) || `Item ${index + 1}`,
          subtitle: shortText(item.subtitle, 1_000),
          meta: shortText(item.meta, 240),
          badge: shortText(item.badge, 120),
          icon: shortText(item.icon, 24),
          image: normalizeImage(item.image),
          progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : undefined,
          tone: normalizeTone(item.tone),
          detail: normalizeDetail(item.detail),
          actions: normalizeActions(item.actions),
        } satisfies PluginWorkbenchItem;
      })
    : [];
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.slice(0, 16).map((entry) => {
        const tab = (entry || {}) as Record<string, unknown>;
        return {
          id: shortText(tab.id, 64) || "",
          label: shortText(tab.label, 120) || shortText(tab.id, 64) || "Tab",
          active: tab.active === true,
        };
      }).filter((tab) => Boolean(tab.id))
    : [];
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

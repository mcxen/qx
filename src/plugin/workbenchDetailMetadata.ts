import type {
  PluginWorkbenchDetail,
  PluginWorkbenchField,
  PluginWorkbenchTone,
} from "./workbenchTypes";

export interface WorkbenchDetailMetadataItem {
  key: string;
  text: string;
  tone?: PluginWorkbenchTone;
}

export interface WorkbenchDetailMetadata {
  items: WorkbenchDetailMetadataItem[];
  fields?: PluginWorkbenchField[];
  promoted: boolean;
}

function fieldValue(field: PluginWorkbenchField): string {
  return field.value == null || field.value === "" ? "—" : String(field.value);
}

function comparableMetadata(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .toLowerCase();
}

function subtitleSegments(subtitle: string | undefined): Set<string> {
  if (!subtitle?.trim()) return new Set();
  return new Set(
    subtitle
      .split(/\s*[·•|]\s*|\n+/u)
      .map(comparableMetadata)
      .filter(Boolean),
  );
}

/**
 * Reading details keep compact article metadata under the title. Management
 * details retain their structured field table even when they also have text.
 */
export function isWorkbenchReadingDetail(detail: PluginWorkbenchDetail): boolean {
  return Boolean(
    detail.body?.trim()
    || detail.content?.length
    || detail.replies,
  ) && !detail.form && !detail.chart;
}

export function resolveWorkbenchDetailMetadata(
  detail: PluginWorkbenchDetail,
): WorkbenchDetailMetadata {
  const subtitle = detail.subtitle?.trim();
  const items: WorkbenchDetailMetadataItem[] = subtitle
    ? [{ key: "subtitle", text: subtitle }]
    : [];
  const fields = detail.fields?.length ? detail.fields : undefined;
  if (!fields || !isWorkbenchReadingDetail(detail)) {
    return { items, fields, promoted: false };
  }

  const existing = subtitleSegments(subtitle);
  fields.forEach((field, index) => {
    const label = field.label.trim();
    const value = fieldValue(field);
    const text = label ? `${label} ${value}` : value;
    const comparisons = [
      comparableMetadata(value),
      comparableMetadata(text),
      comparableMetadata(`${label}: ${value}`),
      comparableMetadata(`${label}：${value}`),
    ];
    if (comparisons.some((candidate) => existing.has(candidate))) return;
    items.push({
      key: `field-${label || "value"}-${index}`,
      text,
      tone: field.tone,
    });
  });

  return { items, fields: undefined, promoted: true };
}

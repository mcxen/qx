import type { AppEntry } from "../store";
import type { FileSearchCategory } from "../modules/settings/store";
import {
  compareFileModifiedDescending,
  fileCategoryIdFromNormalized,
  normalizeFileSearchCategories,
} from "../search/fileCategories";

export type LauncherResultRow =
  | {
      kind: "category";
      key: string;
      categoryId: string;
      label: string;
      translationKey: string;
      count: number;
      collapsed: boolean;
    }
  | {
      kind: "item";
      key: string;
      item: AppEntry;
      resultIndex: number;
      categoryId?: string;
    };

type LauncherEntryCategoryId = "launcher.qx" | "launcher.apps" | "launcher.plugins";

const LAUNCHER_ENTRY_CATEGORIES: Array<{
  id: LauncherEntryCategoryId;
  label: string;
  translationKey: string;
}> = [
  { id: "launcher.qx", label: "Qx Built-ins", translationKey: "launcher.category.qx" },
  { id: "launcher.apps", label: "Applications", translationKey: "launcher.category.apps" },
  {
    id: "launcher.plugins",
    label: "External Plugins",
    translationKey: "launcher.category.plugins",
  },
];

function isExternalPluginEntry(item: AppEntry): boolean {
  if (item.path.startsWith("__qx:plugin:")) return true;
  if (!item.path.startsWith("__qx:cmd:")) return false;
  return !item.path.slice("__qx:cmd:".length).startsWith("builtin:");
}

/** Classify synchronously so local Qx results can always render first. */
export function launcherEntryCategoryId(item: AppEntry): LauncherEntryCategoryId {
  if (item.moduleId || (item.path.startsWith("__qx:") && !isExternalPluginEntry(item))) {
    return "launcher.qx";
  }
  if (isExternalPluginEntry(item)) return "launcher.plugins";
  if (item.kind === "app" || item.kind == null) return "launcher.apps";
  return "launcher.qx";
}

export function buildLauncherResultRows(
  results: AppEntry[],
  categories: FileSearchCategory[],
  collapsedCategoryIds: ReadonlySet<string>,
): LauncherResultRow[] {
  const normalized = normalizeFileSearchCategories(categories);
  const rows: LauncherResultRow[] = [];

  const launcherEntries = results
    .map((item, resultIndex) => ({ item, resultIndex }))
    .filter(({ item }) => item.kind !== "file" && item.kind !== "folder");

  for (const category of LAUNCHER_ENTRY_CATEGORIES) {
    const matches = launcherEntries.filter(
      ({ item }) => launcherEntryCategoryId(item) === category.id,
    );
    if (matches.length === 0) continue;
    const collapsed = collapsedCategoryIds.has(category.id);
    rows.push({
      kind: "category",
      key: `category:${category.id}`,
      categoryId: category.id,
      label: category.label,
      translationKey: category.translationKey,
      count: matches.length,
      collapsed,
    });
    if (collapsed) continue;
    rows.push(...matches.map(({ item, resultIndex }) => ({
      kind: "item" as const,
      key: `item:${item.kind ?? "app"}:${item.path}:${item.name}`,
      item,
      resultIndex,
      categoryId: category.id,
    })));
  }

  const fileEntries = results
    .map((item, resultIndex) => ({ item, resultIndex }))
    .filter(({ item }) => item.kind === "file" || item.kind === "folder");
  const filesByCategory = new Map<string, typeof fileEntries>();
  for (const entry of fileEntries) {
    const categoryId = fileCategoryIdFromNormalized(entry.item, normalized);
    if (!categoryId) continue;
    const bucket = filesByCategory.get(categoryId);
    if (bucket) bucket.push(entry);
    else filesByCategory.set(categoryId, [entry]);
  }

  for (const category of normalized) {
    const matches = (filesByCategory.get(category.id) ?? [])
      .sort((a, b) => compareFileModifiedDescending(a.item, b.item));
    if (matches.length === 0) continue;
    const categoryId = `file.${category.id}`;
    const collapsed = collapsedCategoryIds.has(categoryId);
    rows.push({
      kind: "category",
      key: `category:${categoryId}`,
      categoryId,
      label: category.label,
      translationKey: `fileSearch.category.${category.id}`,
      count: matches.length,
      collapsed,
    });
    if (collapsed) continue;
    rows.push(...matches.map(({ item, resultIndex }) => ({
      kind: "item" as const,
      key: `item:${item.kind}:${item.path}:${item.name}`,
      item,
      resultIndex,
      categoryId,
    })));
  }

  return rows;
}

export function selectedLauncherItem(
  rows: LauncherResultRow[],
  selectedRowIndex: number,
): AppEntry | null {
  const row = rows[selectedRowIndex];
  return row?.kind === "item" ? row.item : null;
}

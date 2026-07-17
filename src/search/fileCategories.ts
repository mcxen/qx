import type { AppEntry } from "../store";
import type { FileSearchCategory } from "../modules/settings/store";

export const DEFAULT_FILE_SEARCH_CATEGORIES: FileSearchCategory[] = [
  {
    id: "folders",
    label: "Folders",
    extensions: [],
    include_folders: true,
  },
  {
    id: "media",
    label: "Multimedia",
    extensions: ["mp4", "mov", "m4v", "mkv", "avi", "webm", "mp3", "m4a", "wav", "aac", "flac", "ogg"],
  },
  {
    id: "code",
    label: "Code",
    extensions: ["rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "swift", "c", "cc", "cpp", "h", "hpp", "cs", "rb", "php", "vue", "svelte", "astro", "json", "yml", "yaml", "toml", "html", "css", "scss", "sql"],
  },
  {
    id: "office",
    label: "Office",
    extensions: ["doc", "docx", "dot", "dotx", "rtf", "odt", "pages", "xls", "xlsx", "xlsm", "xlsb", "csv", "tsv", "ods", "numbers", "ppt", "pptx", "pps", "ppsx", "key", "odp", "pdf"],
  },
  {
    id: "images",
    label: "Images",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "heif", "tif", "tiff", "bmp", "svg"],
  },
  {
    id: "archives",
    label: "Archives",
    extensions: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "dmg", "pkg"],
  },
  { id: "other", label: "Other Files", extensions: [], catch_all: true },
];

export function normalizeFileSearchCategories(
  categories: FileSearchCategory[] | null | undefined,
): FileSearchCategory[] {
  const source = Array.isArray(categories) && categories.length > 0
    ? categories
    : DEFAULT_FILE_SEARCH_CATEGORIES;
  const seen = new Set<string>();
  const normalized = source.flatMap((category, index) => {
    const id = category?.id?.trim();
    const label = category?.label?.trim();
    if (!id || !label || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label,
      extensions: Array.from(new Set(
        (Array.isArray(category.extensions) ? category.extensions : [])
          .map((extension) => extension.trim().replace(/^\.+/, "").toLowerCase())
          .filter(Boolean),
      )),
      ...(category.include_folders ? { include_folders: true } : {}),
      ...(category.catch_all ? { catch_all: true } : {}),
      order: index,
    }];
  });
  if (!normalized.some((category) => category.catch_all)) {
    normalized.push({
      id: "other",
      label: "Other Files",
      extensions: [],
      catch_all: true,
      order: normalized.length,
    });
  }
  return normalized.map(({ order: _order, ...category }) => category);
}

export function fileExtensionFromEntry(entry: AppEntry): string {
  if (entry.kind !== "file") return "";
  const leaf = (entry.name || entry.path.split(/[\\/]/).pop() || "").trim();
  const dot = leaf.lastIndexOf(".");
  return dot > 0 && dot < leaf.length - 1 ? leaf.slice(dot + 1).toLowerCase() : "";
}

export function fileCategoryId(
  entry: AppEntry,
  categories: FileSearchCategory[],
): string | null {
  return fileCategoryIdFromNormalized(entry, normalizeFileSearchCategories(categories));
}

/** Hot-path classifier for callers that already normalized the category list. */
export function fileCategoryIdFromNormalized(
  entry: AppEntry,
  normalized: FileSearchCategory[],
): string | null {
  if (entry.kind === "folder") {
    return normalized.find((category) => category.include_folders)?.id
      ?? normalized.find((category) => category.catch_all)?.id
      ?? null;
  }
  if (entry.kind !== "file") return null;
  const extension = fileExtensionFromEntry(entry);
  return normalized.find(
    (category) => !category.catch_all && category.extensions.includes(extension),
  )?.id ?? normalized.find((category) => category.catch_all)?.id ?? null;
}

export function compareFileModifiedDescending(a: AppEntry, b: AppEntry): number {
  const aModified = typeof a.modified_at === "number" ? a.modified_at : 0;
  const bModified = typeof b.modified_at === "number" ? b.modified_at : 0;
  if (aModified !== bModified) return bModified - aModified;
  return (a.display_name || a.name).localeCompare(b.display_name || b.name, "zh-Hans", {
    sensitivity: "base",
  });
}

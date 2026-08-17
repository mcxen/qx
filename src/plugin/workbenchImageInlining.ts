import { invoke } from "@tauri-apps/api/core";
import type {
  PluginWorkbenchContentBlock,
  PluginWorkbenchDetail,
  PluginWorkbenchImage,
  PluginWorkbenchReplyContent,
} from "./workbenchTypes";
import { utf8TextToBase64 } from "./workbenchHtmlExport";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_CONCURRENCY = 4;

interface PluginHttpImageResponse {
  status: number;
  ok: boolean;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  body_base64?: string;
}

export interface WorkbenchImageInliningProgress {
  completed: number;
  total: number;
}

export interface WorkbenchImageLoaders {
  remote: (url: string) => Promise<string>;
  asset: (assetPath: string) => Promise<string>;
}

export class WorkbenchImageInliningError extends Error {
  readonly failed: number;
  readonly total: number;

  constructor(failed: number, total: number) {
    super(`Could not embed ${failed} of ${total} Workbench images`);
    this.name = "WorkbenchImageInliningError";
    this.failed = failed;
    this.total = total;
  }
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  const target = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === target);
  return String(entry?.[1] || "");
}

function normalizeImageMime(value: string): string | undefined {
  const mime = value.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime || !/^image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(mime)) {
    return undefined;
  }
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/vnd.microsoft.icon") return "image/x-icon";
  return mime;
}

function mimeFromAssetPath(path: string): string | undefined {
  const extension = path.split(/[?#]/, 1)[0]?.split(".").pop()?.toLowerCase();
  return normalizeImageMime({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
  }[extension || ""] || "");
}

function mimeFromBase64Prefix(value: string): string | undefined {
  try {
    const bytes = Uint8Array.from(atob(value.slice(0, 64)), (character) => character.charCodeAt(0));
    const ascii = String.fromCharCode(...bytes);
    if (bytes[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
    if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
    if (ascii.startsWith("BM")) return "image/bmp";
    if (ascii.slice(4, 12) === "ftypavif" || ascii.slice(4, 12) === "ftypavis") return "image/avif";
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
      return "image/x-icon";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function validateImageBase64(value: string, declaredMime?: string): string {
  if (!value || base64ByteLength(value) > MAX_IMAGE_BYTES) {
    throw new Error("image exceeds export limit");
  }
  const detectedMime = mimeFromBase64Prefix(value);
  if (!detectedMime || (declaredMime && detectedMime !== declaredMime)) {
    throw new Error("image bytes do not match a supported image type");
  }
  return detectedMime;
}

function validateInlineDataImage(url: string): string {
  const match = url.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  const declaredMime = normalizeImageMime(match?.[1] || "");
  if (!match || !declaredMime) throw new Error("unsupported inline image data");
  validateImageBase64(match[2], declaredMime);
  return url;
}

async function fetchRemoteImage(url: string): Promise<string> {
  const response = await invoke<PluginHttpImageResponse>("plugin_http_fetch", {
    req: {
      url,
      method: "GET",
      headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      timeout_ms: 45_000,
      max_bytes: MAX_IMAGE_BYTES,
    },
  });
  if (!response.ok) throw new Error(`image HTTP ${response.status || "error"}`);
  const contentType = normalizeImageMime(headerValue(response.headers, "content-type"));
  let dataBase64 = String(response.bodyBase64 || response.body_base64 || "");
  if (!dataBase64 && contentType && response.body != null) dataBase64 = utf8TextToBase64(response.body);
  if (!dataBase64) throw new Error("image response did not contain binary data");
  const mime = validateImageBase64(dataBase64, contentType);
  return `data:${mime};base64,${dataBase64}`;
}

async function readPluginAssetImage(pluginId: string, assetPath: string): Promise<string> {
  const mime = mimeFromAssetPath(assetPath);
  if (!mime) throw new Error("plugin asset is not a supported image");
  const resolved = await invoke<{ path: string }>("plugin_resolve_asset", {
    id: pluginId,
    assetPath,
  });
  const dataBase64 = await invoke<string>("plugin_file_read_base64", {
    id: pluginId,
    path: resolved.path,
  });
  validateImageBase64(dataBase64, mime);
  return `data:${mime};base64,${dataBase64}`;
}

function collectSources(detail: PluginWorkbenchDetail): { urls: Set<string>; assets: Set<string>; dataUrls: Set<string> } {
  const urls = new Set<string>();
  const assets = new Set<string>();
  const dataUrls = new Set<string>();
  const addImage = (image: PluginWorkbenchImage | undefined) => {
    if (image && /^https:\/\//i.test(image.url)) urls.add(image.url);
    if (image && /^data:image\//i.test(image.url)) dataUrls.add(image.url);
  };
  const addContent = (content: PluginWorkbenchContentBlock[] | PluginWorkbenchReplyContent[] | undefined) => {
    for (const block of content || []) {
      if (block.type === "image") addImage(block.image);
      if (block.type === "asset-image") assets.add(block.assetPath);
    }
  };
  addImage(detail.image);
  detail.images?.forEach(addImage);
  addContent(detail.content);
  detail.replies?.items.forEach((reply) => addContent(reply.content));
  return { urls, assets, dataUrls };
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, onSettled: () => void): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      } finally {
        onSettled();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, tasks.length) }, worker));
  return results;
}

function inlineImage(image: PluginWorkbenchImage | undefined, resolved: Map<string, string>) {
  if (!image) return undefined;
  return /^https:\/\//i.test(image.url)
    ? { ...image, url: resolved.get(`url:${image.url}`) || image.url }
    : image;
}

function inlineContent<T extends PluginWorkbenchContentBlock | PluginWorkbenchReplyContent>(
  content: T[] | undefined,
  resolved: Map<string, string>,
): PluginWorkbenchContentBlock[] | undefined {
  return content?.map((block) => {
    if (block.type === "image") return { ...block, image: inlineImage(block.image, resolved)! };
    if (block.type === "asset-image") {
      return {
        type: "image" as const,
        image: {
          url: resolved.get(`asset:${block.assetPath}`) || "",
          alt: block.alt,
          fit: "contain" as const,
        },
      };
    }
    return block;
  });
}

/** Resolve every non-inline detail/reply image before HTML serialization. */
export async function inlineWorkbenchDetailImages(
  pluginId: string,
  detail: PluginWorkbenchDetail,
  onProgress?: (progress: WorkbenchImageInliningProgress) => void,
  loaders: WorkbenchImageLoaders = {
    remote: fetchRemoteImage,
    asset: (path) => readPluginAssetImage(pluginId, path),
  },
): Promise<PluginWorkbenchDetail> {
  const { urls, assets, dataUrls } = collectSources(detail);
  const entries = [
    ...[...urls].map((url) => ({ key: `url:${url}`, countBytes: true, load: () => loaders.remote(url) })),
    ...[...assets].map((path) => ({ key: `asset:${path}`, countBytes: true, load: () => loaders.asset(path) })),
    ...[...dataUrls].map((url) => ({ key: `data:${url}`, countBytes: false, load: async () => validateInlineDataImage(url) })),
  ];
  if (!entries.length) return detail;
  let completed = 0;
  onProgress?.({ completed, total: entries.length });
  let resolvedBytes = 0;
  let budgetExceeded = false;
  const results = await runBounded(entries.map((entry) => async () => {
    if (budgetExceeded) throw new Error("offline image budget exceeded");
    const value = await entry.load();
    if (entry.countBytes) {
      resolvedBytes += base64ByteLength(value.slice(value.indexOf(",") + 1));
      if (resolvedBytes > MAX_TOTAL_IMAGE_BYTES) {
        budgetExceeded = true;
        throw new Error("Workbench images exceed the 64 MiB offline export limit");
      }
    }
    return value;
  }), () => {
    completed += 1;
    onProgress?.({ completed, total: entries.length });
  });
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed) throw new WorkbenchImageInliningError(failed, entries.length);
  const resolved = new Map<string, string>();
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    resolved.set(entries[index].key, result.value);
  });
  return {
    ...detail,
    image: inlineImage(detail.image, resolved),
    images: detail.images?.map((image) => inlineImage(image, resolved)!),
    content: inlineContent(detail.content, resolved),
    replies: detail.replies ? {
      ...detail.replies,
      items: detail.replies.items.map((reply) => ({
        ...reply,
        content: inlineContent(reply.content, resolved),
      })),
    } : undefined,
  };
}

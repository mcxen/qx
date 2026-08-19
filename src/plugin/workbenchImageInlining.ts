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
const BROWSER_IMAGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
  remote: (url: string, referer?: string) => Promise<string>;
  asset: (assetPath: string) => Promise<string>;
  referer?: string;
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

/** Magic bytes win when they disagree with Content-Type, matching SingleFile. */
export function selectImageMime(detected?: string, declared?: string): string {
  const mime = detected || declared;
  if (!mime) throw new Error("image bytes do not match a supported image type");
  return mime;
}

function validateImageBase64(value: string, declaredMime?: string): string {
  if (!value || base64ByteLength(value) > MAX_IMAGE_BYTES) {
    throw new Error("image exceeds export limit");
  }
  return selectImageMime(mimeFromBase64Prefix(value), declaredMime);
}

function validateInlineDataImage(url: string): string {
  const match = url.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  const declaredMime = normalizeImageMime(match?.[1] || "");
  if (!match || !declaredMime) throw new Error("unsupported inline image data");
  validateImageBase64(match[2], declaredMime);
  return url;
}

export function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Resolve src / srcset / protocol-relative / relative image URLs against a document URL. */
export function resolveRemoteImageUrl(value: string, baseUrl?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^(?:data:|blob:|asset:|file:)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function lastSrcsetCandidate(value: string): string {
  const candidates = value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
  return candidates[candidates.length - 1] ?? "";
}

function documentReferer(url: string, explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed && isRemoteHttpUrl(trimmed)) return trimmed;
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return undefined;
  }
}

async function fetchRemoteImage(url: string, referer?: string): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "User-Agent": BROWSER_IMAGE_UA,
  };
  const refererValue = documentReferer(url, referer);
  if (refererValue) headers.Referer = refererValue;
  const response = await invoke<PluginHttpImageResponse>("plugin_http_fetch", {
    req: {
      url,
      method: "GET",
      headers,
      timeout_ms: 45_000,
      max_bytes: MAX_IMAGE_BYTES,
    },
  });
  if (!response.ok) throw new Error(`image HTTP ${response.status || "error"}`);
  const contentType = normalizeImageMime(headerValue(response.headers, "content-type"));
  let dataBase64 = String(response.bodyBase64 || response.body_base64 || "");
  if (!dataBase64 && response.body) dataBase64 = utf8TextToBase64(response.body);
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

function htmlImageSource(element: Element, baseUrl?: string): string | null {
  const source =
    element.getAttribute("data-qx-remote-src")
    || element.getAttribute("data-src")
    || element.getAttribute("data-original")
    || element.getAttribute("data-lazy-src")
    || element.getAttribute("data-url")
    || element.getAttribute("src")
    || lastSrcsetCandidate(element.getAttribute("data-srcset") || element.getAttribute("srcset") || "");
  return resolveRemoteImageUrl(source, baseUrl);
}

/** Remote images from a sanitized HTML fragment, including lazy-load attributes. */
export function collectHtmlRemoteImageUrls(html: string, baseUrl?: string): string[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const urls = new Set<string>();
  doc.querySelectorAll("img, source").forEach((element) => {
    const source = htmlImageSource(element, baseUrl);
    if (source) urls.add(source);
  });
  return [...urls];
}

export function rewriteHtmlRemoteImages(
  html: string,
  resolved: Map<string, string>,
  baseUrl?: string,
): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("img, source").forEach((element) => {
    const source = htmlImageSource(element, baseUrl);
    const dataUrl = source ? resolved.get(source) : undefined;
    if (!dataUrl) return;
    element.setAttribute("src", dataUrl);
    for (const name of [
      "srcset",
      "data-srcset",
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-url",
      "data-qx-remote-src",
    ]) {
      element.removeAttribute(name);
    }
  });
  return doc.body ? doc.body.innerHTML : html;
}

function collectSources(detail: PluginWorkbenchDetail): { urls: Set<string>; assets: Set<string>; dataUrls: Set<string> } {
  const urls = new Set<string>();
  const assets = new Set<string>();
  const dataUrls = new Set<string>();
  const addImage = (image: PluginWorkbenchImage | undefined) => {
    if (image && isRemoteHttpUrl(image.url)) urls.add(image.url);
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

async function embedResolvedEntries(
  entries: Array<{ key: string; countBytes: boolean; load: () => Promise<string> }>,
  onProgress?: (progress: WorkbenchImageInliningProgress) => void,
): Promise<Map<string, string>> {
  if (!entries.length) return new Map();
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
  return resolved;
}

function inlineImage(image: PluginWorkbenchImage | undefined, resolved: Map<string, string>) {
  if (!image) return undefined;
  return isRemoteHttpUrl(image.url)
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

/** Fetch unique remote images and rewrite a sanitized HTML fragment to data URIs. */
export async function inlineRemoteImagesInHtml(
  html: string,
  options: {
    baseUrl?: string;
    referer?: string;
    onProgress?: (progress: WorkbenchImageInliningProgress) => void;
    load?: (url: string, referer?: string) => Promise<string>;
  } = {},
): Promise<string> {
  const urls = collectHtmlRemoteImageUrls(html, options.baseUrl);
  const load = options.load || fetchRemoteImage;
  const referer = options.referer || options.baseUrl;
  const resolved = await embedResolvedEntries(
    urls.map((url) => ({
      key: url,
      countBytes: true,
      load: () => load(url, referer),
    })),
    options.onProgress,
  );
  return rewriteHtmlRemoteImages(html, resolved, options.baseUrl);
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
    ...[...urls].map((url) => ({
      key: `url:${url}`,
      countBytes: true,
      load: () => loaders.remote(url, loaders.referer),
    })),
    ...[...assets].map((path) => ({ key: `asset:${path}`, countBytes: true, load: () => loaders.asset(path) })),
    ...[...dataUrls].map((url) => ({ key: `data:${url}`, countBytes: false, load: async () => validateInlineDataImage(url) })),
  ];
  const resolved = await embedResolvedEntries(entries, onProgress);
  if (!entries.length) return detail;
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

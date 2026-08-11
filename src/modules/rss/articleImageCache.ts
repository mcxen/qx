import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const sourcePromises = new Map<string, Promise<string>>();
const decodePromises = new Map<string, Promise<void>>();

function cacheKey(url: string): string {
  return url.trim();
}

/**
 * Fetch through the Rust RSS image cache once, then keep the decoded local
 * resource warm for every reader image that uses the same remote URL.
 */
export function resolveArticleImage(url: string, referer?: string | null): Promise<string> {
  const key = cacheKey(url);
  const existing = sourcePromises.get(key);
  if (existing) return existing;

  const pending = invoke<string>("rss_cache_article_image", {
    url: key,
    referer: referer || null,
  })
    .then(convertFileSrc)
    .catch((error) => {
      sourcePromises.delete(key);
      throw error;
    });
  sourcePromises.set(key, pending);
  return pending;
}

function decodeLocalImage(source: string): Promise<void> {
  const existing = decodePromises.get(source);
  if (existing) return existing;
  if (typeof Image === "undefined") return Promise.resolve();

  const pending = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const decoded = image.decode?.();
      if (decoded) {
        void decoded.then(() => resolve(), reject);
      } else {
        resolve();
      }
    };
    image.onerror = () => reject(new Error(`Failed to load cached RSS image: ${source}`));
    image.src = source;
  }).catch((error) => {
    decodePromises.delete(source);
    throw error;
  });
  decodePromises.set(source, pending);
  return pending;
}

/** Resolves a Rust-cached image only after the WebView has decoded it. */
export async function prepareArticleImage(url: string, referer?: string | null): Promise<string> {
  const source = await resolveArticleImage(url, referer);
  await decodeLocalImage(source);
  return source;
}

/**
 * Start bounded, best-effort Rust cache requests before an article is opened.
 * Rendering never awaits this work; visible images reuse the same promises.
 */
export function prewarmArticleImages(
  urls: Iterable<string>,
  referer?: string | null,
  limit = 6,
): void {
  const unique = new Set<string>();
  for (const url of urls) {
    const key = cacheKey(url);
    if (!key || unique.has(key)) continue;
    unique.add(key);
    if (unique.size >= limit) break;
  }
  for (const url of unique) {
    void prepareArticleImage(url, referer).catch(() => {});
  }
}

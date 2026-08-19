#!/usr/bin/env node
/**
 * Offline HTML export contracts: Workbench structured images and first-party
 * HTML (RSS) share one embedder. Saved files must not keep live image URLs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const inliner = read("src/plugin/workbenchImageInlining.ts");
const rssUtils = read("src/modules/rss/article-utils.ts");
const rssList = read("src/modules/rss/ArticleList.tsx");
const workbenchHook = read("src/plugin/useWorkbenchHtmlExportAction.ts");
const hostExport = read("src/plugin/offlineHtmlExport.ts");
const htmlExport = read("src/plugin/workbenchHtmlExport.ts");
const pluginApi = read("src-tauri/src/plugin_api.rs");

assert.match(inliner, /export async function inlineRemoteImagesInHtml/);
assert.match(inliner, /headers\.Referer/);
assert.match(inliner, /User-Agent/);
assert.match(inliner, /isRemoteHttpUrl/);
assert.match(inliner, /data-qx-remote-src/);
assert.match(inliner, /const mime = detected \|\| declared/);
assert.match(rssUtils, /inlineRemoteImagesInHtml/);
assert.match(rssUtils, /referer:\s*article\.link/);
assert.doesNotMatch(rssUtils, /createObjectURL/);
assert.match(rssList, /runHostOfflineHtmlExport/);
assert.match(rssList, /buildOfflineArticleHtml/);
assert.match(workbenchHook, /runHostOfflineHtmlExport/);
assert.match(workbenchHook, /inlineWorkbenchDetailImages/);
assert.match(hostExport, /plugin_system_save_download/);
assert.match(htmlExport, /function renderImage/);
assert.match(htmlExport, /data:image/);
assert.match(pluginApi, /fn encode_http_response_body/);
assert.match(pluginApi, /Ok\(text\) if image/);

function resolveRemoteImageUrl(value, baseUrl) {
  const trimmed = value.trim();
  if (!trimmed || /^(?:data:|blob:|asset:|file:)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function lastSrcsetCandidate(value) {
  const candidates = value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);
  return candidates[candidates.length - 1] ?? "";
}

assert.equal(
  resolveRemoteImageUrl("//cdn.example.com/a.png", "https://news.example.com/p"),
  "https://cdn.example.com/a.png",
);
assert.equal(
  resolveRemoteImageUrl("http://img.example.com/a.jpg"),
  "http://img.example.com/a.jpg",
);
assert.equal(
  resolveRemoteImageUrl("/media/hero.webp", "https://blog.example.com/posts/1"),
  "https://blog.example.com/media/hero.webp",
);
assert.equal(resolveRemoteImageUrl("data:image/png;base64,aaa"), null);
assert.equal(
  lastSrcsetCandidate("a.jpg 1x, https://cdn.example.com/b.jpg 2x"),
  "https://cdn.example.com/b.jpg",
);

const savedHtml = `<img src="https://cdn.example.com/live.jpg" alt="keep">`;
assert.match(rssUtils, /offlineContent/);
assert.doesNotMatch(hostExport, /src=\{image\.url\}/);
assert.ok(!savedHtml.includes("data:image"), "fixture remains a live URL until the inliner rewrites it");

console.log("workbench html export checks passed.");

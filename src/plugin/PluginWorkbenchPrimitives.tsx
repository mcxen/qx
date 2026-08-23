import { useEffect, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { resolveActivityPercent } from "../types/contentActivity";
import type {
  PluginWorkbenchAsyncStatus,
  PluginWorkbenchImage,
} from "./workbenchTypes";

const workbenchImageCache = new Map<string, Promise<string>>();
const WORKBENCH_IMAGE_CACHE_LIMIT = 512;
const WORKBENCH_IMAGE_CONCURRENCY = 4;
const queuedImageRequests: Array<() => void> = [];
let activeImageRequests = 0;

function drainImageRequests(): void {
  while (activeImageRequests < WORKBENCH_IMAGE_CONCURRENCY && queuedImageRequests.length) {
    activeImageRequests += 1;
    queuedImageRequests.shift()?.();
  }
}

function runBoundedImageRequest<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queuedImageRequests.push(() => {
      void work()
        .then(resolve, reject)
        .finally(() => {
          activeImageRequests = Math.max(0, activeImageRequests - 1);
          drainImageRequests();
        });
    });
    drainImageRequests();
  });
}

export function resolveWorkbenchImageUrl(pluginId: string, url: string): Promise<string> {
  if (!/^https:\/\//i.test(url)) return Promise.resolve(url);
  const key = `${pluginId}\0${url}`;
  const existing = workbenchImageCache.get(key);
  if (existing) return existing;
  const request = runBoundedImageRequest(() => (
    invoke<string>("plugin_workbench_cache_image", { id: pluginId, url })
  ))
    .then((path) => convertFileSrc(path))
    .catch(() => {
      workbenchImageCache.delete(key);
      return url;
    });
  workbenchImageCache.set(key, request);
  if (workbenchImageCache.size > WORKBENCH_IMAGE_CACHE_LIMIT) {
    const oldest = workbenchImageCache.keys().next().value;
    if (oldest) workbenchImageCache.delete(oldest);
  }
  return request;
}

export function WorkbenchCachedImage({
  pluginId,
  url,
  alt,
  className,
  loading,
  style,
  onError,
}: {
  pluginId: string;
  url: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  style?: CSSProperties;
  onError?: () => void;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string>();
  const [usedFallback, setUsedFallback] = useState(false);
  useEffect(() => {
    let active = true;
    setResolvedUrl(undefined);
    setUsedFallback(false);
    void resolveWorkbenchImageUrl(pluginId, url).then((resolved) => {
      if (active) setResolvedUrl(resolved);
    });
    return () => { active = false; };
  }, [pluginId, url]);
  if (!resolvedUrl) return null;
  return (
    <img
      src={resolvedUrl}
      alt={alt}
      className={className}
      loading={loading}
      style={style}
      onError={() => {
        if (!usedFallback && resolvedUrl !== url) {
          workbenchImageCache.delete(`${pluginId}\0${url}`);
          setUsedFallback(true);
          setResolvedUrl(url);
          return;
        }
        onError?.();
      }}
    />
  );
}

export function workbenchToneClass(tone: string | undefined): string {
  return tone && tone !== "neutral" ? ` tone-${tone}` : "";
}

export function WorkbenchStatus({ status }: { status?: PluginWorkbenchAsyncStatus }) {
  if (!status) return null;
  const progress = resolveActivityPercent(status);
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
      {progress != null ? <span>{Math.round(progress)}%</span> : null}
    </div>
  );
}

export function WorkbenchListMedia({
  pluginId,
  images,
}: {
  pluginId: string;
  images: PluginWorkbenchImage[];
}) {
  return (
    <span className="qx-host-workbench-list-media" aria-hidden="true">
      {images.map((image, index) => (
        <span className="qx-host-workbench-list-media-image" key={`${image.url}-${index}`}>
          <WorkbenchCachedImage
            pluginId={pluginId}
            url={image.url}
            alt=""
            loading="lazy"
            style={{ objectFit: image.fit || "cover" }}
          />
        </span>
      ))}
    </span>
  );
}

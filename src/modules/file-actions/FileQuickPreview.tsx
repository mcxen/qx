import { useEffect, useMemo, useRef, useState } from "react";
import { File, Folder, TriangleAlert } from "lucide-react";
import pptxWorkerUrl from "@file-viewer/pptx/worker/pptx.worker.js?url";
import { Button, LoadingSpinner } from "../../components/ui";
import { useT } from "../../i18n";
import {
  getFilePreviewInfo,
  getFolderPreview,
  readFilePreview,
  type FilePreviewInfo,
  type FolderPreview,
  type SelectedFile,
} from "../../system";

type PreviewPayload = {
  info: FilePreviewInfo;
  buffer?: ArrayBuffer;
  folder?: FolderPreview;
};

const IMAGE = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const VIDEO = new Set(["m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"]);
const AUDIO = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"]);
const ARCHIVE = new Set(["7z", "bz2", "cb7", "cbr", "cbz", "gz", "rar", "tar", "tgz", "xz", "zip"]);
const DOCX = new Set(["docx", "docm", "dotx", "dotm"]);
const SHEET = new Set(["xlsm", "xlsx"]);
const DELIMITED = new Set(["csv", "tsv"]);
const PPTX = new Set(["potm", "potx", "ppsm", "ppsx", "pptm", "pptx"]);
const TEXT = new Set([
  "c", "cc", "conf", "cpp", "css", "csv", "go", "h", "hpp", "html", "ini", "java", "js", "json",
  "jsx", "log", "md", "mjs", "py", "rb", "rs", "sh", "sql", "swift", "toml", "ts", "tsx", "txt",
  "vue", "xml", "yaml", "yml",
]);

function needsPreviewBytes(extension: string): boolean {
  return !extension || IMAGE.has(extension) || VIDEO.has(extension) || AUDIO.has(extension)
    || ARCHIVE.has(extension) || DOCX.has(extension) || SHEET.has(extension) || PPTX.has(extension)
    || TEXT.has(extension) || DELIMITED.has(extension) || extension === "pdf";
}

function formatBytes(value?: number | null): string {
  if (value == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function mimeFor(extension: string): string {
  const values: Record<string, string> = {
    avif: "image/avif", gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png",
    svg: "image/svg+xml", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav",
    pdf: "application/pdf",
  };
  return values[extension] ?? "application/octet-stream";
}

function BlobMedia({ payload, kind }: { payload: PreviewPayload; kind: "image" | "video" | "audio" }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([payload.buffer!], { type: mimeFor(payload.info.extension) })), [payload]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  if (kind === "image") return <img className="qx-file-preview-image" src={url} alt={payload.info.name} />;
  if (kind === "video") return <video className="qx-file-preview-video" src={url} controls autoPlay={false} />;
  return <audio className="qx-file-preview-audio" src={url} controls autoPlay={false} />;
}

function PdfPreview({ buffer }: { buffer: ArrayBuffer }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([buffer], { type: "application/pdf" })), [buffer]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <iframe className="qx-file-preview-pdf" src={url} title="PDF" />;
}

function DocxPreview({ buffer }: { buffer: ArrayBuffer }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.replaceChildren();
    void import("docx-preview")
      .then(({ renderAsync }) => renderAsync(buffer.slice(0), root, undefined, { breakPages: true, ignoreLastRenderedPageBreak: true }))
      .catch((cause) => setError(String(cause)));
    return () => root.replaceChildren();
  }, [buffer]);
  return error ? <PreviewError message={error} /> : <div ref={rootRef} className="qx-file-preview-docx" />;
}

type PreviewSheet = { sheet: string; data: unknown[][] };

function SheetPreview({ buffer }: { buffer: ArrayBuffer }) {
  const t = useT();
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const sheetsRef = useRef<PreviewSheet[]>([]);
  useEffect(() => {
    void import("read-excel-file/browser").then(async ({ default: readExcelFile }) => {
      const sheets = await readExcelFile(buffer) as PreviewSheet[];
      sheetsRef.current = sheets;
      setSheetNames(sheets.map((sheet) => sheet.sheet));
      setActive(0);
      setRows(sheets[0]?.data ?? []);
    }).catch((cause) => setError(String(cause)));
  }, [buffer]);
  const selectSheet = (index: number) => {
    setActive(index);
    setRows(sheetsRef.current[index]?.data ?? []);
  };
  if (error) return <PreviewError message={error} />;
  return (
    <div className="qx-file-preview-sheet">
      <div className="qx-file-preview-tabs" aria-label={t("filePreview.sheets", "Sheets")}>
        {sheetNames.map((name, index) => <Button key={name} size="sm" variant={active === index ? "secondary" : "ghost"} onClick={() => selectSheet(index)}>{name}</Button>)}
      </div>
      <div className="qx-file-preview-table-wrap"><table><tbody>{rows.slice(0, 1000).map((row, rowIndex) => <tr key={rowIndex}>{row.slice(0, 100).map((cell, columnIndex) => <td key={columnIndex}>{String(cell)}</td>)}</tr>)}</tbody></table></div>
    </div>
  );
}

function PptxPreview({ buffer }: { buffer: ArrayBuffer }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let viewer: { destroy: () => void; setZoom: (percent: number) => Promise<void> } | undefined;
    let slideWidth = 0;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame = 0;
    const root = rootRef.current;
    if (!root) return;
    const fitToWidth = () => {
      if (!viewer || !slideWidth || !root.clientWidth) return;
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        const percent = Math.max(25, Math.min(300, (root.clientWidth / slideWidth) * 100));
        void viewer?.setZoom(percent);
      });
    };
    void import("@file-viewer/pptx").then(async ({ PptxViewer }) => {
      viewer = await PptxViewer.open(buffer.slice(0), root, {
        workerUrl: pptxWorkerUrl,
        fitMode: "contain",
        lazySlides: true,
        listOptions: { windowed: true, initialSlides: 3, batchSize: 3 },
        onSlideSize: (size) => {
          const width = Number(size.width);
          if (Number.isFinite(width) && width > 0) slideWidth = width;
          fitToWidth();
        },
        onSlideRendered: () => fitToWidth(),
      });
      resizeObserver = new ResizeObserver(fitToWidth);
      resizeObserver.observe(root);
      fitToWidth();
    }).catch((cause) => setError(String(cause)));
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      viewer?.destroy();
      root.replaceChildren();
    };
  }, [buffer]);
  return error ? <PreviewError message={error} /> : <div ref={rootRef} className="qx-file-preview-pptx" />;
}

type ArchiveListEntry = { file?: { name?: string; size?: number }; path?: string };

function ArchivePreview({ buffer, name }: { buffer: ArrayBuffer; name: string }) {
  const t = useT();
  const [entries, setEntries] = useState<ArchiveListEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let reader: { getFilesArray: () => Promise<ArchiveListEntry[]>; close: () => Promise<void> } | undefined;
    let cancelled = false;
    void import("libarchive.js").then(async ({ Archive }) => {
      Archive.init({ workerUrl: "/vendor/libarchive/worker-bundle.js" });
      reader = await Archive.open(new globalThis.File([buffer], name));
      const next = await reader.getFilesArray();
      if (!cancelled) setEntries(next.slice(0, 5000));
    }).catch((cause) => setError(String(cause)));
    return () => { cancelled = true; void reader?.close(); };
  }, [buffer, name]);
  if (error) return <PreviewError message={error} />;
  return (
    <div className="qx-file-preview-entries">
      <div className="qx-file-preview-list-head"><span>{t("filePreview.archiveEntry", "Archive entry")}</span><span>{t("filePreview.size", "Size")}</span></div>
      {entries.map((entry, index) => <div className="qx-file-preview-entry" key={`${entry.path}:${entry.file?.name}:${index}`}><File size={15} /><span>{entry.path ?? ""}{entry.file?.name ?? ""}</span><small>{formatBytes(entry.file?.size)}</small></div>)}
    </div>
  );
}

function FolderPreviewView({ folder }: { folder: FolderPreview }) {
  return <div className="qx-file-preview-entries">{folder.entries.map((entry) => <div className="qx-file-preview-entry" key={entry.name}>{entry.kind === "folder" ? <Folder size={15} /> : <File size={15} />}<span>{entry.name}</span><small>{formatBytes(entry.size)}</small></div>)}</div>;
}

function PreviewError({ message }: { message: string }) {
  return <div className="qx-file-preview-state is-error"><TriangleAlert size={24} /><span>{message}</span></div>;
}

export default function FileQuickPreview({ revision, index, item }: { revision: number; index: number; item: SelectedFile }) {
  const t = useT();
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);
    const timer = window.setTimeout(() => {
      void getFilePreviewInfo(revision, index).then(async (info) => {
        const next: PreviewPayload = { info };
        if (info.kind === "folder") next.folder = await getFolderPreview(revision, index);
        else if (needsPreviewBytes(info.extension)) next.buffer = await readFilePreview(
          revision,
          index,
          (TEXT.has(info.extension) || DELIMITED.has(info.extension) || !info.extension) ? 1024 * 1024 : undefined,
        );
        if (!cancelled) setPayload(next);
      }).catch((cause) => { if (!cancelled) setError(String(cause)); });
    }, 100);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [index, revision]);

  if (error) return <PreviewError message={error} />;
  if (!payload) return <div className="qx-file-preview-state"><LoadingSpinner size={24} /><span>{t("filePreview.loading", "Loading preview…")}</span></div>;
  const { info } = payload;
  let content: React.ReactNode;
  if (info.kind === "folder" && payload.folder) content = <FolderPreviewView folder={payload.folder} />;
  else if (IMAGE.has(info.extension)) content = <BlobMedia payload={payload} kind="image" />;
  else if (VIDEO.has(info.extension)) content = <BlobMedia payload={payload} kind="video" />;
  else if (AUDIO.has(info.extension)) content = <BlobMedia payload={payload} kind="audio" />;
  else if (info.extension === "pdf") content = <PdfPreview buffer={payload.buffer!} />;
  else if (DOCX.has(info.extension)) content = <DocxPreview buffer={payload.buffer!} />;
  else if (SHEET.has(info.extension)) content = <SheetPreview buffer={payload.buffer!} />;
  else if (PPTX.has(info.extension)) content = <PptxPreview buffer={payload.buffer!} />;
  else if (ARCHIVE.has(info.extension)) content = <ArchivePreview buffer={payload.buffer!} name={info.name} />;
  else if (TEXT.has(info.extension) || DELIMITED.has(info.extension) || !info.extension) {
    const bytes = new Uint8Array(payload.buffer!, 0, Math.min(payload.buffer!.byteLength, 1024 * 1024));
    content = <pre className="qx-file-preview-text">{new TextDecoder().decode(bytes)}{(info.size ?? 0) > bytes.byteLength ? "\n…" : ""}</pre>;
  } else content = <div className="qx-file-preview-state"><File size={32} /><strong>{t("filePreview.noRenderer", "No inline renderer for this format")}</strong><span>{t("filePreview.noRendererHint", "Metadata is available; open the file in its default app for full access.")}</span></div>;

  return (
    <main className="qx-file-preview">
      <header className="qx-file-preview-head"><div><h2>{item.name}</h2><p>{item.path}</p></div><dl><div><dt>{t("filePreview.type", "Type")}</dt><dd>{info.kind === "folder" ? t("filePreview.folder", "Folder") : info.extension.toUpperCase() || t("filePreview.file", "File")}</dd></div><div><dt>{t("filePreview.size", "Size")}</dt><dd>{formatBytes(info.size)}</dd></div></dl></header>
      <section className="qx-file-preview-surface">{content}</section>
    </main>
  );
}

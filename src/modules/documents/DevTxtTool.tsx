import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { useT } from "../../i18n";
import { getQxShortcutPreset, isEditableTarget } from "../../utils/keyboard";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";

/**
 * Disk-backed Text Toolbox — isolated from main launcher performance:
 * - Lazy module (not loaded until opened)
 * - All disk IO via async invoke on Tauri blocking pool (never sync on UI thread)
 * - Writes are fire-and-forget + per-file coalesce queue (never await on tab switch / file switch / Esc)
 * - Read uses generation tokens (stale results discarded)
 * - Hard size cap (~1.5MB) so huge files never enter React state
 */

export type DocLanguage =
  | "plain"
  | "markdown"
  | "json"
  | "sql"
  | "javascript"
  | "typescript"
  | "java"
  | "python"
  | "rust"
  | "go"
  | "html"
  | "css"
  | "xml"
  | "yaml"
  | "shell"
  | "c"
  | "cpp"
  | "csharp"
  | "kotlin"
  | "swift";

type TextFileEntry = {
  name: string;
  path: string;
  language: string;
  size: number;
  createdAt: number;
  updatedAt: number;
};

type FocusRegion = "docs-files" | "docs-editor" | "docs-actions";

/** Progress underline pinned to a file row (by name, not selection index). */
type SaveBarPhase = "writing" | "complete";
type SaveBarEntry = { phase: SaveBarPhase; gen: number };

type JsonCheckResult = {
  ok: boolean;
  message?: string | null;
  line?: number | null;
  column?: number | null;
};

type TextInspectResult = {
  chars: number;
  lines: number;
  words: number;
  bytes: number;
  language: string;
  json?: JsonCheckResult | null;
};

/** Keep in sync with `MAX_FILE_BYTES` in text_toolbox.rs */
const MAX_FILE_BYTES = 1_500_000;
const SAVE_DEBOUNCE_MS = 600;
/** Debounce island inspect (stats + JSON via serde_json) so typing stays free. */
const INSPECT_DEBOUNCE_MS = 480;
/** How long the finish flash stays after disk write returns. */
const SAVE_BAR_FINISH_MS = 320;

const LANGUAGES: { id: DocLanguage; labelKey: string; label: string }[] = [
  { id: "plain", labelKey: "docs.lang.plain", label: "Plain text" },
  { id: "markdown", labelKey: "docs.lang.markdown", label: "Markdown" },
  { id: "json", labelKey: "docs.lang.json", label: "JSON" },
  { id: "sql", labelKey: "docs.lang.sql", label: "SQL" },
  { id: "javascript", labelKey: "docs.lang.javascript", label: "JavaScript" },
  { id: "typescript", labelKey: "docs.lang.typescript", label: "TypeScript" },
  { id: "java", labelKey: "docs.lang.java", label: "Java" },
  { id: "python", labelKey: "docs.lang.python", label: "Python" },
  { id: "rust", labelKey: "docs.lang.rust", label: "Rust" },
  { id: "go", labelKey: "docs.lang.go", label: "Go" },
  { id: "html", labelKey: "docs.lang.html", label: "HTML" },
  { id: "css", labelKey: "docs.lang.css", label: "CSS" },
  { id: "xml", labelKey: "docs.lang.xml", label: "XML" },
  { id: "yaml", labelKey: "docs.lang.yaml", label: "YAML" },
  { id: "shell", labelKey: "docs.lang.shell", label: "Shell" },
  { id: "c", labelKey: "docs.lang.c", label: "C" },
  { id: "cpp", labelKey: "docs.lang.cpp", label: "C++" },
  { id: "csharp", labelKey: "docs.lang.csharp", label: "C#" },
  { id: "kotlin", labelKey: "docs.lang.kotlin", label: "Kotlin" },
  { id: "swift", labelKey: "docs.lang.swift", label: "Swift" },
];

function isDocLanguage(v: string): v is DocLanguage {
  return LANGUAGES.some((l) => l.id === v);
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function languageLabel(id: string, t: (k: string, f: string) => string): string {
  const meta = LANGUAGES.find((l) => l.id === id);
  return meta ? t(meta.labelKey, meta.label) : id;
}

function defaultNewName(existing: TextFileEntry[]): string {
  let n = existing.length + 1;
  const names = new Set(existing.map((f) => f.name.toLowerCase()));
  while (names.has(`untitled ${n}.txt`) || names.has(`untitled ${n}`)) {
    n += 1;
  }
  return `Untitled ${n}`;
}

function patchFileList(prev: TextFileEntry[], entry: TextFileEntry): TextFileEntry[] {
  const idx = prev.findIndex((f) => f.name === entry.name);
  if (idx === -1) {
    return [entry, ...prev];
  }
  if (prev[idx] === entry) return prev;
  const next = prev.slice();
  next[idx] = entry;
  return next;
}

export default function DevTxtTool() {
  const t = useT();
  const setTab = useStore((state) => state.setTab);
  const [files, setFiles] = useState<TextFileEntry[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [focusRegion, setFocusRegion] = useState<FocusRegion>("docs-files");
  /** File-name → save underline (stays on that row even if selection moves). */
  const [saveBars, setSaveBars] = useState<Record<string, SaveBarEntry>>({});
  /** Debounced inspect from Rust (serde_json for JSON). */
  const [inspect, setInspect] = useState<TextInspectResult | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectGenRef = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(content);
  const selectedNameRef = useRef(selectedName);
  const dirtyRef = useRef(dirty);
  const mountedRef = useRef(true);
  const loadGenRef = useRef(0);
  const listGenRef = useRef(0);
  /** Latest body waiting to flush, keyed by file name (coalesces rapid edits). */
  const pendingWritesRef = useRef(new Map<string, string>());
  /** Names currently mid-write (max one in-flight drain per file). */
  const writingRef = useRef(new Set<string>());
  /** Explicit Cmd/Ctrl+S targets — show progress bar for these names only. */
  const indicateWritesRef = useRef(new Set<string>());
  const saveBarTimersRef = useRef(new Map<string, number>());
  const actionMenuShortcut = getQxShortcutPreset().actionMenu;

  contentRef.current = content;
  selectedNameRef.current = selectedName;
  dirtyRef.current = dirty;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const tid of saveBarTimersRef.current.values()) {
        window.clearTimeout(tid);
      }
      saveBarTimersRef.current.clear();
    };
  }, []);

  const flash = useCallback((detail: string) => {
    if (!mountedRef.current) return;
    setMessage(detail);
    window.setTimeout(() => {
      if (mountedRef.current) setMessage("");
    }, 1400);
  }, []);

  /** Start underline on a specific file row (pinned by name). */
  const startSaveBar = useCallback((name: string) => {
    const prevTimer = saveBarTimersRef.current.get(name);
    if (prevTimer) {
      window.clearTimeout(prevTimer);
      saveBarTimersRef.current.delete(name);
    }
    setSaveBars((prev) => ({
      ...prev,
      [name]: { phase: "writing", gen: (prev[name]?.gen ?? 0) + 1 },
    }));
  }, []);

  /** Disk done → quick finish flash on the same row, then remove. */
  const finishSaveBar = useCallback((name: string) => {
    setSaveBars((prev) => {
      if (!prev[name]) return prev;
      return { ...prev, [name]: { ...prev[name], phase: "complete" } };
    });
    const prevTimer = saveBarTimersRef.current.get(name);
    if (prevTimer) window.clearTimeout(prevTimer);
    const tid = window.setTimeout(() => {
      setSaveBars((prev) => {
        if (!prev[name] || prev[name].phase !== "complete") return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
      saveBarTimersRef.current.delete(name);
    }, SAVE_BAR_FINISH_MS);
    saveBarTimersRef.current.set(name, tid);
  }, []);

  /**
   * Non-blocking disk write queue. Never awaited by UI navigation.
   * Coalesces multiple edits to the same file into the latest body.
   * `indicate: true` (Cmd/Ctrl+S) shows a progress bar on that file's list row.
   */
  const queueWrite = useCallback(
    (name: string, body: string, opts?: { indicate?: boolean }) => {
      if (!name) return;
      if (body.length > MAX_FILE_BYTES) {
        flash(t("docs.tooLarge", "File too large to save here (max ~1.5 MB)"));
        return;
      }
      if (opts?.indicate) {
        indicateWritesRef.current.add(name);
        startSaveBar(name);
      }
      pendingWritesRef.current.set(name, body);

      const drain = async (fileName: string) => {
        if (writingRef.current.has(fileName)) return;
        writingRef.current.add(fileName);
        try {
          while (pendingWritesRef.current.has(fileName)) {
            const latest = pendingWritesRef.current.get(fileName);
            if (latest === undefined) break;
            pendingWritesRef.current.delete(fileName);
            try {
              const entry = await invoke<TextFileEntry>("docs_write_file", {
                name: fileName,
                content: latest,
              });
              if (!mountedRef.current) continue;
              // Clear dirty only if this is still the open buffer and matches what we wrote.
              if (
                selectedNameRef.current === fileName
                && contentRef.current === latest
              ) {
                setDirty(false);
              }
              setFiles((prev) => patchFileList(prev, entry));
            } catch (err) {
              if (mountedRef.current) flash(String(err));
            }
          }
        } finally {
          writingRef.current.delete(fileName);
          if (pendingWritesRef.current.has(fileName)) {
            void drain(fileName);
          } else if (indicateWritesRef.current.has(fileName)) {
            // All coalesced writes for this file finished — flash complete on same row.
            indicateWritesRef.current.delete(fileName);
            if (mountedRef.current) finishSaveBar(fileName);
          }
        }
      };

      void drain(name);
    },
    [finishSaveBar, flash, startSaveBar, t],
  );

  const queueCurrentIfDirty = useCallback(() => {
    const name = selectedNameRef.current;
    if (!name || !dirtyRef.current) return;
    queueWrite(name, contentRef.current);
  }, [queueWrite]);

  /**
   * Explicit Cmd/Ctrl+S: always write current buffer and pin the progress bar
   * to that file name (never jumps to another row if selection changes mid-save).
   */
  const saveExplicit = useCallback(() => {
    const name = selectedNameRef.current;
    if (!name) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const body = contentRef.current;
    // Bar is pinned to `name` for the whole write; selection can move freely.
    queueWrite(name, body, { indicate: true });
  }, [queueWrite]);

  const refreshList = useCallback(
    async (preferName?: string | null) => {
      const gen = ++listGenRef.current;
      if (mountedRef.current) setLoadingList(true);
      try {
        const list = await invoke<TextFileEntry[]>("docs_list_files");
        if (!mountedRef.current || gen !== listGenRef.current) return list;
        setFiles(list);
        const prefer = preferName ?? selectedNameRef.current;
        if (prefer && list.some((f) => f.name === prefer)) {
          setSelectedName(prefer);
        } else if (list.length > 0) {
          setSelectedName((prev) =>
            prev && list.some((f) => f.name === prev) ? prev : list[0].name,
          );
        } else {
          setSelectedName(null);
          setContent("");
          setDirty(false);
        }
        return list;
      } catch (err) {
        if (mountedRef.current && gen === listGenRef.current) flash(String(err));
        return [] as TextFileEntry[];
      } finally {
        if (mountedRef.current && gen === listGenRef.current) {
          setLoadingList(false);
        }
      }
    },
    [flash],
  );

  const loadFile = useCallback(
    async (name: string | null, knownSize?: number) => {
      const gen = ++loadGenRef.current;
      if (!name) {
        if (gen === loadGenRef.current) {
          setContent("");
          setDirty(false);
          setLoadingFile(false);
        }
        return;
      }
      if (typeof knownSize === "number" && knownSize > MAX_FILE_BYTES) {
        if (gen === loadGenRef.current) {
          setContent("");
          setDirty(false);
          setLoadingFile(false);
          flash(t("docs.tooLarge", "File too large to open here (max ~1.5 MB)"));
        }
        return;
      }
      setLoadingFile(true);
      try {
        const text = await invoke<string>("docs_read_file", { name });
        // Stale read — user already moved on; discard to avoid thrashing React.
        if (gen !== loadGenRef.current || !mountedRef.current) return;
        setContent(text);
        setDirty(false);
      } catch (err) {
        if (gen !== loadGenRef.current || !mountedRef.current) return;
        flash(String(err));
        setContent("");
        setDirty(false);
      } finally {
        if (gen === loadGenRef.current && mountedRef.current) {
          setLoadingFile(false);
        }
      }
    },
    [flash, t],
  );

  // Bootstrap workspace + list (only while this module is mounted)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = await invoke<string>("docs_workspace_path");
        if (!cancelled && mountedRef.current) setWorkspacePath(path);
      } catch {
        // non-fatal
      }
      if (!cancelled) await refreshList();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList]);

  // Load content when selection changes — never blocks selection itself
  useEffect(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const meta = files.find((f) => f.name === selectedName);
    void loadFile(selectedName, meta?.size);
  }, [selectedName]); // eslint-disable-line react-hooks/exhaustive-deps -- load on name only

  // Debounced background auto-save (never awaited by UI)
  useEffect(() => {
    if (!dirty || !selectedName) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      queueCurrentIfDirty();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, dirty, selectedName, queueCurrentIfDirty]);

  // On leave: snapshot dirty buffer and fire-and-forget write (do not await)
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      loadGenRef.current += 1; // cancel any in-flight read applying to unmounted UI
      const name = selectedNameRef.current;
      if (name && dirtyRef.current) {
        const body = contentRef.current;
        if (body.length <= MAX_FILE_BYTES) {
          void invoke("docs_write_file", { name, content: body }).catch(() => {});
        }
      }
    };
  }, []);

  // Deep-links: optional language on open
  useEffect(() => {
    const launch = takePendingModuleLaunch("documents");
    if (!launch) return;
    const langMap: Record<string, DocLanguage> = {
      clean: "plain",
      markdown: "markdown",
      json: "json",
      sql: "sql",
      java: "java",
    };
    const lang = langMap[launch.surface];
    if (!lang) return;
    void (async () => {
      try {
        const list = await refreshList();
        if (list.length === 0) {
          const entry = await invoke<TextFileEntry>("docs_create_file", {
            name: defaultNewName([]),
            language: lang,
          });
          await refreshList(entry.name);
          return;
        }
        const active = selectedNameRef.current ?? list[0]?.name;
        if (!active) return;
        const entry = await invoke<TextFileEntry>("docs_set_language", {
          name: active,
          language: lang,
        });
        await refreshList(entry.name);
        flash(
          t("docs.langSet", "Language: {lang}").replace(
            "{lang}",
            languageLabel(lang, t),
          ),
        );
      } catch (err) {
        flash(String(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.name.toLowerCase().includes(q)
        || f.language.toLowerCase().includes(q),
    );
  }, [files, query]);

  const selectedIndex = Math.max(
    0,
    filtered.findIndex((f) => f.name === selectedName),
  );
  const active = files.find((f) => f.name === selectedName) ?? null;
  const listFocused = focusRegion === "docs-files" || focusRegion === "docs-actions";

  // Island: file stats + JSON check (serde_json). Debounced — never blocks typing.
  useEffect(() => {
    if (!active) {
      setInspect(null);
      return;
    }
    if (inspectTimer.current) clearTimeout(inspectTimer.current);
    const gen = ++inspectGenRef.current;
    const language = active.language || "plain";
    const body = content;
    inspectTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await invoke<TextInspectResult>("docs_inspect_text", {
            content: body,
            language,
          });
          if (!mountedRef.current || gen !== inspectGenRef.current) return;
          setInspect(result);
        } catch {
          if (!mountedRef.current || gen !== inspectGenRef.current) return;
          setInspect({
            chars: body.length,
            lines: body ? body.split(/\r?\n/).length : 0,
            words: body.trim() ? body.trim().split(/\s+/).length : 0,
            bytes: new TextEncoder().encode(body).length,
            language,
            json: null,
          });
        }
      })();
    }, INSPECT_DEBOUNCE_MS);
    return () => {
      if (inspectTimer.current) clearTimeout(inspectTimer.current);
    };
  }, [content, active]);

  /** Instant selection — previous dirty buffer is queued, never awaited. */
  const selectFile = useCallback(
    (name: string) => {
      if (name === selectedNameRef.current) return;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      queueCurrentIfDirty();
      setSelectedName(name);
    },
    [queueCurrentIfDirty],
  );

  const createNewFile = useCallback(
    async (language: DocLanguage = "plain") => {
      queueCurrentIfDirty();
      try {
        const entry = await invoke<TextFileEntry>("docs_create_file", {
          name: defaultNewName(files),
          language,
        });
        // Local list update first (snappy); full refresh optional
        setFiles((prev) => [entry, ...prev.filter((f) => f.name !== entry.name)]);
        setSelectedName(entry.name);
        setQuery("");
        setContent("");
        setDirty(false);
        window.requestAnimationFrame(() => editorRef.current?.focus());
      } catch (err) {
        flash(String(err));
      }
    },
    [files, flash, queueCurrentIfDirty],
  );

  const deleteActive = useCallback(async () => {
    if (!active) return;
    if (
      !window.confirm(
        t("docs.confirmDelete", "Delete “{name}”?").replace("{name}", active.name),
      )
    ) {
      return;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingWritesRef.current.delete(active.name);
    setDirty(false);
    try {
      await invoke("docs_delete_file", { name: active.name });
      const next = files.filter((f) => f.name !== active.name);
      setFiles(next);
      setSelectedName(next[0]?.name ?? null);
      if (next.length === 0) setContent("");
      flash(t("docs.deleted", "Deleted"));
    } catch (err) {
      flash(String(err));
    }
  }, [active, files, flash, t]);

  const pasteClipboard = async () => {
    try {
      const value = await readText();
      const next = value ?? "";
      if (next.length > MAX_FILE_BYTES) {
        flash(t("docs.tooLarge", "Clipboard too large (max ~1.5 MB)"));
        return;
      }
      setContent(next);
      setDirty(true);
      flash(t("docs.pasted", "Pasted"));
    } catch (error) {
      flash(String(error));
    }
  };

  const copyAll = async () => {
    if (!content) return;
    await writeText(content);
    flash(t("docs.copied", "Copied"));
  };

  const openWorkspace = () => {
    // Fire-and-forget open; refresh list when process returns (no UI wait chain)
    void invoke<string>("docs_open_workspace")
      .then((path) => {
        if (mountedRef.current) {
          setWorkspacePath(path);
          flash(t("docs.openFolder", "Open folder"));
        }
        return refreshList(selectedNameRef.current);
      })
      .catch((err) => {
        if (mountedRef.current) flash(String(err));
      });
  };

  const setLanguage = async (lang: DocLanguage) => {
    if (!active) return;
    queueCurrentIfDirty();
    try {
      const entry = await invoke<TextFileEntry>("docs_set_language", {
        name: active.name,
        language: lang,
      });
      setFiles((prev) => {
        const withoutOld = prev.filter(
          (f) => f.name !== active.name && f.name !== entry.name,
        );
        return [entry, ...withoutOld];
      });
      setSelectedName(entry.name);
      flash(
        t("docs.langSet", "Language: {lang}").replace(
          "{lang}",
          languageLabel(lang, t),
        ),
      );
    } catch (err) {
      flash(String(err));
    }
  };

  /** Leave immediately — do not wait for disk. */
  const goBack = () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    queueCurrentIfDirty();
    setTab("launcher");
  };

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: renamingName !== null,
      close: () => setRenamingName(null),
    },
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: goBack,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.defaultPrevented || e.key === "Escape") return;
    const region =
      e.target instanceof Element
        ? e.target.closest<HTMLElement>("[data-qx-region]")?.dataset.qxRegion
        : undefined;
    const editing = isEditableTarget(e.target) && region === "docs-editor";

    if (!editing && (region === "docs-files" || region === "docs-actions" || !region)) {
      if (e.key === "ArrowDown" && filtered.length > 0) {
        e.preventDefault();
        const next = Math.min(selectedIndex + 1, filtered.length - 1);
        selectFile(filtered[next].name);
      } else if (e.key === "ArrowUp" && filtered.length > 0) {
        e.preventDefault();
        const next = Math.max(selectedIndex - 1, 0);
        selectFile(filtered[next].name);
      } else if (e.key === "Enter" && region === "docs-files") {
        e.preventDefault();
        editorRef.current?.focus();
      } else if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void createNewFile();
      }
    }

    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      e.stopPropagation();
      saveExplicit();
    }
  };

  const onFocusCapture = (e: React.FocusEvent) => {
    const region = (e.target as Element)
      .closest?.<HTMLElement>("[data-qx-region]")
      ?.dataset.qxRegion as FocusRegion | undefined;
    if (region === "docs-files" || region === "docs-editor" || region === "docs-actions") {
      setFocusRegion(region);
    }
  };

  const startRename = (file: TextFileEntry) => {
    setRenamingName(file.name);
    setRenameDraft(file.name);
  };

  const commitRename = async () => {
    if (!renamingName) return;
    const next = renameDraft.trim();
    if (!next || next === renamingName) {
      setRenamingName(null);
      return;
    }
    queueCurrentIfDirty();
    try {
      const entry = await invoke<TextFileEntry>("docs_rename_file", {
        name: renamingName,
        newName: next,
      });
      setRenamingName(null);
      setFiles((prev) => {
        const without = prev.filter(
          (f) => f.name !== renamingName && f.name !== entry.name,
        );
        return [entry, ...without];
      });
      setSelectedName(entry.name);
    } catch (err) {
      flash(String(err));
      setRenamingName(null);
    }
  };

  const languageActions = useMemo<QxShellAction[]>(
    () =>
      LANGUAGES.map((lang) => ({
        label: t(lang.labelKey, lang.label),
        disabled: !active || active.language === lang.id,
        onClick: () => void setLanguage(lang.id),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, t],
  );

  const listActions = useMemo<QxShellAction[]>(
    () => [
      {
        label: t("docs.newFile", "New File"),
        kbd: "N",
        onClick: () => void createNewFile(),
      },
      {
        label: t("docs.rename", "Rename"),
        disabled: !active,
        onClick: () => active && startRename(active),
      },
      {
        label: t("docs.openFolder", "Open folder"),
        onClick: () => openWorkspace(),
      },
      {
        label: t("docs.refresh", "Refresh list"),
        onClick: () => void refreshList(selectedNameRef.current),
      },
      {
        label: t("docs.deleteFile", "Delete File"),
        tone: "danger" as const,
        disabled: !active,
        onClick: () => void deleteActive(),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, createNewFile, deleteActive, refreshList, t],
  );

  const editorActions = useMemo<QxShellAction[]>(
    () => [
      {
        label: t("docs.paste", "Paste"),
        disabled: !active,
        onClick: () => void pasteClipboard(),
      },
      {
        label: t("docs.copyAll", "Copy All"),
        disabled: !content,
        onClick: () => void copyAll(),
      },
      {
        label: t("docs.language", "Language"),
      },
      ...languageActions.map((a) => ({
        ...a,
        label: `  ${a.label}`,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, content, languageActions, t],
  );

  const documentActions = listFocused ? listActions : editorActions;
  const actionTitle = listFocused
    ? t("docs.actions.list", "List actions")
    : t("docs.actions.editor", "Editor actions");

  const island = useMemo<BottomIslandContent>(() => {
    if (message) {
      return {
        label: message,
        detail: active?.name,
        tone: "success",
      };
    }
    if (!active) {
      return {
        label: t("docs.island", "Text Toolbox"),
        detail: workspacePath || t("docs.noFile", "No file"),
        tone: "neutral",
      };
    }

    const chars = inspect?.chars ?? content.length;
    const lines = inspect?.lines ?? (content ? content.split(/\r?\n/).length : 0);
    const words = inspect?.words ?? 0;
    const bytes = inspect?.bytes ?? content.length;
    const sizeLabel = formatBytes(active.size || bytes);
    const metaParts = [
      sizeLabel,
      `${lines.toLocaleString()} ${t("docs.stat.lines", "lines")}`,
      `${chars.toLocaleString()} ${t("docs.stat.chars", "chars")}`,
      words > 0 ? `${words.toLocaleString()} ${t("docs.stat.words", "words")}` : null,
      active.createdAt
        ? `${t("docs.stat.created", "created")} ${formatTime(active.createdAt)}`
        : null,
      active.updatedAt
        ? `${t("docs.stat.updated", "updated")} ${formatTime(active.updatedAt)}`
        : null,
    ].filter(Boolean);

    const json = inspect?.json;
    if (active.language === "json" && json && !json.ok) {
      const where =
        json.line != null
          ? `L${json.line}${json.column != null ? `:${json.column}` : ""}`
          : "";
      const errMsg = (json.message || t("docs.json.invalid", "Invalid JSON")).replace(
        /^[Ee]rror:\s*/,
        "",
      );
      return {
        label: where
          ? t("docs.json.errorAt", "JSON · {where}").replace("{where}", where)
          : t("docs.json.error", "JSON error"),
        detail: `${errMsg} · ${metaParts.join(" · ")}`,
        tone: "danger" as const,
      };
    }

    if (active.language === "json" && json?.ok && content.trim()) {
      return {
        label: dirty
          ? `${t("docs.json.ok", "JSON OK")} · ${t("docs.dirty", "Unsaved")}`
          : t("docs.json.ok", "JSON OK"),
        detail: `${active.name} · ${metaParts.join(" · ")}`,
        tone: dirty ? ("warning" as const) : ("success" as const),
      };
    }

    return {
      label: dirty
        ? `${active.name} · ${t("docs.dirty", "Unsaved")}`
        : `${active.name} · ${languageLabel(active.language, t)}`,
      detail: metaParts.join(" · "),
      tone: dirty ? ("warning" as const) : ("neutral" as const),
    };
  }, [active, content, dirty, inspect, message, t, workspacePath]);

  return (
    <QxShell
      title={t("docs.title", "Text Toolbox")}
      className="documents-shell"
      visual="solid"
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      onKeyDown={onKeyDown}
      search={
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus={false}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocusRegion("docs-files")}
            placeholder={t("docs.searchFiles", "Search files…")}
            className="qx-plugin-search"
          />
        </div>
      }
      trailing={
        <>
          {active ? (
            <span className="qx-shell-meta">
              {languageLabel(active.language, t)}
              {dirty ? ` · ${t("docs.dirty", "Unsaved")}` : ""}
            </span>
          ) : null}
          <button
            className="qx-command-button"
            type="button"
            onClick={() => openWorkspace()}
            title={workspacePath || t("docs.openFolder", "Open folder")}
          >
            {t("docs.openFolder", "Open folder")}
          </button>
          <button
            className="qx-command-button primary"
            type="button"
            onClick={() => void createNewFile()}
          >
            {t("docs.newFile", "New File")}
          </button>
          {message ? (
            <div className="qx-clipboard-status" aria-live="polite">
              {message}
            </div>
          ) : null}
        </>
      }
      context={
        <div
          className="qx-action-panel"
          data-qx-region="docs-actions"
          data-qx-region-label={t("docs.actions", "File actions")}
          data-qx-region-scroll
          tabIndex={-1}
        >
          <div className="qx-action-title">{t("docs.workspace", "Workspace")}</div>
          <div className="v2ex-context-copy" style={{ marginBottom: 8 }}>
            <span style={{ wordBreak: "break-all", fontSize: 11 }}>
              {workspacePath || "…"}
            </span>
          </div>
          <button className="qx-action-item" type="button" onClick={() => openWorkspace()}>
            <span>{t("docs.openFolder", "Open folder")}</span>
          </button>
          <button
            className="qx-action-item"
            type="button"
            onClick={() => void refreshList(selectedNameRef.current)}
          >
            <span>{t("docs.refresh", "Refresh list")}</span>
          </button>

          <div className="qx-action-title" style={{ marginTop: 10 }}>
            {t("docs.file", "File")}
          </div>
          {active ? (
            <div className="v2ex-context-copy" style={{ marginBottom: 8 }}>
              <strong>{active.name}</strong>
              <span>
                {languageLabel(active.language, t)} · {formatBytes(active.size)}
              </span>
              <span>
                {t("docs.stat.updated", "updated")} {formatTime(active.updatedAt)}
                {active.createdAt
                  ? ` · ${t("docs.stat.created", "created")} ${formatTime(active.createdAt)}`
                  : ""}
              </span>
              <span>
                {(inspect?.chars ?? content.length).toLocaleString()}{" "}
                {t("docs.stat.chars", "chars")}
                {inspect
                  ? ` · ${inspect.lines.toLocaleString()} ${t("docs.stat.lines", "lines")}`
                  : ""}
                {inspect?.words
                  ? ` · ${inspect.words.toLocaleString()} ${t("docs.stat.words", "words")}`
                  : ""}
                {dirty ? ` · ${t("docs.dirty", "Unsaved")}` : ""}
              </span>
              {active.language === "json" && inspect?.json && !inspect.json.ok ? (
                <span style={{ color: "var(--qx-danger, #ef4444)" }}>
                  {inspect.json.line != null
                    ? `JSON L${inspect.json.line}${
                        inspect.json.column != null ? `:${inspect.json.column}` : ""
                      }`
                    : "JSON"}
                  {": "}
                  {(inspect.json.message || "").replace(/^[Ee]rror:\s*/, "")}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="qx-ai-tool-hint">{t("docs.noFile", "No file selected")}</div>
          )}

          <div className="qx-action-title">{t("docs.language", "Language")}</div>
          <div className="qx-docs-lang-hint">
            {t(
              "docs.language.hint",
              "Changing language renames the extension. List focus → file ops; editor focus → content ops.",
            )}
          </div>
          <div className="qx-ai-tool-chips" style={{ marginBottom: 10 }}>
            {LANGUAGES.slice(0, 8).map((lang) => (
              <button
                key={lang.id}
                type="button"
                className={`qx-docs-lang-chip${active?.language === lang.id ? " is-active" : ""}`}
                disabled={!active}
                onClick={() => void setLanguage(lang.id)}
              >
                {t(lang.labelKey, lang.label)}
              </button>
            ))}
          </div>

          <div className="qx-action-title">{t("common.actions", "Actions")}</div>
          <button className="qx-action-item" type="button" onClick={() => void createNewFile()}>
            <span>{t("docs.newFile", "New File")}</span>
            <kbd>N</kbd>
          </button>
          <button
            className="qx-action-item"
            type="button"
            disabled={!active}
            onClick={() => active && startRename(active)}
          >
            <span>{t("docs.rename", "Rename")}</span>
          </button>
          <button
            className="qx-action-item"
            type="button"
            disabled={!active}
            onClick={() => void pasteClipboard()}
          >
            <span>{t("docs.paste", "Paste")}</span>
          </button>
          <button
            className="qx-action-item"
            type="button"
            disabled={!content}
            onClick={() => void copyAll()}
          >
            <span>{t("docs.copyAll", "Copy All")}</span>
          </button>
          <button
            className="qx-action-item danger"
            type="button"
            disabled={!active}
            onClick={() => void deleteActive()}
          >
            <span>{t("docs.deleteFile", "Delete File")}</span>
          </button>
        </div>
      }
      island={island}
      primaryAction={
        listFocused
          ? {
              label: t("docs.newFile", "New File"),
              tone: "primary",
              onClick: () => void createNewFile(),
            }
          : {
              label: t("docs.copyAll", "Copy All"),
              disabled: !content,
              tone: "primary",
              onClick: () => void copyAll(),
            }
      }
      secondaryAction={{
        label: t("common.actions", "Actions"),
        kbd: actionMenuShortcut,
      }}
      actionTitle={actionTitle}
      actions={documentActions}
      navigation={{
        index: selectedIndex < 0 ? 0 : selectedIndex,
        count: filtered.length,
        onChange: (i) => {
          const file = filtered[i];
          if (file) selectFile(file.name);
        },
        pageSize: 10,
      }}
    >
      <div className="qx-content-split qx-docs-split" onFocusCapture={onFocusCapture}>
        <div
          className="qx-plugin-list qx-docs-file-list"
          data-qx-region="docs-files"
          data-qx-region-label={t("docs.files", "Files")}
          data-qx-region-initial="true"
          data-qx-region-scroll
          tabIndex={-1}
        >
          <div className="qx-section-header">
            <span style={{ flex: 1 }}>{t("docs.files", "Files")}</span>
            <span>{loadingList ? "…" : filtered.length}</span>
          </div>
          {filtered.map((file) => {
            const activeRow = file.name === selectedName;
            const renaming = renamingName === file.name;
            const oversized = file.size > MAX_FILE_BYTES;
            const saveBar = saveBars[file.name];
            return (
              <button
                key={file.name}
                type="button"
                className={`qx-list-row qx-docs-file-row${activeRow ? " is-active" : ""}${
                  saveBar ? " is-saving" : ""
                }`}
                onClick={() => selectFile(file.name)}
                onDoubleClick={() => !oversized && startRename(file)}
                onFocus={() => setFocusRegion("docs-files")}
              >
                <span className="qx-list-copy">
                  {renaming ? (
                    <input
                      className="qx-inline-input qx-docs-rename-input"
                      value={renameDraft}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingName(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="qx-list-title">{file.name}</span>
                  )}
                  <span className="qx-list-subtitle">
                    {oversized
                      ? t("docs.tooLargeShort", "Too large")
                      : languageLabel(
                          isDocLanguage(file.language) ? file.language : "plain",
                          t,
                        )}{" "}
                    · {formatTime(file.updatedAt)}
                  </span>
                </span>
                {/* Pinned by file.name — does not follow selection if user switches mid-save */}
                {saveBar ? (
                  <span
                    key={`save-bar-${file.name}-${saveBar.gen}`}
                    className={`qx-docs-save-bar is-${saveBar.phase}`}
                    aria-hidden="true"
                  >
                    <span className="qx-docs-save-bar-fill" />
                  </span>
                ) : null}
              </button>
            );
          })}
          {filtered.length === 0 && !loadingList && (
            <div className="qx-empty-state">
              {query.trim()
                ? t("docs.noMatch", "No matching files")
                : t(
                    "docs.emptyFiles",
                    "No files yet. Create one, or open the folder and drop text files in.",
                  )}
            </div>
          )}
        </div>

        <div
          className="qx-docs-workspace"
          data-qx-region="docs-editor"
          data-qx-region-label={t("docs.editor", "Editor")}
          data-qx-region-scroll
          tabIndex={-1}
        >
          <div className="qx-docs-workspace-head">
            <span className="qx-docs-workspace-title">
              {active?.name ?? t("docs.noFile", "No file")}
              {active ? (
                <span className="qx-docs-lang-badge">
                  {languageLabel(active.language, t)}
                </span>
              ) : null}
              {dirty ? (
                <span className="qx-docs-lang-badge is-dirty">
                  {t("docs.dirty", "Unsaved")}
                </span>
              ) : null}
            </span>
            <span className="qx-docs-workspace-meta">
              {loadingFile
                ? "…"
                : inspect
                  ? `${inspect.lines} ${t("docs.stat.lines", "lines")} · ${inspect.chars} ${t("docs.stat.chars", "chars")}`
                  : `${content.length} ${t("docs.stat.chars", "chars")}`}
            </span>
          </div>
          <textarea
            ref={editorRef}
            className="qx-documents-textarea-full"
            data-language={active?.language ?? "plain"}
            value={content}
            autoFocus={false}
            onFocus={() => {
              setFocusRegion("docs-editor");
              requestPanelKeyWindow();
            }}
            onChange={(e) => {
              const next = e.target.value;
              if (next.length > MAX_FILE_BYTES) {
                flash(t("docs.tooLarge", "File too large (max ~1.5 MB)"));
                return;
              }
              setContent(next);
              setDirty(true);
            }}
            spellCheck={
              !active
              || active.language === "plain"
              || active.language === "markdown"
            }
            placeholder={t(
              "docs.editor.placeholder",
              "Disk-backed edit — files live in ~/Documents/Qx Text Toolbox",
            )}
            aria-label={t("docs.editor", "Editor")}
            disabled={!active || loadingFile || (active != null && active.size > MAX_FILE_BYTES)}
          />
        </div>
      </div>
    </QxShell>
  );
}

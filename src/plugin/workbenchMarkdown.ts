import { MarkdownManager } from "@tiptap/markdown";
import { Link } from "@tiptap/extension-link";
import {
  ListKit,
  type TaskItemOptions,
} from "@tiptap/extension-list";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";
import { createDocument, getSchema, Extension } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";

/**
 * The Workbench editor stores Markdown, not a Tiptap document.  Tiptap is
 * only the editing representation while a card is open.  Keeping this
 * boundary in one module prevents a plugin from accidentally persisting
 * ProseMirror JSON or HTML.
 */

export type WorkbenchMarkdownUnsupportedReason =
  | "image"
  | "html"
  | "table"
  | "dangerous-link"
  | "unknown-token"
  | "parse-error";

export interface WorkbenchMarkdownAnalysis {
  safe: boolean;
  document?: JSONContent;
  reason?: WorkbenchMarkdownUnsupportedReason;
}

const supportedTokenTypes = new Set([
  "space",
  "heading",
  "paragraph",
  "text",
  "strong",
  "em",
  "del",
  "codespan",
  "br",
  "code",
  "blockquote",
  "list",
  "list_item",
  "taskList",
  "taskItem",
  "legacyTaskList",
  "checkbox",
  "link",
  "url",
  "escape",
  "hr",
  "underlineHtml",
]);

const unsafeSchemePattern = /^(?:javascript|data|vbscript):/i;

/**
 * Markdown notes may use `<u>...</u>` for underline. Tiptap's built-in
 * Underline extension uses `++...++` for Markdown, so the host registers a
 * small tokenizer that preserves the source convention without replacing
 * Tiptap's parser with a regex-only Markdown implementation.
 */
const WorkbenchUnderline = Underline.extend({
  markdownTokenName: "underlineHtml",
  parseMarkdown: (token, helpers) => (
    helpers.applyMark("underline", helpers.parseInline(token.tokens || []))
  ),
  renderMarkdown: (node, helpers) => `<u>${helpers.renderChildren(node)}</u>`,
  markdownTokenizer: {
    name: "underlineHtml",
    level: "inline",
    start: (source: string) => source.search(/<u\s*>/i),
    tokenize(source, _tokens, lexer) {
      const match = /^<u\s*>([\s\S]*?)<\/u\s*>/i.exec(source);
      if (!match) return undefined;
      return {
        type: "underlineHtml",
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },
});

/**
 * BluePrint's Xianji endpoint also accepts the compact legacy checklist
 * spelling `[] item` / `[x] item`. Marked's standard
 * task tokenizer requires `- [ ]`, so this narrow block tokenizer maps only
 * checklist lines to Tiptap task nodes and leaves all other Markdown to the
 * real parser.
 */
const LegacyTaskList = Extension.create({
  name: "legacyTaskList",
  markdownTokenName: "legacyTaskList",
  parseMarkdown: (token, helpers) => (
    helpers.createNode("taskList", {}, helpers.parseChildren(token.items || []))
  ),
  markdownTokenizer: {
    name: "legacyTaskList",
    level: "block",
    // Leave `- [ ]` to the official ListKit tokenizer so nested standard
    // task lists retain their hierarchy. This extension only admits the
    // endpoint's bare `[]` / `[x]` spelling.
    start: (source: string) => source.search(/(?:^|\n)[ \t]*\[[ xX]?\][ \t]*/),
    tokenize(source, _tokens, lexer) {
      const lines = source.split("\n");
      const items: MarkdownToken[] = [];
      let consumed = 0;
      for (const line of lines) {
        const match = /^[ \t]*\[([ xX]?)\][ \t]*(.*)$/.exec(line);
        if (!match) break;
        const text = match[2];
        items.push({
          type: "taskItem",
          raw: line,
          checked: match[1].toLowerCase() === "x",
          text,
          tokens: lexer.inlineTokens(text),
        });
        consumed += line.length;
        if (consumed < source.length && source[consumed] === "\n") consumed += 1;
      }
      if (!items.length) return undefined;
      return {
        type: "legacyTaskList",
        raw: source.slice(0, consumed),
        items,
        tokens: [],
      };
    },
  },
});

export const workbenchMarkdownExtensions = [
  // The list kit owns regular and task lists. Disabling StarterKit's copies
  // avoids duplicate ProseMirror node names while retaining its keymaps and
  // the rest of the compact document schema.
  StarterKit.configure({
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    link: false,
    underline: false,
  }),
  ListKit.configure({
    taskItem: { nested: true } satisfies Partial<TaskItemOptions>,
  }),
  Link.configure({
    autolink: false,
    linkOnPaste: false,
    openOnClick: false,
  }),
  WorkbenchUnderline,
  LegacyTaskList,
];

// MarkdownManager is pure with respect to documents. Reusing one instance
// keeps Tiptap's extension registry stable and avoids recreating the parser on
// every React render. It is loaded only by the lazy Markdown editor chunk.
const markdownManager = new MarkdownManager({ extensions: workbenchMarkdownExtensions });
const workbenchSchema = getSchema(workbenchMarkdownExtensions);

export function validateWorkbenchMarkdownDocument(document: JSONContent): JSONContent {
  return createDocument(document, workbenchSchema, {}, { errorOnInvalidContent: true }).toJSON() as JSONContent;
}

function isSafeHref(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const href = value.trim();
  if (!href || unsafeSchemePattern.test(href)) return false;
  // Protocol-relative, absolute, fragment, and relative links are safe for
  // the host. The Link extension still validates the rendered href.
  return !/^[a-z][a-z\d+.-]*:/i.test(href)
    || /^(?:https?|mailto|tel):/i.test(href);
}

function findUnsupportedToken(
  tokens: MarkdownToken[] | undefined,
): WorkbenchMarkdownUnsupportedReason | undefined {
  if (!tokens) return undefined;
  for (const token of tokens) {
    const type = String(token.type || "");
    if (type === "image") return "image";
    if (type === "table") return "table";
    if (type === "html" || type === "tag") return "html";
    if (type === "link" || type === "url") {
      if (!isSafeHref(token.href || token.text)) return "dangerous-link";
    }
    if (!supportedTokenTypes.has(type)) return "unknown-token";
    const nested = findUnsupportedToken(token.tokens);
    if (nested) return nested;
    const nestedTaskItems = findUnsupportedToken(token.nestedTokens);
    if (nestedTaskItems) return nestedTaskItems;
    const nestedItems = Array.isArray(token.items)
      ? token.items.flatMap((item) => item.tokens || [])
      : undefined;
    const nestedItemReason = findUnsupportedToken(nestedItems);
    if (nestedItemReason) return nestedItemReason;
  }
  return undefined;
}

/**
 * Parse a Markdown source only when every marked token has a known Tiptap
 * representation. Unsupported constructs remain in source mode, so images,
 * raw HTML and tables can never disappear merely because the user opened a
 * card in visual mode.
 */
export function analyzeWorkbenchMarkdown(source: string): WorkbenchMarkdownAnalysis {
  if (!source) {
    return {
      safe: true,
      document: { type: "doc", content: [{ type: "paragraph" }] },
    };
  }
  try {
    const tokens = markdownManager.instance.lexer(source) as MarkdownToken[];
    const reason = findUnsupportedToken(tokens);
    if (reason) return { safe: false, reason };
    const parsedDocument = markdownManager.parse(source);
    if (!parsedDocument || parsedDocument.type !== "doc") {
      return { safe: false, reason: "parse-error" };
    }
    const document = validateWorkbenchMarkdownDocument(parsedDocument);
    // Markdown syntax has many equivalent spellings. Compare parsed document
    // trees instead of comparing source strings, so harmless formatting is
    // normalized while an extension that drops structure fails closed.
    const serialized = markdownManager.serialize(document);
    const reparsed = validateWorkbenchMarkdownDocument(markdownManager.parse(serialized));
    if (stableDocumentString(document) !== stableDocumentString(reparsed)) {
      return { safe: false, reason: "unknown-token" };
    }
    return { safe: true, document };
  } catch {
    return { safe: false, reason: "parse-error" };
  }
}

function stableDocumentString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableDocumentString).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableDocumentString(entry)}`).join(",")}}`;
}

export function serializeWorkbenchMarkdown(document: JSONContent): string {
  return markdownManager.serialize(document);
}

export function parseWorkbenchMarkdown(source: string): JSONContent | undefined {
  const result = analyzeWorkbenchMarkdown(source);
  return result.safe ? result.document : undefined;
}

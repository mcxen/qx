import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import mathml from "@webc.site/math";
import { useTheme } from "../../ThemeProvider";

const SHIKI_LANGS = [
  "bash",
  "c",
  "cpp",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "objective-c",
  "php",
  "python",
  "ruby",
  "rust",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
] as const;

function normalizeLang(lang?: string): string {
  if (!lang) return "text";
  const lower = lang.toLowerCase();
  if (lower === "js") return "javascript";
  if (lower === "ts") return "typescript";
  if (lower === "sh" || lower === "zsh") return "bash";
  if (lower === "py") return "python";
  if (lower === "rb") return "ruby";
  if (lower === "yml") return "yaml";
  if (lower === "md") return "markdown";
  return lower;
}

function CodeBlock({
  language,
  code,
  themeId,
}: {
  language: string;
  code: string;
  themeId: "github-light" | "github-dark";
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lang = normalizeLang(language);
  const supported = SHIKI_LANGS.includes(lang as (typeof SHIKI_LANGS)[number]);

  useEffect(() => {
    let cancelled = false;
    if (!supported) {
      setHtml(null);
      return () => {
        cancelled = true;
      };
    }
    void import("./shikiHighlighter")
      .then(({ codeToHtml }) => codeToHtml(code, lang, themeId))
      .then((rendered) => {
        if (cancelled) return;
        setHtml(rendered);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, supported, themeId]);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="qx-md-codeblock">
      <div className="qx-md-codeblock-header">
        <span className="qx-md-codeblock-lang">{lang === "text" ? "code" : lang}</span>
        <button
          type="button"
          className="qx-md-codeblock-copy"
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div
          className="qx-md-codeblock-body is-highlighted"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="qx-md-codeblock-body">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

// ---- Custom rehype plugin: render remark-math nodes via @webc.site/math ----
// remark-math + remark-rehype emits <span class="math math-inline"> for inline
// and <span class="math math-display"> for block math (single text child = TeX source).
// We compile to MathML using the native browser MathML core via @webc.site/math
// and attach the HTML to a `data-mathml` property; the React `span` component
// override below renders that via dangerouslySetInnerHTML.

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown> & { className?: string[]; dataMathml?: string };
  children?: HastNode[];
}

function readTexText(node: HastNode): string {
  if (!node.children) return "";
  return node.children
    .map((child) => (child.type === "text" ? (child.value ?? "") : readTexText(child)))
    .join("");
}

function rehypeWebcMath() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.type === "element" && node.tagName === "span") {
        const classes = node.properties?.className ?? [];
        const isInline = classes.includes("math-inline");
        const isBlock = classes.includes("math-display");
        if (isInline || isBlock) {
          const tex = readTexText(node);
          try {
            const rendered = mathml(tex, isBlock);
            node.properties = {
              ...(node.properties ?? {}),
              className: ["qx-md-math", isBlock ? "is-block" : "is-inline"],
              dataMathml: rendered,
            };
            node.children = [];
            return;
          } catch {
            // fall through: leave node intact
          }
        }
      }
      if (node.children) {
        for (const child of node.children) visit(child);
      }
    };
    visit(tree);
  };
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: {
  content: string;
}) {
  const { resolvedTheme } = useTheme();
  const themeId = resolvedTheme === "dark" ? "github-dark" : "github-light";

  const components: Components = useMemo(() => ({
    code({ className, children, ...props }) {
      const text = String(children ?? "");
      const match = /language-(\w+)/.exec(className ?? "");
      const isBlock = text.includes("\n") || Boolean(match);
      if (!isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <CodeBlock
          language={match?.[1] ?? "text"}
          code={text.replace(/\n$/, "")}
          themeId={themeId}
        />
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      );
    },
    span({ className, children, ...props }) {
      const html = (props as { "data-mathml"?: string })["data-mathml"];
      if (typeof html === "string" && html.length > 0) {
        return (
          <span
            className={className}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
      return (
        <span className={className} {...props}>
          {children}
        </span>
      );
    },
    table({ children, ...props }) {
      return (
        <div className="qx-md-table-wrap">
          <table {...props}>{children}</table>
        </div>
      );
    },
  }), [themeId]);

  return (
    <div className="qx-md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeWebcMath]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;

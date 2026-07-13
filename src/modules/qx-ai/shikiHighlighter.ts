import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { LanguageInput } from "@shikijs/types";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";

const highlighter = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});

const languageLoads = new Map<string, Promise<void>>();

function loadLanguageModule(lang: string): Promise<{ default: LanguageInput }> {
  switch (lang) {
    case "bash": return import("@shikijs/langs/bash");
    case "c": return import("@shikijs/langs/c");
    case "cpp": return import("@shikijs/langs/cpp");
    case "css": return import("@shikijs/langs/css");
    case "diff": return import("@shikijs/langs/diff");
    case "go": return import("@shikijs/langs/go");
    case "html": return import("@shikijs/langs/html");
    case "java": return import("@shikijs/langs/java");
    case "javascript": return import("@shikijs/langs/javascript");
    case "json": return import("@shikijs/langs/json");
    case "jsx": return import("@shikijs/langs/jsx");
    case "kotlin": return import("@shikijs/langs/kotlin");
    case "markdown": return import("@shikijs/langs/markdown");
    case "objective-c": return import("@shikijs/langs/objective-c");
    case "php": return import("@shikijs/langs/php");
    case "python": return import("@shikijs/langs/python");
    case "ruby": return import("@shikijs/langs/ruby");
    case "rust": return import("@shikijs/langs/rust");
    case "shell": return import("@shikijs/langs/shell");
    case "sql": return import("@shikijs/langs/sql");
    case "swift": return import("@shikijs/langs/swift");
    case "toml": return import("@shikijs/langs/toml");
    case "tsx": return import("@shikijs/langs/tsx");
    case "typescript": return import("@shikijs/langs/typescript");
    case "xml": return import("@shikijs/langs/xml");
    case "yaml": return import("@shikijs/langs/yaml");
    default: return Promise.reject(new Error(`Unsupported language: ${lang}`));
  }
}

async function ensureLanguage(lang: string): Promise<void> {
  const existing = languageLoads.get(lang);
  if (existing) return existing;

  const load = highlighter
    .then(async (hi) => {
      const registration = await loadLanguageModule(lang);
      await hi.loadLanguage(registration.default);
    })
    .catch((error) => {
      languageLoads.delete(lang);
      throw error;
    });
  languageLoads.set(lang, load);
  return load;
}

export async function codeToHtml(code: string, lang: string, theme: "github-light" | "github-dark") {
  await ensureLanguage(lang);
  const hi = await highlighter;
  return hi.codeToHtml(code, { lang, theme });
}

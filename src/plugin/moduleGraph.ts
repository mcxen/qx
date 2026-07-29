import { init as initModuleLexer, parse as parseModuleImports } from "es-module-lexer";

export interface PluginModuleBundle {
  entry: string;
  modules: Record<string, string>;
}

export interface PluginModuleGraph {
  entrySpecifier: string;
  imports: Record<string, string>;
}

const pluginModuleSpecifier = (path: string) => `qx-plugin:/${path}`;

export function resolvePluginModulePath(importer: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) {
    return null;
  }
  const segments = specifier.startsWith("/") ? [] : importer.split("/").slice(0, -1);
  for (const segment of specifier.replace(/^\//, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new Error(`Plugin import escapes package root: ${specifier}`);
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

const moduleDataUrl = (source: string) =>
  `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;

export async function preparePluginModuleGraph(
  bundle: PluginModuleBundle,
): Promise<PluginModuleGraph> {
  await initModuleLexer;
  const modulePaths = new Set(Object.keys(bundle.modules));
  if (!modulePaths.has(bundle.entry)) throw new Error(`Plugin entry not found: ${bundle.entry}`);
  const rewritten = new Map<string, string>();
  for (const [path, source] of Object.entries(bundle.modules)) {
    const [imports] = parseModuleImports(source);
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    for (const imported of imports) {
      if (!imported.n) continue;
      const resolved = resolvePluginModulePath(path, imported.n);
      if (resolved === null) continue;
      if (!modulePaths.has(resolved)) {
        throw new Error(`Plugin module ${path} imports missing file ${imported.n}`);
      }
      replacements.push({
        start: imported.s,
        end: imported.e,
        value: imported.d >= 0
          ? JSON.stringify(pluginModuleSpecifier(resolved))
          : pluginModuleSpecifier(resolved),
      });
    }
    let output = source;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
    }
    rewritten.set(path, output);
  }
  return {
    entrySpecifier: pluginModuleSpecifier(bundle.entry),
    imports: Object.fromEntries(
      [...rewritten.entries()].map(([path, source]) => [
        pluginModuleSpecifier(path),
        moduleDataUrl(source),
      ]),
    ),
  };
}

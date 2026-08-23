#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const extensions = [".ts", ".tsx", ".mts", ".cts"];

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(full));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(full);
  }
  return files;
}

const files = collectSourceFiles(sourceRoot);
const fileSet = new Set(files.map((file) => path.normalize(file)));
const graph = new Map(files.map((file) => [file, new Set()]));
const frontendInvokes = new Map();

function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => fileSet.has(path.normalize(candidate))) ?? null;
}

for (const file of files) {
  const sourceText = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let importsTauriInvoke = false;
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
        && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const resolved = resolveRelativeImport(file, specifier);
      const isTypeOnly = ts.isImportDeclaration(statement)
        ? Boolean(statement.importClause?.isTypeOnly)
          || Boolean(statement.importClause?.namedBindings
            && ts.isNamedImports(statement.importClause.namedBindings)
            && statement.importClause.namedBindings.elements.length > 0
            && statement.importClause.namedBindings.elements.every((item) => item.isTypeOnly))
        : Boolean(statement.isTypeOnly);
      // TypeScript erases type-only edges. The runtime graph is the failure
      // boundary for module evaluation/HMR; contract layering is checked by
      // the architecture gate without rejecting harmless type references.
      if (resolved && !isTypeOnly) graph.get(file).add(resolved);
      if (ts.isImportDeclaration(statement)
          && specifier === "@tauri-apps/api/core"
          && statement.importClause?.namedBindings
          && ts.isNamedImports(statement.importClause.namedBindings)
          && statement.importClause.namedBindings.elements.some((item) => item.name.text === "invoke")) {
        importsTauriInvoke = true;
      }
    }
  }
  if (importsTauriInvoke) {
    const visit = (node) => {
      if (ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === "invoke"
          && node.arguments.length > 0
          && ts.isStringLiteralLike(node.arguments[0])) {
        const command = node.arguments[0].text;
        const line = source.getLineAndCharacterOfPosition(node.arguments[0].getStart()).line + 1;
        if (!frontendInvokes.has(command)) frontendInvokes.set(command, []);
        frontendInvokes.get(command).push(`${path.relative(root, file)}:${line}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

let index = 0;
const indices = new Map();
const lowlinks = new Map();
const stack = [];
const onStack = new Set();
const cycles = [];

function connect(node) {
  indices.set(node, index);
  lowlinks.set(node, index);
  index += 1;
  stack.push(node);
  onStack.add(node);
  for (const next of graph.get(node)) {
    if (!indices.has(next)) {
      connect(next);
      lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)));
    } else if (onStack.has(next)) {
      lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(next)));
    }
  }
  if (lowlinks.get(node) !== indices.get(node)) return;
  const component = [];
  let member;
  do {
    member = stack.pop();
    onStack.delete(member);
    component.push(member);
  } while (member !== node);
  if (component.length > 1 || graph.get(node).has(node)) cycles.push(component);
}

for (const file of files) if (!indices.has(file)) connect(file);

function registeredCommands() {
  const rust = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  const marker = "tauri::generate_handler![";
  const start = rust.indexOf(marker);
  if (start < 0) throw new Error("tauri::generate_handler! registration not found");
  let depth = 1;
  let cursor = start + marker.length;
  while (cursor < rust.length && depth > 0) {
    if (rust[cursor] === "[") depth += 1;
    else if (rust[cursor] === "]") depth -= 1;
    cursor += 1;
  }
  const body = rust.slice(start + marker.length, cursor - 1).replace(/\/\/.*$/gm, "");
  return new Set(
    body.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split("::").at(-1)),
  );
}

const registered = registeredCommands();
const missingInvokes = [...frontendInvokes.entries()].filter(([command]) => !registered.has(command));

function representativeCycle(component) {
  const members = new Set(component);
  for (const start of component) {
    const pathStack = [];
    const active = new Set();
    const visit = (node) => {
      pathStack.push(node);
      active.add(node);
      for (const next of graph.get(node)) {
        if (!members.has(next)) continue;
        if (next === start) return [...pathStack, start];
        if (!active.has(next)) {
          const found = visit(next);
          if (found) return found;
        }
      }
      active.delete(node);
      pathStack.pop();
      return null;
    };
    const found = visit(start);
    if (found) return found;
  }
  return component;
}

if (cycles.length || missingInvokes.length) {
  if (cycles.length) {
    console.error(`Found ${cycles.length} TypeScript import cycle(s):`);
    for (const component of cycles) {
      console.error(`  - ${representativeCycle(component).map((file) => path.relative(root, file)).join(" -> ")}`);
    }
  }
  if (missingInvokes.length) {
    console.error("Frontend invoke command(s) missing from tauri::generate_handler!:");
    for (const [command, locations] of missingInvokes) {
      console.error(`  - ${command}: ${locations.join(", ")}`);
    }
  }
  process.exit(1);
}

console.log(`interface protocols OK (${files.length} TS/TSX files, ${frontendInvokes.size} literal invokes, ${registered.size} registered commands, 0 import cycles)`);

#!/usr/bin/env node
// Read-only inventory, not a runtime acceptance test. JSON is useful for diffing releases.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
const root = process.cwd();
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith(".rs") ? [path] : [];
  });
}
const files = sources(join(root, "src-tauri/src"));
const declarations = new Map();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/#\[(?:tauri::)?command(?:\([^\]]*\))?\][\s\S]{0,200}?(?:pub(?:\([^)]*\))?\s+)?(async\s+)?fn\s+(\w+)/g)) {
    const name = match[2];
    const item = { file: relative(root, file), line: text.slice(0, match.index).split("\n").length,
      entry: match[1] ? "async" : "sync", acceptance: "requires domain-specific evidence" };
    declarations.set(name, [...(declarations.get(name) || []), item]);
  }
}
const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const registration = lib.split("tauri::generate_handler![")[1].split("])")[0].replace(/\/\/.*$/gm, "");
const commands = registration.split(",").map((s) => s.trim()).filter(Boolean).map((path) => ({
  path, module: path.includes("::") ? path.split("::")[0] : "lib",
  declarations: declarations.get(path.split("::").at(-1)) || [],
}));
const missing = commands.filter((c) => !c.declarations.length);
const counts = Object.fromEntries([...new Set(commands.map((c) => c.module))].sort().map((module) => [module, commands.filter((c) => c.module === module).length]));
if (process.argv.includes("--json")) console.log(JSON.stringify({ registered: commands.length, counts, commands }, null, 2));
else {
  console.log(`Native/API inventory: ${commands.length} registered commands across ${Object.keys(counts).length} modules`);
  for (const [module, count] of Object.entries(counts)) console.log(`${module}: ${count}`);
  console.log("Inventory checks registration coverage only; consult docs/native-capability-validation.md for acceptance boundaries.");
}
if (missing.length) { console.error("Unresolved command declarations:", missing); process.exitCode = 1; }

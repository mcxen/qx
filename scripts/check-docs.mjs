import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => failures.push(message);

// Release versions must share one source value.
const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargoVersion = read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const readmeVersion = read("README.md").match(/> \*\*Version\*\*: v([^\s—]+)/)?.[1]
  ?? read("README.md").match(/> \*\*版本\*\*: v([^\s—]+)/)?.[1];
for (const [source, version] of Object.entries({
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "README.md": readmeVersion,
})) {
  if (version !== packageJson.version) fail(`version mismatch: ${source}=${version}, package.json=${packageJson.version}`);
}

// IPC documentation baseline must exactly mirror generate_handler! registration order.
const rust = read("src-tauri/src/lib.rs");
const handlerStart = rust.indexOf("tauri::generate_handler![");
if (handlerStart < 0) {
  fail("cannot find tauri::generate_handler! in src-tauri/src/lib.rs");
} else {
  const listStart = rust.indexOf("[", handlerStart) + 1;
  const listEnd = rust.indexOf("])", listStart);
  const commands = rust.slice(listStart, listEnd)
    .split(",")
    .map((item) => item.replace(/\/\/.*$/gm, "").trim())
    .filter(Boolean)
    .map((item) => item.split("::").at(-1));
  const docs = read("docs/ipc-catalogue.md");
  const baseline = docs.match(/<!-- IPC_COMMANDS_START -->([\s\S]*?)<!-- IPC_COMMANDS_END -->/)?.[1]
    .match(/`([a-zA-Z0-9_]+)`/g)?.map((item) => item.slice(1, -1)) ?? [];
  if (JSON.stringify(commands) !== JSON.stringify(baseline)) {
    const missing = commands.filter((command) => !baseline.includes(command));
    const stale = baseline.filter((command) => !commands.includes(command));
    fail(`IPC baseline mismatch (${commands.length} registered / ${baseline.length} documented); missing=[${missing.join(", ")}], stale=[${stale.join(", ")}]`);
  }
}

// Verify local Markdown links across maintained documentation.
const markdownFiles = [
  ...fs.readdirSync(root).filter((name) => name.endsWith(".md")),
  ...fs.readdirSync(path.join(root, "docs")).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`),
  ...fs.readdirSync(path.join(root, "public/doc")).filter((name) => name.endsWith(".md")).map((name) => `public/doc/${name}`),
];
for (const file of markdownFiles) {
  const content = read(file);
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].split("#")[0];
    if (!href || /^[a-z]+:/i.test(href)) continue;
    const target = path.resolve(root, path.dirname(file), decodeURIComponent(href));
    if (!fs.existsSync(target)) fail(`broken link: ${file} -> ${match[1]}`);
  }
}

// Keep explicit native-control prohibitions enforceable. Rendered Markdown checkboxes are exempt.
const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) sourceFiles.push(target);
  }
}
walk(path.join(root, "src"));
for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf8");
  if (/<select\b|type=["'](?:range|checkbox|radio)["']/.test(content)) {
    fail(`native product control found: ${path.relative(root, file)}`);
  }
}

if (failures.length) {
  console.error(`Documentation checks failed (${failures.length}):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`Documentation checks passed: version ${packageJson.version}, Markdown links valid, IPC baseline synchronized.`);

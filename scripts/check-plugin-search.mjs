#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleNodeModule } from "./esbuild-port.mjs";

const rootDir = process.cwd();
const cacheDir = path.join(rootDir, "node_modules", ".cache", "qx-plugin-search-check");
fs.mkdirSync(cacheDir, { recursive: true });

function bundle(entry, name) {
  const outfile = path.join(cacheDir, name);
  const result = bundleNodeModule({ root: rootDir, entry, outfile });
  assert.equal(result.ok, true, `Failed to bundle ${entry}:\n${result.error}`);
  return import(`${pathToFileURL(outfile).href}?check=${Date.now()}-${name}`);
}

const [metadata, provider, rank, display, resultRows] = await Promise.all([
  bundle("src/plugin/pluginSearchMetadata.ts", "metadata.mjs"),
  bundle("src/search/pluginSearchProvider.ts", "provider.mjs"),
  bundle("src/search/rankResults.ts", "rank.mjs"),
  bundle("src/search/appDisplay.ts", "display.mjs"),
  bundle("src/launcher/resultRows.ts", "rows.mjs"),
]);

const calendarManifest = JSON.parse(
  fs.readFileSync(path.join(rootDir, "qx-plugins", "src", "raycast-calendar", "manifest.json"), "utf8"),
);
for (const term of ["日历", "rili", "rl", "快捷日历", "kuaijierili", "kjrl"]) {
  assert.ok(calendarManifest.keywords.includes(term), `calendar manifest missing ${term}`);
}

const calendar = {
  id: "raycast-calendar",
  name: "Quick Calendar",
  version: "1.3.0",
  description: calendarManifest.description,
  path: "/plugins/raycast-calendar",
  enabled: true,
  permissions: [],
  author: "fuksman",
  manifest: calendarManifest,
};
const calendarPanel = {
  pluginId: calendar.id,
  pluginName: calendar.name,
  title: calendarManifest.panel.title,
  icon: "calendar.png",
  keywords: metadata.buildPluginSearchTerms({
    pluginId: calendar.id,
    pluginName: calendar.name,
    pluginDescription: calendar.description,
    manifest: calendarManifest,
    panel: calendarManifest.panel,
  }),
  render() {},
};

const input = {
  plugins: [calendar],
  commands: [],
  panels: { [calendar.id]: calendarPanel },
  locale: "zh-CN",
  t: (_key, fallback) => fallback,
  isModuleSearchEnabled: () => true,
};

// Relevance regression: "qui" is inside the prose "requires token".
// Descriptions must not become aliases in eager/lazy registration or search.
const v2Manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "qx-plugins/src/v2ex/manifest.json"), "utf8"));
const v2Plugin = { ...calendar, id: "v2ex", name: "V2EX", manifest: v2Manifest };
const v2Commands = v2Manifest.commands.map((command) => ({
  ...command, pluginId: "v2ex", pluginName: "V2EX",
  keywords: metadata.buildPluginSearchTerms({ pluginId: "v2ex", pluginName: "V2EX", manifest: v2Manifest, command }),
}));
const v2Input = { ...input, plugins: [v2Plugin], panels: {}, commands: v2Commands };
const v2WithPanel = { ...v2Input, panels: { v2ex: {
  pluginId: "v2ex", pluginName: "V2EX", title: "V2EX", keywords: [], render() {},
} } };
const unrelatedPin = { name: "显示器亮度", path: "__qx:plugin:brightness", kind: "command", icon: "" };
const pinSettings = { search_metadata: { "plugin:brightness": { pinned: true, pin_order: 0 } } };
for (const locale of ["en", "zh-CN"]) {
  for (const query of ["v2", "v2ex", "V2EX"]) {
    const hits = provider.searchPluginEntries({ ...v2WithPanel, locale, query });
    assert.ok(hits.length > 1, "regression needs the module and its inherited-name commands");
    const entries = [unrelatedPin, ...hits.map((hit) => ({ ...hit, clickCount: hit.path.includes(":cmd:") ? 999 : 0 }))];
    assert.equal(rank.rankSearchResults(entries, query)[0].path, "__qx:plugin:v2ex",
      "direct module name wins over frequent inherited-name actions");
    const rows = resultRows.buildLauncherResultRows(entries, [], new Set(), pinSettings);
    const best = resultRows.bestLauncherRowIndex(rows, query);
    assert.equal(resultRows.selectedLauncherItem(rows, best)?.path, "__qx:plugin:v2ex",
      "default selection ignores sticky position and category headers, even before worker sorting");
    const collapsed = resultRows.buildLauncherResultRows(entries, [], new Set(["launcher.plugins"]), pinSettings);
    assert.equal(resultRows.bestLauncherRowIndex(collapsed, query), -1, "unmatched pins never become default fallback");
  }
}
const tokenHits = provider.searchPluginEntries({ ...v2WithPanel, query: "token" });
assert.ok(rank.rankSearchResults(tokenHits, "token")[0].path.startsWith("__qx:cmd:v2ex:"));
assert.equal(resultRows.bestLauncherRowIndex([], "v2"), -1);
assert.equal(rank.bestSearchResultIndex([unrelatedPin], "no-match"), -1);
const calculation = { name: "4", path: "__qx:calc:2+2", kind: "calculation", icon: "" };
assert.equal(rank.rankSearchResults([{ ...unrelatedPin, name: "2+2" }, calculation], "2+2")[0], calculation);
const legacyV2Input = { ...v2Input, commands: v2Commands.map((command) => ({
  ...command, keywords: [...command.keywords, command.description],
})) };
const legacyQuiEntries = provider.searchPluginEntries({ ...legacyV2Input, query: "qui" });
assert.equal(legacyQuiEntries.length, 2, "baseline must reproduce both requires-token false positives");
assert.equal(new Set(legacyQuiEntries.map((entry) => display.pickDisplayName(entry, "zh-CN", input.t, [v2Plugin]))).size, 2,
  "display-only fix distinguishes actions but does not remove false positives");
assert.ok(v2Manifest.commands.some((command) => command.description?.includes("requires")));
assert.equal(provider.searchPluginEntries({ ...v2Input, query: "qui" }).length, 0);
assert.equal(provider.searchPluginEntries({ ...input, query: "qui" }).length, 1, "Quick Calendar remains a name-prefix match");
assert.ok(provider.searchPluginEntries({ ...v2Input, query: "token" }).length > 0, "explicit command title/keyword remains searchable");
for (const command of v2Commands) {
  assert.ok(!command.keywords.some((term) => term.includes("requires")), "registration must not flatten prose into keywords");
}
for (const locale of ["en", "zh-CN"]) {
  const entries = provider.searchPluginEntries({ ...v2Input, locale, query: "v2ex" });
  const labels = entries.map((entry) => display.pickDisplayName(entry, locale, input.t, [v2Plugin]));
  assert.equal(new Set(labels).size, entries.length, "command labels must retain distinct actions");
  assert.ok(labels.every((label) => label !== "V2EX"), "display must not overwrite command titles with plugin name");
}

// Do not compare two identical helper calls: registration call sites are
// checked below and the legacy/new metadata boundaries are ablated separately.
for (const query of ["日历", "rili", "rl", "快捷日历", "kuaijierili", "kjrl"]) {
  const entries = provider.searchPluginEntries({ ...input, query });
  assert.equal(entries.length, 1, `calendar should match ${query}`);
  assert.equal(entries[0].path, "__qx:plugin:raycast-calendar");
  assert.equal(entries[0].matchScore, rank.MatchTier.exact, `${query} must carry its keyword tier`);
}

// The provider also keeps localized panel titles when a registry snapshot has
// only the canonical title/keyword projection from an older eager runtime.
const localizedPanelPlugin = {
  ...calendar,
  manifest: {
    ...calendarManifest,
    keywords: [],
    panel: {
      ...calendarManifest.panel,
      titles: { "zh-CN": "农历入口", en: "Lunar Entry" },
      keywords: [],
    },
  },
};
const localizedPanelEntries = provider.searchPluginEntries({
  ...input,
  plugins: [localizedPanelPlugin],
  panels: {
    [calendar.id]: {
      ...calendarPanel,
      keywords: [],
    },
  },
  query: "农历入口",
});
assert.equal(localizedPanelEntries.length, 1, "localized panel title should be indexed");

// A panel-only plugin is a valid launcher target even with commands: [].
assert.equal(provider.searchPluginEntries({ ...input, query: "agenda" }).length, 0);
const commandOnly = {
  id: "organizer",
  name: "Organizer",
  version: "1.0.0",
  description: "A focused task tool",
  path: "/plugins/organizer",
  enabled: true,
  permissions: [],
  author: "test",
  manifest: {
    id: "organizer",
    name: "Organizer",
    version: "1.0.0",
    keywords: ["task-tool", "整理"],
    commands: [{ name: "refresh", title: "Refresh", keywords: ["focus"] }],
  },
};
const command = {
  pluginId: commandOnly.id,
  pluginName: commandOnly.name,
  name: "refresh",
  title: "Refresh",
  keywords: metadata.buildPluginSearchTerms({
    pluginId: commandOnly.id,
    pluginName: commandOnly.name,
    pluginDescription: commandOnly.description,
    manifest: commandOnly.manifest,
    command: commandOnly.manifest.commands[0],
  }),
  run() {},
};
const commandInput = {
  plugins: [commandOnly],
  commands: [command],
  panels: {},
  locale: "en",
  t: (_key, fallback) => fallback,
  isModuleSearchEnabled: () => true,
};
const commandEntries = provider.searchPluginEntries({ ...commandInput, query: "focus" });
assert.equal(commandEntries.length, 1, "an unrelated plugin keyword must be searchable");
assert.equal(commandEntries[0].path, "__qx:cmd:organizer:refresh");
assert.equal(
  provider.searchPluginEntries({ ...commandInput, query: "organizer" })
    .some((entry) => entry.path === "__qx:plugin:organizer"),
  false,
  "panel-less plugins must not receive a synthetic root row",
);

const disabledPanel = { ...calendarPanel, pluginId: "disabled-calendar" };
const disabledPlugin = { ...calendar, id: "disabled-calendar", enabled: false };
assert.equal(
  provider.searchPluginEntries({
    ...input,
    plugins: [disabledPlugin],
    panels: { [disabledPlugin.id]: disabledPanel },
    query: "rili",
  }).length,
  0,
  "disabled registered rows must not remain searchable",
);
assert.equal(
  provider.searchPluginEntries({
    ...input,
    plugins: [{ ...calendar, id: "builtin:calendar" }],
    panels: { "builtin:calendar": { ...calendarPanel, pluginId: "builtin:calendar" } },
    query: "rili",
    isModuleSearchEnabled: () => false,
  }).length,
  0,
  "disabled built-in module rows must not remain searchable",
);

const metadataOnly = provider.searchPluginEntries({
  ...input,
  query: "my-calendar-alias",
  matchesMetadata: () => true,
});
assert.equal(metadataOnly.length, 1);
assert.equal(metadataOnly[0].matchScore, rank.MatchTier.contains);

assert.equal(rank.classifyMatch("clipboard", "ip"), rank.MatchTier.none);
const aliasEntry = provider.searchPluginEntries({ ...input, query: "rili" })[0];
assert.equal(rank.scoreEntryTier(aliasEntry, "rili"), rank.MatchTier.exact);
assert.equal(rank.rankSearchResults([aliasEntry], "rili")[0].matchScore, rank.MatchTier.exact);

const snapshotA = provider.pluginSearchMetadataFingerprint({
  plugins: [calendar],
  panels: input.panels,
  commands: [],
});
const snapshotB = provider.pluginSearchMetadataFingerprint({
  plugins: [calendar],
  panels: { [calendar.id]: { ...calendarPanel, keywords: [...calendarPanel.keywords, "agenda"] } },
  commands: [],
});
assert.notEqual(snapshotA, snapshotB, "same-count keyword changes must invalidate the fingerprint");

const runtimeSource = fs.readFileSync(path.join(rootDir, "src", "plugin", "runtime.ts"), "utf8");
const registrySource = fs.readFileSync(path.join(rootDir, "src", "plugin", "registry.ts"), "utf8");
const appSource = fs.readFileSync(path.join(rootDir, "src", "App.tsx"), "utf8");
assert.match(runtimeSource, /buildPluginSearchTerms\(/);
assert.match(registrySource, /buildPluginSearchTerms\(/);
assert.match(appSource, /searchPluginEntries\(/);
assert.match(appSource, /pluginSearchMetadataFingerprint/);
assert.doesNotMatch(appSource, /const pluginMatches =/);
assert.doesNotMatch(appSource, /panel-less plugins/);
assert.match(appSource, /pluginSearchVersionRef\.current === pluginSearchMetadataVersion/,
  "metadata refresh must not duplicate the normal query debounce on every keystroke");

// All marketplace plugins must declare usable Chinese/full-pinyin/initials.
// These expected queries are test data, never imported by the host engine.
const cases = JSON.parse(fs.readFileSync(path.join(rootDir, "scripts/fixtures/plugin-search-cases.json"), "utf8"));
const pluginDirs = fs.readdirSync(path.join(rootDir, "qx-plugins/src"))
  .filter((id) => fs.existsSync(path.join(rootDir, "qx-plugins/src", id, "manifest.json")));
assert.deepEqual(Object.keys(cases).sort(), pluginDirs.sort(), "every community plugin needs search acceptance cases");
let catalogAssertions = 0;
for (const id of pluginDirs) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "qx-plugins/src", id, "manifest.json"), "utf8"));
  const plugin = { ...calendar, id, name: manifest.name, description: manifest.description, manifest };
  const panels = manifest.panel ? { [id]: {
    pluginId: id, pluginName: manifest.name, title: manifest.panel.title || manifest.name,
    keywords: metadata.buildPluginSearchTerms({pluginId:id, pluginName:manifest.name, manifest, panel:manifest.panel}),
    render() { throw Error("search must not render"); },
  } } : {};
  const commands = (manifest.commands || []).map((command) => ({
    ...command, pluginId:id, pluginName:manifest.name,
    keywords:metadata.buildPluginSearchTerms({pluginId:id, pluginName:manifest.name, manifest, command}),
    run() { throw Error("search must not run commands"); },
  }));
  for (const locale of ["zh-CN", "en"]) for (const query of cases[id]) {
    assert(manifest.keywords.includes(query), `${id} must own its alias ${query}`);
    const hits = provider.searchPluginEntries({...input, plugins:[plugin], panels, commands, locale, query});
    assert(hits.length > 0, `${id}: ${locale}/${query} missing`);
    assert(hits.every((hit) => hit.matchScore === rank.MatchTier.exact), `${id}: keyword tier lost`);
    if (manifest.panel) assert(hits.some((hit) => hit.path === `__qx:plugin:${id}`));
    else assert(hits.every((hit) => hit.path.startsWith(`__qx:cmd:${id}:`)));
    catalogAssertions++;
  }
  for (const command of commands) {
    const chineseTitle = command.titles?.["zh-CN"];
    if (!chineseTitle) continue;
    const hits = provider.searchPluginEntries({...input, plugins:[plugin], panels, commands, locale:"en", query:chineseTitle});
    assert(hits.some((hit) => hit.path === `__qx:cmd:${id}:${command.name}`), `${id}: Chinese command title missing`);
  }
  assert.equal(provider.searchPluginEntries({...input, plugins:[{...plugin, enabled:false}], panels, commands, query:cases[id][0]}).length, 0);
  assert.equal(provider.searchPluginEntries({...input, plugins:[], panels, commands, query:cases[id][0]}).length, 0,
    "external orphan registrations cannot survive plugin removal");
  assert.equal(provider.searchPluginEntries({...input, plugins:[plugin], panels:{}, commands:[], query:cases[id][0]}).length, 0,
    "installed metadata alone cannot bypass registration compatibility checks");
}

// Ablation: old registration only indexed canonical name/id + declared words;
// old Launcher tested these fields and discarded their tier when publishing.
const oldManifest = {...calendarManifest, keywords:["calendar", "lunar", "holiday", "农历", "节假日", "调休"]};
function ablation(query, words, host) {
  const manifest = words ? calendarManifest : oldManifest;
  const oldTerms = [calendar.id, calendar.name, manifest.panel.title, ...manifest.keywords, ...(manifest.panel.keywords || [])];
  if (!host) return rank.bestMatchTier(query, ...oldTerms) < rank.MatchTier.none;
  return provider.searchPluginEntries({...input, locale:"en", plugins:[{...calendar,manifest}],
    panels:{[calendar.id]:{...calendarPanel,keywords:oldTerms}}, query}).length > 0;
}
const stages = [["baseline",false,false],["keywords only",true,false],["host only",false,true],["combined",true,true]];
const matrix = stages.map(([stage,words,host]) => ({stage,
  chinese:ablation("日历",words,host),pinyin:ablation("rili",words,host),initials:ablation("rl",words,host),
  localizedNameInEnglish:ablation("快捷日历",words,host)}));
assert.deepEqual(matrix.map(({chinese,pinyin,initials,localizedNameInEnglish}) => [chinese,pinyin,initials,localizedNameInEnglish]),
  [[false,false,false,false],[true,true,true,true],[false,false,false,true],[true,true,true,true]]);
// Keywords alone restore recall, but only the score-carrying provider preserves
// exact alias rank against other result types whose displayed names match.
const oldAlias = {...aliasEntry}; delete oldAlias.matchScore;
assert.equal(rank.scoreEntryTier(oldAlias,"rili"),rank.MatchTier.none);
const rival = {name:"rili helper",path:"/Applications/rili helper.app",kind:"app"};
assert.equal(rank.rankSearchResults([oldAlias,rival],"rili")[0].path,rival.path);
assert.equal(rank.rankSearchResults([aliasEntry,rival],"rili")[0].path,aliasEntry.path);
const callbacksOnly = provider.pluginSearchMetadataFingerprint({plugins:[calendar],commands:[],
  panels:{[calendar.id]:{...calendarPanel,render(){throw Error("new callback identity");}}}});
assert.equal(callbacksOnly,snapshotA,"runtime callback changes must not restart search");
console.table(matrix);
console.log(`catalog: ${pluginDirs.length} plugins, ${catalogAssertions} Chinese/pinyin/initials checks across two UI locales passed`);

console.log("plugin-search: ok — shared metadata, panel-only rows, aliases, filtering, scores and fingerprint covered");

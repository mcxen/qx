#!/usr/bin/env node
/**
 * Single entry for quality gates. Prefer this over ad-hoc file-by-file fixes:
 *   npm run check
 *
 * Order: architecture ports → docs contracts → i18n dictionary → focused subsystem tests.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const steps = [
  ["architecture", "scripts/check-architecture.mjs"],
  ["docs", "scripts/check-docs.mjs"],
  ["i18n", "scripts/check-i18n.mjs"],
  ["shell-navigation", "scripts/check-qx-shell-navigation.mjs"],
  ["island", "scripts/check-qx-island.mjs"],
];

let failed = 0;
for (const [name, script] of steps) {
  console.log(`\n==> check:${name}`);
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`check:${name} failed (exit ${result.status ?? "unknown"})`);
  }
}

if (failed) {
  console.error(`\n${failed} check group(s) failed. Fix at the abstraction/port layer, then re-run npm run check.`);
  process.exit(1);
}
console.log("\nall checks passed.");

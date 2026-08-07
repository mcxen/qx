/**
 * Launcher calculator result port.
 *
 * Pure mapping from a evaluated expression to an `AppEntry`. App.tsx merges
 * the entry into search results; Enter copies the numeric result via the
 * `__qx:calc:` path convention.
 */

import type { AppEntry } from "../store";
import type { CalculationResult } from "./calculator";

export const CALCULATION_PATH_PREFIX = "__qx:calc:";

export function calculationEntryFromResult(result: CalculationResult): AppEntry {
  return {
    name: `${result.expression} = ${result.formatted}`,
    path: `${CALCULATION_PATH_PREFIX}${encodeURIComponent(result.formatted)}`,
    icon: "builtin:calculator",
    kind: "calculation",
    // Exact-tier ranking: stays above fuzzy app matches for the same query.
    matchScore: 0,
  };
}

export function isCalculationPath(path: string): boolean {
  return path.startsWith(CALCULATION_PATH_PREFIX);
}

export function decodeCalculationResult(path: string): string | null {
  if (!isCalculationPath(path)) return null;
  try {
    return decodeURIComponent(path.slice(CALCULATION_PATH_PREFIX.length));
  } catch {
    return path.slice(CALCULATION_PATH_PREFIX.length);
  }
}

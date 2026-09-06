import type { PluginPreferenceGroup } from "../../../plugin/types";

export type PreferenceSaveValue = string | number | boolean;
export type PreferenceSaveValues = Record<string, PreferenceSaveValue>;

export type PreferenceSaveIntent =
  | {
      kind: "autosave";
      preferenceId: string;
      value: PreferenceSaveValue;
    }
  | {
      kind: "manual";
      preferenceIds: readonly string[];
      values: Readonly<PreferenceSaveValues>;
    };

export interface PreferenceSaveRequest {
  snapshot: PreferenceSaveValues;
  nextRequested: PreferenceSaveValues;
}

/** Keep only manifest-declared, unique ids when consuming a group at runtime. */
export function normalizePreferenceIds(
  group: Pick<PluginPreferenceGroup, "preferenceIds">,
  declaredIds: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>();
  for (const id of group.preferenceIds ?? []) {
    if (declaredIds.has(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * Build one complete map from the latest persistable map.
 *
 * `requested` must never be the UI draft: it contains only the last confirmed
 * map plus values already explicitly queued for persistence. Consequently an
 * autosave cannot accidentally persist an unrelated unsaved manual field.
 */
export function buildPreferenceSaveRequest(
  requested: Readonly<PreferenceSaveValues>,
  intent: PreferenceSaveIntent,
): PreferenceSaveRequest {
  const nextRequested: PreferenceSaveValues = { ...requested };
  if (intent.kind === "autosave") {
    nextRequested[intent.preferenceId] = intent.value;
  } else {
    for (const id of intent.preferenceIds) {
      if (Object.prototype.hasOwnProperty.call(intent.values, id)) {
        nextRequested[id] = intent.values[id];
      }
    }
  }
  return { snapshot: nextRequested, nextRequested };
}

export function resetRequestedToPersisted(
  persisted: Readonly<PreferenceSaveValues>,
): PreferenceSaveValues {
  return { ...persisted };
}

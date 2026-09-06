import { useMemo, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import {
  Button,
  Input,
  LoadingLabel,
  Row,
  SegmentedControl,
  Select,
  SettingsCard,
  Slider,
  Toggle,
} from "../../../components/ui";
import { useLocale, useT } from "../../../i18n";
import type {
  InstalledPlugin,
  PluginPreference,
  PluginPreferenceGroup,
} from "../../../plugin/types";
import { localizePluginPreference } from "../../../plugin/pluginLabels";

export type PreferenceValue = string | number | boolean;
export type PreferenceValues = Record<string, PreferenceValue>;

function pickLocaleMap(
  map: Record<string, string> | undefined,
  locale: string,
): string | undefined {
  if (!map) return undefined;
  const language = locale.split("-")[0];
  return map[locale]
    ?? map[language]
    ?? map.en
    ?? Object.values(map).find((value) => value.trim());
}

function isMultilinePreference(pref: PluginPreference): boolean {
  if (pref.type === "textarea") return true;
  if (pref.type !== "string") return false;
  if (typeof pref.default === "string" && pref.default.includes("\n")) return true;
  const desc = `${pref.description ?? ""} ${pref.label ?? ""}`.toLowerCase();
  return desc.includes("one per line")
    || desc.includes("per line")
    || desc.includes("每行")
    || desc.includes("一行一个")
    || desc.includes("newline");
}

function PreferenceField({
  pref,
  value,
  onChange,
}: {
  pref: PluginPreference;
  value: PreferenceValue;
  onChange: (value: PreferenceValue) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const t = useT();
  const ariaLabel = pref.label;
  const rows = Math.max(3, Math.min(24, Math.round(pref.rows || 4)));

  switch (pref.type) {
    case "boolean":
      return <Toggle value={Boolean(value)} onChange={onChange} ariaLabel={ariaLabel} />;
    case "select":
      return (
        <Select
          value={String(value ?? "")}
          options={pref.options ?? []}
          ariaLabel={ariaLabel}
          className="qx-plugin-preference-control"
          onChange={onChange}
        />
      );
    case "segmented":
      return (
        <div className="qx-plugin-preference-control">
          <SegmentedControl value={String(value ?? "")} options={pref.options ?? []} onChange={onChange} />
        </div>
      );
    case "slider": {
      const min = Number.isFinite(pref.min) ? Number(pref.min) : 0;
      const max = Number.isFinite(pref.max) ? Number(pref.max) : 100;
      const step = Number.isFinite(pref.step) && Number(pref.step) > 0 ? Number(pref.step) : 1;
      const numericValue = Math.max(min, Math.min(max, Number(value) || min));
      return (
        <div className="qx-plugin-preference-control qx-plugin-preference-slider">
          <Slider
            value={numericValue}
            min={min}
            max={max}
            step={step}
            ariaLabel={ariaLabel}
            formatLabel={(next) => `${next}${pref.unit || ""}`}
            onChange={onChange}
          />
          <span>{numericValue}{pref.unit || ""}</span>
        </div>
      );
    }
    case "number":
      return (
        <div className="qx-settings-input-wrap qx-plugin-preference-control">
          <Input
            type="number"
            value={String(value ?? 0)}
            aria-label={ariaLabel}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>
      );
    case "password":
      return (
        <div className="qx-plugin-preference-password qx-plugin-preference-control">
          <Input
            type={revealed ? "text" : "password"}
            value={String(value ?? "")}
            aria-label={ariaLabel}
            onChange={(event) => onChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="qx-plugin-preference-reveal"
            aria-label={revealed
              ? t("plugins.preferences.hideSecret", "Hide secret")
              : t("plugins.preferences.showSecret", "Show secret")}
            title={revealed
              ? t("plugins.preferences.hideSecret", "Hide secret")
              : t("plugins.preferences.showSecret", "Show secret")}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          </Button>
        </div>
      );
    case "textarea":
      return (
        <div className="qx-settings-textarea-wrap">
          <textarea
            className="qx-shadcn-textarea"
            value={String(value ?? "")}
            rows={rows}
            placeholder={pref.placeholder || undefined}
            aria-label={ariaLabel}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      );
    default:
      if (isMultilinePreference(pref)) {
        return (
          <div className="qx-settings-textarea-wrap">
            <textarea
              className="qx-shadcn-textarea"
              value={String(value ?? "")}
              rows={rows}
              placeholder={pref.placeholder || undefined}
              aria-label={ariaLabel}
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
        );
      }
      return (
        <div className="qx-settings-input-wrap qx-plugin-preference-control">
          <Input
            type="text"
            value={String(value ?? "")}
            aria-label={ariaLabel}
            placeholder={pref.placeholder || undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      );
  }
}

function preferenceDefault(pref: PluginPreference): PreferenceValue {
  return pref.default ?? (pref.type === "boolean" ? false : pref.type === "number" ? 0 : "");
}

function groupPreferences(
  preferences: PluginPreference[],
  groups: PluginPreferenceGroup[],
): Array<{ group: PluginPreferenceGroup; preferences: PluginPreference[] }> {
  const byId = new Map(preferences.map((preference) => [preference.id, preference]));
  const used = new Set<string>();
  const result: Array<{ group: PluginPreferenceGroup; preferences: PluginPreference[] }> = [];

  for (const group of groups) {
    const groupItems: PluginPreference[] = [];
    const groupSeen = new Set<string>();
    for (const id of group.preferenceIds ?? []) {
      const preference = byId.get(id);
      if (!preference || used.has(preference.id) || groupSeen.has(preference.id)) continue;
      groupSeen.add(preference.id);
      groupItems.push(preference);
    }
    if (groupItems.length === 0) continue;
    groupItems.forEach((preference) => used.add(preference.id));
    result.push({ group, preferences: groupItems });
  }

  const ungrouped = preferences.filter((preference) => !used.has(preference.id));
  if (ungrouped.length > 0) {
    result.push({
      group: {
        id: "__ungrouped",
        title: "",
        preferenceIds: ungrouped.map((preference) => preference.id),
        saveMode: "autosave",
      },
      preferences: ungrouped,
    });
  }
  return result;
}

export function PluginPreferences({
  plugin,
  preferences,
  groups,
  values,
  loaded,
  saving,
  checkingGroupId,
  error,
  dirtyGroupIds,
  onChange,
  onSaveGroup,
  onCancelGroup,
  onCheckConnection,
}: {
  plugin: InstalledPlugin;
  preferences: PluginPreference[];
  groups: PluginPreferenceGroup[];
  values: PreferenceValues;
  loaded: boolean;
  saving: boolean;
  checkingGroupId: string | null;
  error?: string | null;
  dirtyGroupIds: ReadonlySet<string>;
  onChange: (preferenceId: string, value: PreferenceValue) => void;
  onSaveGroup: (group: PluginPreferenceGroup) => void;
  onCancelGroup: (group: PluginPreferenceGroup) => void;
  onCheckConnection: (group: PluginPreferenceGroup) => void;
}) {
  const locale = useLocale();
  const t = useT();
  const sections = useMemo(() => groupPreferences(preferences, groups), [groups, preferences]);
  if (!loaded || preferences.length === 0) return null;

  return (
    <div className="qx-plugin-preference-groups">
      {sections.map(({ group, preferences: sectionPreferences }) => {
        const title = group.id === "__ungrouped"
          ? t("plugins.preferences", "Preferences")
          : pickLocaleMap(group.titles, locale) || group.title;
        const description = pickLocaleMap(group.descriptions, locale) || group.description;
        const manual = group.saveMode === "manual";
        const dirty = dirtyGroupIds.has(group.id);
        const checking = checkingGroupId === group.id;
        const checkTitle = group.connectionCheck
          ? pickLocaleMap(group.connectionCheck.titles, locale)
            || group.connectionCheck.title
            || t("plugins.preferences.checkConnection", "Check connection")
          : null;
        const connectionActionTitle = manual && dirty
          ? t("plugins.preferences.saveAndCheck", "Save and check")
          : checkTitle;
        return (
          <SettingsCard
            key={group.id}
            title={title}
            description={description}
            className={`qx-plugin-preference-group${manual ? " is-manual" : ""}`}
            trailing={manual ? (
              <div className="qx-plugin-preference-actions">
                {dirty ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onCancelGroup(group)} disabled={saving || checking}>
                    {t("plugins.preferences.cancel", "Cancel")}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" onClick={() => onSaveGroup(group)} disabled={!dirty || saving || checking}>
                  {saving
                    ? <LoadingLabel>{t("plugins.preferences.saving", "Saving…")}</LoadingLabel>
                    : t("plugins.preferences.save", "Save")}
                </Button>
              </div>
            ) : undefined}
          >
            {sectionPreferences.map((preference) => {
              const localized = localizePluginPreference(plugin, preference, t, locale);
              return (
                <Row
                  key={preference.id}
                  title={localized.label}
                  description={localized.description}
                  stacked={isMultilinePreference(localized) || localized.type === "textarea"}
                >
                  <PreferenceField
                    pref={localized}
                    value={values[preference.id] ?? preferenceDefault(preference)}
                    onChange={(value) => onChange(preference.id, value)}
                  />
                </Row>
              );
            })}
            {group.connectionCheck ? (
              <div className="qx-plugin-preference-connection-actions">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || checking}
                  onClick={() => onCheckConnection(group)}
                >
                  {checking ? <LoaderCircle size={13} className="qx-spin" aria-hidden="true" /> : null}
                  {connectionActionTitle}
                </Button>
              </div>
            ) : null}
            {error && (dirty || Boolean(group.connectionCheck)) ? (
              <div className="qx-plugin-preference-error" role="alert">{error}</div>
            ) : null}
          </SettingsCard>
        );
      })}
    </div>
  );
}

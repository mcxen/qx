import { useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "./store";
import { Button, Input, Row, SegmentedControl, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";

function normalizeLocations(locations: string[]): string[] {
  return Array.from(new Set(locations.map((item) => item.trim()).filter(Boolean)));
}

function weatherLocationDrafts(w: { locations: string[]; location_override: string }): string[] {
  if (w.locations.length > 0) return w.locations;
  if (w.location_override.trim()) return [w.location_override.trim()];
  return [""];
}

export default function WeatherSettings() {
  const { settings, patch } = useSettingsStore();
  const t = useT();
  const w = settings.weather;
  const savedLocationDrafts = useMemo(
    () => weatherLocationDrafts(w),
    [w.locations, w.location_override],
  );
  const [locationDrafts, setLocationDrafts] = useState(savedLocationDrafts);

  const patchW = (partial: Partial<typeof w>) =>
    patch("weather", { ...w, ...partial });

  useEffect(() => {
    const savedKey = normalizeLocations(savedLocationDrafts).join("\n");
    const draftKey = normalizeLocations(locationDrafts).join("\n");
    if (savedKey !== draftKey) {
      setLocationDrafts(savedLocationDrafts);
    }
  }, [savedLocationDrafts, locationDrafts]);

  const patchLocations = (nextLocations: string[]) => {
    const normalized = normalizeLocations(nextLocations);
    patchW({
      locations: normalized,
      location_override: normalized[0] ?? "",
    });
  };

  return (
    <div className="qx-settings-page">
      <SettingsCard
        title={t("weather.source.title", "Data Source")}
        description={t("weather.source.desc", "Choose the weather provider and credentials used for requests.")}
      >
        <Row
          title={t("weather.provider", "Provider")}
          description={t("weather.provider.desc", "Choose weather data source. Open-Meteo is free and requires no API key.")}
        >
          <SegmentedControl
            value={w.provider}
            onChange={(v) => patchW({ provider: v })}
            options={[
              { value: "open-meteo", label: "Open-Meteo (Free)" },
              { value: "openweathermap", label: "OpenWeatherMap" },
            ]}
          />
        </Row>

        {w.provider === "openweathermap" && (
          <Row
            title={t("weather.apiKey", "OpenWeatherMap API Key")}
            description={t("weather.apiKey.desc", "Optional. Get one at openweathermap.org. Without a key, Open-Meteo is used as fallback.")}
          >
            <div className="qx-settings-input-wrap">
              <Input
                type="password"
                value={w.api_key}
                onChange={(e) => patchW({ api_key: e.target.value })}
                placeholder="Enter API key..."
              />
            </div>
          </Row>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("weather.display.title", "Location & Units")}
        description={t("weather.display.desc", "Decide the forecast location and temperature format.")}
      >
        <Row
          title={t("weather.locations", "Locations")}
          description={t("weather.locations.desc", "Add one city or coordinate pair per row. Leave all rows empty for auto-detection via IP.")}
        >
          <div className="qx-settings-input-wrap qx-weather-location-list">
            {locationDrafts.map((location, index) => (
              <div className="qx-weather-location-row" key={`weather-location-${index}`}>
                <Input
                  type="text"
                  value={location}
                  onChange={(e) => {
                    const next = [...locationDrafts];
                    next[index] = e.target.value;
                    setLocationDrafts(next);
                    patchLocations(next);
                  }}
                  placeholder={t("weather.location.placeholder", "Auto-detect or enter city/lat,lon")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = locationDrafts.filter((_, itemIndex) => itemIndex !== index);
                    const drafts = next.length > 0 ? next : [""];
                    setLocationDrafts(drafts);
                    patchLocations(next);
                  }}
                  disabled={locationDrafts.length <= 1 && !location.trim()}
                >
                  {t("common.remove", "Remove")}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLocationDrafts([...locationDrafts, ""])}
            >
              {t("weather.addLocation", "Add Location")}
            </Button>
          </div>
        </Row>

        <Row
          title={t("weather.units", "Temperature Unit")}
          description={t("weather.units.desc", "Choose how temperatures are displayed.")}
        >
          <SegmentedControl
            value={w.units}
            onChange={(v) => patchW({ units: v })}
            options={[
              { value: "celsius", label: "Celsius (°C)" },
              { value: "fahrenheit", label: "Fahrenheit (°F)" },
            ]}
          />
        </Row>
      </SettingsCard>
    </div>
  );
}

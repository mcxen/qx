import { useSettingsStore } from "./store";
import { Input, Row, SegmentedControl, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";

export default function WeatherSettings() {
  const { settings, patch } = useSettingsStore();
  const t = useT();
  const w = settings.weather;

  const patchW = (partial: Partial<typeof w>) =>
    patch("weather", { ...w, ...partial });

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
          title={t("weather.location", "Location")}
          description={t("weather.location.desc", "Leave empty for auto-detection via IP. Or enter a city name (e.g. Beijing) or coordinates (e.g. 39.9,116.4).")}
        >
          <div className="qx-settings-input-wrap">
            <Input
              type="text"
              value={w.location_override}
              onChange={(e) => patchW({ location_override: e.target.value })}
              placeholder={t("weather.location.placeholder", "Auto-detect or enter city/lat,lon")}
            />
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

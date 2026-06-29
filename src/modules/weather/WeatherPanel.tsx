import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { WeatherWidget } from "@/components/tool-ui/weather-widget/runtime";
import type { WeatherConditionCode } from "@/components/tool-ui/weather-widget/schema-runtime";
import { useEscBack } from "../../hooks/useEscBack";
import { useStore } from "../../store";
import { useSettingsStore } from "../settings/store";
import { LoadingSpinner } from "../../components/ui";
import { useT } from "../../i18n";

interface WeatherCurrent {
  temperature: number;
  tempMin: number;
  tempMax: number;
  conditionCode: WeatherConditionCode;
  humidity: number;
  windSpeed: number;
}

interface WeatherForecastDay {
  label: string;
  tempMin: number;
  tempMax: number;
  conditionCode: WeatherConditionCode;
}

interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
}

interface WeatherData {
  location: WeatherLocation;
  current: WeatherCurrent;
  forecast: WeatherForecastDay[];
  updatedAt: string;
  provider: string;
}

function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function toUnit(celsius: number, units: string): number {
  return units === "fahrenheit" ? celsiusToFahrenheit(celsius) : Math.round(celsius);
}

export default function WeatherPanel() {
  const setTab = useStore((state) => state.setTab);
  const { settings } = useSettingsStore();
  const t = useT();

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadWeather = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await invoke<WeatherData>("fetch_weather");
      setWeather(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeather();
  }, [loadWeather]);

  const goBack = () => setTab("launcher");

  const { onKeyDown: escKeyDown } = useEscBack({
    launcher: goBack,
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.defaultPrevented) return;
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      void loadWeather();
    }
  };

  const units = settings.weather.units || "celsius";
  const tempUnit = units === "fahrenheit" ? "fahrenheit" : "celsius";

  const island: BottomIslandContent | null = weather
    ? {
        label: `${toUnit(weather.current.temperature, units)}° ${weather.current.conditionCode.replace("-", " ")}`,
        detail: weather.location.name,
      }
    : loading
      ? { label: t("weather.loading", "Loading weather..."), detail: "" }
      : null;

  const now = new Date();
  const localTimeOfDay = now.getHours() / 24 + now.getMinutes() / 1440;

  return (
    <QxShell
      title="Weather"
      visual="solid"
      onBack={goBack}
      escapeAction={{ label: t("weather.back", "Back"), kbd: "Esc", onClick: goBack }}
      trailing={
        <button
          className="qx-command-button"
          onClick={() => void loadWeather()}
          title={t("weather.refresh", "Refresh")}
          disabled={loading}
        >
          {t("weather.refresh", "Refresh")}
        </button>
      }
      island={island}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "24px 16px",
          height: "100%",
          overflowY: "auto",
        }}
      >
        {loading && !weather && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--qx-text-secondary)" }}>
            <LoadingSpinner />
            <span>{t("weather.loading", "Loading weather...")}</span>
          </div>
        )}

        {error && (
          <div
            style={{
              textAlign: "center",
              color: "var(--qx-text-secondary)",
              padding: "32px 16px",
            }}
          >
            <p style={{ marginBottom: 12 }}>{error}</p>
            <button className="qx-command-button" onClick={() => void loadWeather()}>
              {t("weather.retry", "Retry")}
            </button>
          </div>
        )}

        {weather && (
          <WeatherWidget
            version="3.1"
            id="weather-widget-main"
            location={{ name: weather.location.name }}
            units={{ temperature: tempUnit }}
            current={{
              temperature: toUnit(weather.current.temperature, units),
              tempMin: toUnit(weather.current.tempMin, units),
              tempMax: toUnit(weather.current.tempMax, units),
              conditionCode: weather.current.conditionCode,
              windSpeed: weather.current.windSpeed,
            }}
            forecast={weather.forecast.slice(0, 6).map((day) => ({
              label: day.label,
              tempMin: toUnit(day.tempMin, units),
              tempMax: toUnit(day.tempMax, units),
              conditionCode: day.conditionCode,
            }))}
            time={{ localTimeOfDay }}
            updatedAt={weather.updatedAt}
          />
        )}
      </div>
    </QxShell>
  );
}

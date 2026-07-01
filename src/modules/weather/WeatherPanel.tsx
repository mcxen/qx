import { useEffect, useState, useCallback, useMemo } from "react";
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

interface WeatherCachePayload {
  data: WeatherData;
  cachedAt: number;
}

interface WeatherSettingsSnapshot {
  provider: string;
  api_key: string;
  location_override: string;
}

const LOCAL_WEATHER_CACHE_PREFIX = "qx.weather.cache:";
const LOCAL_WEATHER_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function localWeatherCacheKey(weatherSettings: WeatherSettingsSnapshot): string | null {
  const provider = weatherSettings.provider.trim() || "open-meteo";
  const location = weatherSettings.location_override.trim();

  if (provider === "openweathermap" && weatherSettings.api_key.trim()) {
    return null;
  }

  return `${LOCAL_WEATHER_CACHE_PREFIX}${provider}\n${location}`;
}

function readLocalWeatherCache(cacheKey: string | null): WeatherData | null {
  if (!cacheKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeatherCachePayload>;
    if (!parsed.data || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > LOCAL_WEATHER_CACHE_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeLocalWeatherCache(cacheKey: string | null, data: WeatherData): void {
  if (!cacheKey || typeof window === "undefined") return;
  try {
    const payload: WeatherCachePayload = { data, cachedAt: Date.now() };
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // Native cache remains the source of truth; this is only an instant UI path.
  }
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
  const localCacheKey = useMemo(
    () => localWeatherCacheKey(settings.weather),
    [settings.weather.provider, settings.weather.api_key, settings.weather.location_override],
  );

  const [weather, setWeather] = useState<WeatherData | null>(() =>
    readLocalWeatherCache(localWeatherCacheKey(settings.weather)),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadWeather = useCallback(async (options: { silent?: boolean } = {}) => {
    setLoading(!options.silent);
    setError("");
    try {
      const data = await invoke<WeatherData>("fetch_weather");
      setWeather(data);
      writeLocalWeatherCache(localCacheKey, data);
    } catch (err) {
      if (!options.silent) setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [localCacheKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialWeather() {
      const localCached = readLocalWeatherCache(localCacheKey);
      if (localCached) {
        setWeather(localCached);
        void loadWeather({ silent: true });
        return;
      }

      try {
        const cached = await invoke<WeatherData | null>("get_cached_weather");
        if (cancelled) return;
        if (cached) {
          setWeather(cached);
          writeLocalWeatherCache(localCacheKey, cached);
          void loadWeather({ silent: true });
          return;
        }
      } catch {
        // Cache is a best-effort fast path; live weather remains the source of truth.
      }
      if (!cancelled) void loadWeather();
    }

    void loadInitialWeather();
    return () => {
      cancelled = true;
    };
  }, [loadWeather, localCacheKey]);

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

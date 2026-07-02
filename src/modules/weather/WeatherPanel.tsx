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
  locations?: string[];
}

const LOCAL_WEATHER_CACHE_PREFIX = "qx.weather.cache:";
const LOCAL_WEATHER_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function normalizeWeatherLocations(weatherSettings: WeatherSettingsSnapshot): string[] {
  const configured = Array.isArray(weatherSettings.locations)
    ? weatherSettings.locations.map((item) => item.trim()).filter(Boolean)
    : [];
  if (configured.length > 0) return Array.from(new Set(configured));
  const legacyLocation = weatherSettings.location_override.trim();
  return legacyLocation ? [legacyLocation] : [""];
}

function localWeatherCacheKey(weatherSettings: WeatherSettingsSnapshot, locationOverride = ""): string | null {
  const provider = weatherSettings.provider.trim() || "open-meteo";
  const location = locationOverride.trim();

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

function readLocalWeatherCaches(weatherSettings: WeatherSettingsSnapshot, locations: string[]): WeatherData[] {
  return locations
    .map((location) => readLocalWeatherCache(localWeatherCacheKey(weatherSettings, location)))
    .filter((item): item is WeatherData => Boolean(item));
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
  const weatherLocations = useMemo(
    () => normalizeWeatherLocations(settings.weather),
    [
      settings.weather.provider,
      settings.weather.api_key,
      settings.weather.location_override,
      settings.weather.locations,
    ],
  );

  const [weatherItems, setWeatherItems] = useState<WeatherData[]>(() =>
    readLocalWeatherCaches(settings.weather, normalizeWeatherLocations(settings.weather)),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadWeather = useCallback(async (options: { silent?: boolean } = {}) => {
    setLoading(!options.silent);
    setError("");
    try {
      const results = await Promise.allSettled(
        weatherLocations.map((location) =>
          invoke<WeatherData>("fetch_weather_for_location", { location }),
        ),
      );
      const data: WeatherData[] = [];
      const errors: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          const location = weatherLocations[index] ?? "";
          data.push(result.value);
          writeLocalWeatherCache(localWeatherCacheKey(settings.weather, location), result.value);
        } else {
          errors.push(String(result.reason));
        }
      });
      if (data.length > 0) {
        setWeatherItems(data);
        if (!options.silent && errors.length > 0) {
          setError(t("weather.partialError", "Some locations could not be refreshed."));
        }
        return;
      }
      throw new Error(errors[0] || "Weather fetch failed");
    } catch (err) {
      if (!options.silent) setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [settings.weather, t, weatherLocations]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialWeather() {
      const localCached = readLocalWeatherCaches(settings.weather, weatherLocations);
      if (localCached.length > 0) {
        setWeatherItems(localCached);
        void loadWeather({ silent: true });
        return;
      }

      try {
        const cachedResults = await Promise.all(
          weatherLocations.map((location) =>
            invoke<WeatherData | null>("get_cached_weather_for_location", { location }).catch(() => null),
          ),
        );
        if (cancelled) return;
        const cached = cachedResults.filter((item): item is WeatherData => Boolean(item));
        if (cached.length > 0) {
          setWeatherItems(cached);
          cachedResults.forEach((item, index) => {
            if (!item) return;
            writeLocalWeatherCache(localWeatherCacheKey(settings.weather, weatherLocations[index] ?? ""), item);
          });
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
  }, [loadWeather, settings.weather, weatherLocations]);

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

  const primaryWeather = weatherItems[0] ?? null;

  const island: BottomIslandContent | null = primaryWeather
    ? {
        label: `${toUnit(primaryWeather.current.temperature, units)}° ${primaryWeather.current.conditionCode.replace("-", " ")}`,
        detail: weatherItems.length > 1
          ? `${primaryWeather.location.name} +${weatherItems.length - 1}`
          : primaryWeather.location.name,
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
      <div className={`qx-weather-stage${weatherItems.length > 1 ? " has-multiple" : ""}`}>
        {loading && weatherItems.length === 0 && (
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

        {weatherItems.length > 0 && (
          <div className="qx-weather-grid">
            {weatherItems.map((weather, index) => (
              <div className="qx-weather-card" key={`${weather.location.name}:${weather.location.latitude}:${weather.location.longitude}`}>
                <WeatherWidget
                  version="3.1"
                  id={`weather-widget-${index}`}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </QxShell>
  );
}

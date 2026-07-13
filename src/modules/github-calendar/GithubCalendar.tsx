import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect, useRef } from "react";

interface ContributionWeek {
  days: [number, number, number, number, number, number, number];
}

interface ContributionCalendar {
  weeks: ContributionWeek[];
  totalCommits: number;
  username: string;
  sinceTs: number;
}

const LEVEL_COLORS = [
  "var(--qx-gh-level-0)",
  "var(--qx-gh-level-1)",
  "var(--qx-gh-level-2)",
  "var(--qx-gh-level-3)",
  "var(--qx-gh-level-4)",
];

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function GithubCalendar() {
  const [username, setUsername] = useState("mcxen");
  const [input, setInput] = useState("mcxen");
  const [cal, setCal] = useState<ContributionCalendar | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<{
    level: number;
    index: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const fetchCalendar = useCallback(async (user: string) => {
    if (!user.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ContributionCalendar>("github_contributions", {
        username: user.trim(),
      });
      setCal(result);
    } catch (e) {
      setError(String(e));
      setCal(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCalendar(username);
  }, [fetchCalendar, username]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUsername(input.trim());
  };

  const daysSince = cal
    ? Math.floor((Date.now() / 1000 - cal.sinceTs) / 86400)
    : 365;

  const monthMarkers = cal
      ? (() => {
        const markers: { label: string; index: number }[] = [];
        for (let w = 0; w < cal.weeks.length; w++) {
          // Approximate: first day of this week
          const dayOffset = daysSince - (cal.weeks.length - 1 - w) * 7;
          const d = new Date(Date.now() - dayOffset * 86400 * 1000);
          const m = d.getMonth();
          if (w === 0 || new Date(Date.now() - (dayOffset + 7) * 86400 * 1000).getMonth() !== m) {
            markers.push({ label: MONTH_LABELS[m], index: w });
          }
        }
        return markers;
      })()
    : [];

  return (
    <div className="qx-settings-page" style={{ maxWidth: 500 }}>
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 12,
          color: "var(--qx-text-primary)",
        }}
      >
        GitHub Contributions
      </h3>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="GitHub username"
          style={{
            flex: 1,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--qx-border-1)",
            background: "var(--qx-bg-component-2)",
            color: "var(--qx-text-primary)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          className="qx-command-button primary"
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </form>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--qx-danger) 10%, transparent)",
            color: "var(--qx-danger)",
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {loading && !cal && (
        <div style={{ color: "var(--qx-text-secondary)", fontSize: 12 }}>
          Fetching contribution data...
        </div>
      )}

      {cal && (
        <div style={{ position: "relative" }}>
          {/* Month labels */}
          <div
            style={{
              display: "flex",
              gap: 3,
              paddingLeft: 38,
              fontSize: 10,
              color: "var(--qx-text-secondary, #8b949e)",
              marginBottom: 2,
            }}
          >
            {monthMarkers.map((m) => (
              <span
                key={m.index}
                style={{
                  position: "absolute",
                  left: 38 + m.index * 15,
                  fontSize: 10,
                }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", gap: 3 }}>
            {/* Day labels */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                fontSize: 10,
                color: "var(--qx-text-secondary, #8b949e)",
                paddingTop: 0,
              }}
            >
              {DAY_LABELS.map((label, i) => (
                <span
                  key={i}
                  style={{
                    height: 13,
                    lineHeight: "13px",
                    visibility: label ? "visible" : "hidden",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* Grid */}
            <div
              style={{
                display: "flex",
                gap: 3,
                overflowX: "auto",
                paddingBottom: 4,
              }}
              onMouseLeave={() => setHoveredDay(null)}
            >
              {cal.weeks.map((week, wi) => (
                <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {week.days.map((level, di) => (
                    <div
                      key={di}
                      onMouseEnter={() => setHoveredDay({ level, index: wi * 7 + di })}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        background: LEVEL_COLORS[Math.min(level as number, 4) as number],
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Legend + total */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 8,
              fontSize: 11,
              color: "var(--qx-text-secondary, #8b949e)",
            }}
          >
            <span>
              {cal.totalCommits} contributions in the last year
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span>Less</span>
              {LEVEL_COLORS.map((color, i) => (
                <div
                  key={i}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: color,
                  }}
                />
              ))}
              <span>More</span>
            </div>
          </div>

          {/* Tooltip */}
          {hoveredDay && (
            <div
              ref={tooltipRef}
              style={{
                position: "absolute",
                top: -28,
                left: 38 + (hoveredDay.index % 7) * 15 + 4,
                background: "var(--popover)",
                color: "var(--popover-foreground)",
                padding: "4px 8px",
                borderRadius: 4,
                fontSize: 11,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                boxShadow: "0 2px 8px color-mix(in srgb, var(--qx-shadow) 30%, transparent)",
              }}
            >
              {hoveredDay.level} contribution
              {hoveredDay.level !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

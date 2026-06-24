import { useEffect, useMemo, useState } from "react";

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatSolarDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}

function formatLunarDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
      month: "long",
      day: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

export default function HomeDateIsland() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = useMemo(
    () => ({
      time: formatTime(now),
      solar: formatSolarDate(now),
      lunar: formatLunarDate(now),
    }),
    [now],
  );

  return (
    <div className="qx-home-date-island" aria-label="Date display">
      <div className="qx-island-marquee">
        {[0, 1].map((copy) => (
          <div className="qx-island-marquee-group" aria-hidden={copy === 1} key={copy}>
            <span className="qx-date-time">{parts.time}</span>
            <span className="qx-date-copy">
              <span>{parts.solar}</span>
              {parts.lunar && <span>农历 {parts.lunar}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

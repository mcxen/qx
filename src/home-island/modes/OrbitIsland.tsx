import { useEffect, useMemo, useState } from "react";
import { Matrix, digits, emptyFrame, setPixel, type Frame } from "../../components/Matrix";
import { clamp100 } from "../shared";
import { useIslandStats } from "../data/hooks";
import { useT } from "../../i18n";

function buildTimeFrame(hhmm: string, colonOn: boolean): { frame: Frame; cols: number } {
  const chars = hhmm.replace(/[^0-9]/g, "").slice(0, 4).padEnd(4, "0");
  const colon = emptyFrame(7, 1);
  if (colonOn) {
    setPixel(colon, 2, 0, 1);
    setPixel(colon, 4, 0, 1);
  }
  const separator = emptyFrame(7, 1);
  const segments: Frame[] = [
    digits[Number(chars[0])] ?? digits[0],
    separator,
    digits[Number(chars[1])] ?? digits[0],
    colon,
    separator,
    digits[Number(chars[2])] ?? digits[0],
    separator,
    digits[Number(chars[3])] ?? digits[0],
  ];
  const cols = segments.reduce((acc, s) => acc + s[0].length, 0);
  const frame = emptyFrame(7, cols);
  let offset = 0;
  for (const seg of segments) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < seg[0].length; c++) {
        frame[r][offset + c] = seg[r][c] ?? 0;
      }
    }
    offset += seg[0].length;
  }
  return { frame, cols };
}

/** CPU-driven orbital ring — denser trail when load is high. */
function buildOrbitFrame(cpu: number, tick: number): Frame {
  const size = 7;
  const frame = emptyFrame(size, size);
  const center = 3;
  const radius = 2.4;
  const load = clamp100(cpu) / 100;
  const trail = 4 + Math.round(load * 6);
  const speed = 1 + Math.round(load * 2);

  for (let i = 0; i < trail; i++) {
    const angle = ((tick * speed - i) / 12) * Math.PI * 2;
    const x = Math.round(center + Math.cos(angle) * radius);
    const y = Math.round(center + Math.sin(angle) * radius);
    const brightness = Math.max(0.2, 1 - i / (trail + 1));
    setPixel(frame, y, x, brightness);
  }
  setPixel(frame, center, center, 0.35 + load * 0.65);
  return frame;
}

/**
 * ORBIT — mission clock. Clock is local; CPU load is async from the stats bus.
 */
export default function HomeOrbitIsland() {
  const t = useT();
  const { stats, ready } = useIslandStats();
  const [now, setNow] = useState(() => new Date());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const spin = window.setInterval(() => setTick((n) => n + 1), 80);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(spin);
    };
  }, []);

  const cpu = stats?.cpu ?? 0;
  const live = ready && !!stats;
  const cpuText = live ? `${Math.round(cpu)}%` : "--";

  const hhmm = useMemo(() => {
    const h = now.getHours().toString().padStart(2, "0");
    const m = now.getMinutes().toString().padStart(2, "0");
    return `${h}${m}`;
  }, [now]);

  const colonOn = now.getSeconds() % 2 === 0;
  const { frame: timeFrame, cols: timeCols } = useMemo(
    () => buildTimeFrame(hhmm, colonOn),
    [hhmm, colonOn],
  );
  const orbitFrame = useMemo(() => buildOrbitFrame(cpu, tick), [cpu, tick]);

  const timePalette = useMemo(
    () => ({
      on: "var(--qx-system-island-text)",
      off: "color-mix(in srgb, var(--qx-system-island-muted) 24%, transparent)",
    }),
    [],
  );
  const orbitPalette = useMemo(
    () => ({
      on: "var(--qx-stats-cpu)",
      off: "color-mix(in srgb, var(--qx-system-island-muted) 18%, transparent)",
    }),
    [],
  );

  return (
    <div className="qx-home-sci-island qx-home-orbit-island" aria-label={t("island.orbit.aria", "Mission clock")}>
      <span className="qx-sci-tag">
        <span className={`qx-sci-beacon${live ? " is-live" : ""}`} />
        {t("island.orbit.tag", "ORBIT")}
      </span>

      <Matrix
        rows={7}
        cols={timeCols}
        pattern={timeFrame}
        size={4}
        gap={1}
        className="qx-sci-matrix"
        palette={timePalette}
        ariaLabel={t("island.orbit.time", "Current time")}
      />

      <span className="qx-sci-divider" aria-hidden="true" />

      <span className="qx-sci-orbit-block">
        <Matrix
          rows={7}
          cols={7}
          pattern={orbitFrame}
          size={3}
          gap={1}
          className="qx-sci-matrix"
          palette={orbitPalette}
          ariaLabel={t("island.orbit.cpu", "CPU orbit")}
        />
        <span className="qx-sci-orbit-meta">
          <span className="qx-sci-label">CPU</span>
          <strong className="qx-sci-rate">{cpuText}</strong>
        </span>
      </span>
    </div>
  );
}

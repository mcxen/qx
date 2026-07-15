import { useEffect, useMemo, useState } from "react";
import { Matrix, emptyFrame, setPixel, type Frame } from "../../components/Matrix";
import { clamp100 } from "../shared";
import { useIslandPower } from "../data/hooks";
import { useT } from "../../i18n";

const CORE_COLS = 18;
const CORE_ROWS = 7;

/** Horizontal energy bar as a sci-fi reactor strip. */
function buildCoreFrame(level: number, phase: number, charging: boolean): Frame {
  const frame = emptyFrame(CORE_ROWS, CORE_COLS);
  const filled = Math.round((clamp100(level) / 100) * CORE_COLS);
  const mid = Math.floor(CORE_ROWS / 2);

  for (let c = 0; c < CORE_COLS; c++) {
    const on = c < filled;
    const edge = c === filled - 1;
    const pulse = charging ? 0.55 + 0.45 * Math.sin(phase + c * 0.45) : 1;
    for (let r = 0; r < CORE_ROWS; r++) {
      const dist = Math.abs(r - mid);
      if (!on) {
        if (dist === 0) setPixel(frame, r, c, 0.12);
        continue;
      }
      if (dist === 0) setPixel(frame, r, c, edge ? pulse : 0.95 * pulse);
      else if (dist === 1) setPixel(frame, r, c, (edge ? 0.75 : 0.55) * pulse);
      else if (dist === 2) setPixel(frame, r, c, 0.28 * pulse);
    }
  }

  if (filled > 0) {
    const c = Math.min(CORE_COLS - 1, filled);
    setPixel(frame, mid, c, charging ? 0.9 + 0.1 * Math.sin(phase * 2) : 0.5);
  }

  return frame;
}

/**
 * CORE — power reactor. Battery sample is async via the shared bus.
 */
export default function HomeCoreIsland() {
  const t = useT();
  const { power, ready } = useIslandPower();
  const [phase, setPhase] = useState(0);

  const level = power?.batteryLevel ?? null;
  const charging = Boolean(power?.isCharging);
  const available = ready;

  useEffect(() => {
    if (!charging) return;
    const id = window.setInterval(() => setPhase((p) => p + 0.35), 90);
    return () => window.clearInterval(id);
  }, [charging]);

  const frame = useMemo(
    () => buildCoreFrame(level ?? (available ? 100 : 0), phase, charging && level != null),
    [level, phase, charging, available],
  );

  const stateLabel = !available
    ? "--"
    : level == null
      ? t("island.core.ac", "AC")
      : charging
        ? t("island.core.chg", "CHG")
        : t("island.core.bat", "BAT");

  const levelText = !available
    ? "--"
    : level == null
      ? t("island.core.external", "EXT")
      : `${Math.round(level)}%`;

  const palette = useMemo(() => {
    const hot = level != null && level <= 20 && !charging;
    return {
      on: hot
        ? "var(--qx-danger)"
        : charging
          ? "var(--qx-stats-cpu)"
          : "var(--qx-stats-gpu)",
      off: "color-mix(in srgb, var(--qx-system-island-muted) 22%, transparent)",
    };
  }, [level, charging]);

  return (
    <div className="qx-home-sci-island qx-home-core-island qx-island-content" aria-label={t("island.core.aria", "Power core")}>
      <span className="qx-sci-tag">
        <span className={`qx-sci-beacon${charging ? " is-live" : available ? " is-steady" : ""}`} />
        {t("island.core.tag", "CORE")}
      </span>

      <span className="qx-sci-state">{stateLabel}</span>
      <Matrix
        rows={CORE_ROWS}
        cols={CORE_COLS}
        pattern={frame}
        size={3}
        gap={1}
        className="qx-sci-matrix"
        palette={palette}
        ariaLabel={t("island.core.bar", "Battery level")}
      />
      <strong className="qx-sci-rate">{levelText}</strong>
    </div>
  );
}

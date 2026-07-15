import { useMemo } from "react";
import { Matrix } from "../../components/Matrix";
import { formatRate } from "../shared";
import { useIslandNet } from "../data/hooks";
import { useT } from "../../i18n";

/**
 * PULSE — network signal feed.
 * Rates are sampled on the async bus; UI always paints placeholders first.
 */
export default function HomePulseIsland() {
  const t = useT();
  const { net, ready } = useIslandNet();

  const downText = ready && net ? formatRate(net.downRate) : "--";
  const upText = ready && net ? formatRate(net.upRate) : "--";
  const downLevels = net?.downLevels ?? Array(12).fill(0);
  const upLevels = net?.upLevels ?? Array(12).fill(0);
  const live = Boolean(ready && net);

  const paletteDown = useMemo(
    () => ({
      on: "var(--qx-stats-mem)",
      off: "color-mix(in srgb, var(--qx-system-island-muted) 22%, transparent)",
    }),
    [],
  );
  const paletteUp = useMemo(
    () => ({
      on: "var(--qx-stats-cpu)",
      off: "color-mix(in srgb, var(--qx-system-island-muted) 22%, transparent)",
    }),
    [],
  );

  return (
    <div className="qx-home-sci-island qx-home-pulse-island qx-island-content" aria-label={t("island.pulse.aria", "Network pulse")}>
      <span className="qx-sci-tag">
        <span className={`qx-sci-beacon${live ? " is-live" : ""}`} />
        {t("island.pulse.tag", "PULSE")}
      </span>

      <span className="qx-sci-channel">
        <span className="qx-sci-dir down">↓</span>
        <strong className="qx-sci-rate">{downText}</strong>
        <Matrix
          rows={7}
          cols={12}
          mode="vu"
          levels={downLevels}
          size={3}
          gap={1}
          className="qx-sci-matrix"
          palette={paletteDown}
          ariaLabel={t("island.pulse.down", "Download rate")}
        />
      </span>

      <span className="qx-sci-divider" aria-hidden="true" />

      <span className="qx-sci-channel">
        <span className="qx-sci-dir up">↑</span>
        <strong className="qx-sci-rate">{upText}</strong>
        <Matrix
          rows={7}
          cols={12}
          mode="vu"
          levels={upLevels}
          size={3}
          gap={1}
          className="qx-sci-matrix"
          palette={paletteUp}
          ariaLabel={t("island.pulse.up", "Upload rate")}
        />
      </span>
    </div>
  );
}

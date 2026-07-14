import { useT } from "../i18n";

export default function BetaBadge({ className = "" }: { className?: string }) {
  const t = useT();
  const warning = t("common.betaWarning", "Beta feature. It may be unstable or change without notice.");
  return (
    <span
      className={`qx-beta-badge${className ? ` ${className}` : ""}`}
      title={warning}
      aria-label={warning}
    >
      {t("common.beta", "Beta")}
    </span>
  );
}

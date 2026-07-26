/** Keep numbered annotation labels readable against the selected fill color. */
export function captureNumberForeground(color: string): "#111111" | "#ffffff" {
  const normalized = color.trim().toLowerCase();
  return normalized === "#fff" || normalized === "#ffffff"
    ? "#111111"
    : "#ffffff";
}

export function captureNumberOutline(color: string): string {
  return captureNumberForeground(color) === "#111111"
    ? "rgba(0,0,0,.72)"
    : "rgba(255,255,255,.92)";
}

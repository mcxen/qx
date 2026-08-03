const URL_ATTRS = new Set(["href", "src", "xlink:href", "formaction"]);

/** Legacy HTML presentational attrs that force theme-breaking colors. */
const PRESENTATIONAL_COLOR_ATTRS = new Set([
  "bgcolor",
  "color",
  "text",
  "link",
  "vlink",
  "alink",
  "bordercolor",
]);

/**
 * Inline style properties that override Qx theme (background, text, accents).
 * Structural props such as margin/padding/display are preserved.
 */
const THEME_STYLE_PROPS = [
  "color",
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "background-attachment",
  "background-clip",
  "background-origin",
  "background-blend-mode",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "caret-color",
  "accent-color",
  "column-rule-color",
  "fill",
  "stroke",
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "-webkit-text-stroke",
] as const;

function isDangerousUrl(value: string): boolean {
  return value.trim().replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase().startsWith("javascript:");
}

export function stripDangerousHtmlAttributes(root: ParentNode): void {
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || (URL_ATTRS.has(name) && isDangerousUrl(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  });
}

const THEME_STYLE_PROP_SET = new Set<string>(
  THEME_STYLE_PROPS.map((prop) => prop.toLowerCase()),
);

/** Match `color:` / `background*` / fill etc. even when CSSOM keeps vendor junk. */
function isThemeStyleDeclaration(declaration: string): boolean {
  const prop = declaration.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!prop) return false;
  if (THEME_STYLE_PROP_SET.has(prop)) return true;
  if (prop === "color" || prop.endsWith("-color")) return true;
  if (prop.startsWith("background")) return true;
  if (prop === "fill" || prop === "stroke") return true;
  if (prop.includes("shadow")) return true;
  return false;
}

/**
 * Remove author-supplied background / text / accent colors so host CSS tokens win.
 * Used by RSS (and similar) HTML readers that re-theme third-party content.
 */
export function stripAuthorThemeStyles(root: ParentNode): void {
  root.querySelectorAll("*").forEach((node) => {
    const el = node as HTMLElement;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (PRESENTATIONAL_COLOR_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
      }
    }

    // <font color="…"> is the classic feed-path for forced body text colors.
    if (el.tagName === "FONT") {
      el.removeAttribute("color");
      el.removeAttribute("face");
      el.removeAttribute("size");
    }

    if (!el.hasAttribute("style")) return;

    // CSSStyleDeclaration normalizes longhands; drop theme-breaking props only.
    for (const prop of THEME_STYLE_PROPS) {
      el.style.removeProperty(prop);
    }

    // Shorthands that often embed solid accent/background colors from CMS HTML.
    // Keep border-width/style if they survive as longhands after removing color.
    const border = el.style.getPropertyValue("border");
    if (border && /#|rgb|hsl|hwb|lab|lch|color-mix|var\s*\(/i.test(border)) {
      el.style.removeProperty("border");
    }
    const outline = el.style.getPropertyValue("outline");
    if (outline && /#|rgb|hsl|hwb|lab|lch|color-mix|var\s*\(/i.test(outline)) {
      el.style.removeProperty("outline");
    }

    // Raw attribute pass: some serializations leave `color:… !important` that the
    // CSSOM view still reflects until the attribute is rewritten.
    const raw = el.getAttribute("style");
    if (raw) {
      const kept = raw
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !isThemeStyleDeclaration(part));
      if (kept.length === 0) el.removeAttribute("style");
      else el.setAttribute("style", kept.join("; "));
    }

    if (!el.getAttribute("style")?.trim()) {
      el.removeAttribute("style");
    }
  });
}

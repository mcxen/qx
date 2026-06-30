const URL_ATTRS = new Set(["href", "src", "xlink:href", "formaction"]);

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

const MAX_TITLE_CHARACTERS = 60;
const MAX_TITLE_SOURCE_CHARACTERS = 4096;

function plainTitle(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A local preview of provider-supplied reasoning; never invents or requests a summary. */
export function reasoningStepTitle(text?: string): string {
  if (!text) return "";
  let firstLine = "";
  let heading = "";
  let fence: string | undefined;
  for (const rawLine of text.slice(0, MAX_TITLE_SOURCE_CHARACTERS).split(/\r?\n/)) {
    const line = rawLine.trim();
    const marker = line.match(/^(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;
    const title = plainTitle(line);
    if (!/[\p{L}\p{N}]/u.test(title)) continue;
    if (!firstLine) firstLine = title;
    if (/^#{1,6}\s+/.test(line) || /^\*\*[^*]+\*\*[:：]?$/.test(line)) {
      heading = title;
      break;
    }
  }
  const title = heading || firstLine.match(/^.*?[。！？!?](?:\s|$)?|^.*?\.(?:\s|$)/u)?.[0]?.trim() || firstLine;
  const characters = Array.from(title);
  return characters.length > MAX_TITLE_CHARACTERS
    ? `${characters.slice(0, MAX_TITLE_CHARACTERS - 1).join("")}…`
    : title;
}

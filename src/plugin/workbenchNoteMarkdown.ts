/**
 * Narrow Markdown extension for Workbench card notes.
 *
 * Cards intentionally keep `skipHtml` enabled.  This plugin admits only the
 * exact, attribute-free <u> and </u> pair emitted by the editor and turns it
 * into a controlled mdast node.  All other raw HTML remains filtered out.
 */

interface WorkbenchMarkdownNode {
  type: string;
  value?: string;
  children?: WorkbenchMarkdownNode[];
  data?: Record<string, unknown>;
}

const OPEN_UNDERLINE = /^<u\s*>$/i;
const CLOSE_UNDERLINE = /^<\/u\s*>$/i;

function isUnderlineOpen(node: WorkbenchMarkdownNode): boolean {
  return node.type === "html" && OPEN_UNDERLINE.test(node.value || "");
}

function isUnderlineClose(node: WorkbenchMarkdownNode): boolean {
  return node.type === "html" && CLOSE_UNDERLINE.test(node.value || "");
}

function transformChildren(children: WorkbenchMarkdownNode[]): WorkbenchMarkdownNode[] {
  const nested = children.map(transformNode);
  let depth = 0;
  let hasUnderline = false;
  for (const node of nested) {
    if (isUnderlineOpen(node)) {
      hasUnderline = true;
      depth += 1;
    } else if (isUnderlineClose(node)) {
      hasUnderline = true;
      depth -= 1;
      if (depth < 0) return nested;
    }
  }
  if (!hasUnderline || depth !== 0) return nested;

  const output: WorkbenchMarkdownNode[] = [];
  const stack: Array<{
    parent: WorkbenchMarkdownNode[];
    children: WorkbenchMarkdownNode[];
  }> = [];
  let current = output;
  for (const node of nested) {
    if (isUnderlineOpen(node)) {
      const underlineChildren: WorkbenchMarkdownNode[] = [];
      stack.push({ parent: current, children: underlineChildren });
      current = underlineChildren;
      continue;
    }
    if (isUnderlineClose(node)) {
      const frame = stack.pop();
      if (!frame) return nested;
      const underline: WorkbenchMarkdownNode = {
        type: "underline",
        children: current,
        data: { hName: "u" },
      };
      current = frame.parent;
      current.push(underline);
      continue;
    }
    current.push(node);
  }
  return stack.length ? nested : output;
}

function transformNode(node: WorkbenchMarkdownNode): WorkbenchMarkdownNode {
  if (node.children) node.children = transformChildren(node.children);
  return node;
}

/** Remark plugin for the deliberately small Workbench underline extension. */
export default function remarkWorkbenchUnderline() {
  return (tree: WorkbenchMarkdownNode) => {
    transformNode(tree);
  };
}

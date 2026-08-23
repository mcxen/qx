## Qx Logo Reference Method

Use this reference when creating or reviewing a Qx community-plugin icon. It turns a
real product mark into a distinct, small-format Qx icon without treating the source
logo or a reference screenshot as production artwork.

### Approved Qx style references in this checkout

When a visual comparison is useful, inspect the current formal assets rather than
copying them into a new plugin:

| Asset | Use it to compare |
| --- | --- |
| `qx-plugins/src/qxweibo/icon-generated.png` | Monochrome dominant mark, one red accent, and large calm negative space |
| `qx-plugins/src/qxtieba/icon-generated.png` | Filled symbol, speech/community cue, and the pale paper buffer |
| `qx-plugins/src/qxcoolapk/icon-generated.png` | Bold geometric reduction, coarse ink, and restrained registration offset |
| `qx-plugins/src/qxheihe/icon-generated.png` | Heavy line/shape balance and small-size silhouette strength |

These are **style and quality references only**. The new plugin must use its own
semantic anchor; do not reuse an eye, speech bubble, loop, or other reference symbol
unless it is genuinely the plugin's subject.

### 1. Classify the references

Keep these inputs separate in the prompt and in your notes:

| Reference | What it contributes | What it must not contribute |
| --- | --- | --- |
| Official logo, app icon, or brand-assets page | Recognition cue: silhouette, gesture, geometry, or product accent | Pixel-perfect tracing, copied wordmark, trademark decoration, or unrelated brand colors |
| Approved Qx icon | Family language: pale-gray paper, coarse ink, frame size, corner rounding, safe area, and registration texture | The other plugin's subject or a generic symbol reused across plugins |
| Plugin UI / product context | The actual feature meaning and the most useful semantic object | Dense screenshots, tiny controls, UI cards, or text-heavy layouts |

If no official mark is available, use the strongest industry-standard semantic cue,
then make the plugin name and feature behavior the source of truth. Do not invent a
fake official logo.

### 2. Write the reference brief

Before prompting, fill these fields:

```text
Plugin:
Semantic anchor: one object, silhouette, or gesture:
Official/product cue to preserve:
Qx style cue to borrow:
Product accent (one color):
Shapes allowed (1–3, maximum 5 major parts):
Details to remove:
Small-size failure to avoid:
```

The semantic anchor should be expressible in one short phrase. If it needs a
sentence, it is still too complex for a 24px icon.

### 3. Reduce before styling

Use this order:

1. **Signal** — select the single cue that makes the plugin recognizable.
2. **Reduction** — turn it into one silhouette or a few bold strokes; remove UI,
   labels, gradients, tiny counters, and secondary objects.
3. **Composition** — place it inside the fixed Qx tile and safe area. Do not enlarge
   the frame to accommodate a wide or tall source logo.
4. **Ink treatment** — apply pale-gray oil-paper, charcoal ink, one accent, coarse
   screen-print grain, and at most one restrained registration offset.
5. **Small-size review** — inspect at 24px, 32px, and 64px. If the symbol becomes a
   blob, loses its hole/gesture, or reads as another plugin, simplify again.

The source logo answers “what is this?” The Qx treatment answers “does it belong in
this app?” Never let texture replace recognition.

### 4. Reference-wall rules

When the user asks for four versions or a logo wall:

- Lock the tile bounds, transparent margin, corner radius, paper tone, line weight,
  and texture across all candidates.
- Vary only one axis per candidate: filled vs outline, geometric vs organic reduction,
  symbol orientation, or accent placement.
- Use `icon-generated-vN.png` for candidates. Keep the production path
  `icon-generated.png` unchanged until approval.
- Compare the wall at the same displayed size. Reject any candidate with a larger
  tile, a smaller subject, edge contact, clipping, unintended text, or a texture level
  that overwhelms the symbol.

### 5. Formalization and store sync

After approval, promote only the selected candidate to `icon-generated.png`. Point
`manifest.json` at that exact path, remove retired main-logo files that can be chosen
by filename fallback, and preserve only explicitly referenced command artwork.

Then run the plugin packaging and static-store build. Confirm that the archive and
`store/public/icons/` both contain the promoted file. A successful local build or
uploaded artifact is not a Cloudflare Pages deployment: check that the Pages deploy
step ran and that the public URL serves the new image. If the deploy step is skipped,
stop and report the missing Cloudflare credentials instead of claiming the URL is
updated.

# Style bible

The one page every prompt and every review is checked against. Decided 2026-09-15 from the tests in `docs/art-direction.md`.

## The look

Stylised flat painting. Clean silhouettes, a little painted texture inside shapes, one soft shadow tone, no outlines,
no gradients, no rim light, no photorealism. Warm with gravity: a picture book for adults. The anchor is
`art/anchors/anchor-village.png`; everything is generated with it attached as the style reference.

## Camera

Three-quarter overhead, the same angle as the anchor: you see roofs and one or two walls. Light from the upper left,
always. Shadows fall down and to the right, short and soft.

## Palette

Built world: warm greys and ochres `#8c6d4a #a58462 #c9a66b #d8c8a8 #5a3d28`. Land: four muted greens and one wet
green `#8fae5a #6f9a4a #4f7a3a #a8955c #6f8f5c`. Water: slate blue `#4f86b8 #3f79ad`. Lineage colours are the only
saturated hues and come from the game, never from the art. Winter desaturates by a fixed step in the renderer.

## Materials and forms

Hide, reed, timber, fieldstone, clay, wool. A tent is a taut hide cone; a hut is round with a thatched cone roof; a
big house is longer with a ridged roof; a granary stands on stilts with a raised floor; a workshop is low with a
chimney; a lookout is a timber tower with a platform; a palisade is a ring of sharpened stakes.

## The motif

Wind and water: a carved or painted band of spirals and wave-lines on eaves, boat prows, pennants and pottery. It is
the only ornament. It belongs to no real people.

## Never

No faces at map scale. No text or lettering. No real-world cultural markers (feathers, torii, horned helmets, runes,
totem poles, pagodas). No rim light. No outlines. No gradients. No photorealism. No named artist or game in a prompt.

## Prompt skeleton

"[subject], in the style of the attached reference: stylised flat painting, clean shapes, a little painted texture,
one soft shadow tone, no outlines, no gradients, lit from the upper left, three-quarter overhead view. Single object
centred on a plain flat magenta background (#FF00FF), nothing else in frame, no text."

## Prompt lessons (first pass, 2026-09-15)

Four failure modes, each fixed in `scripts/art/gen.py` or the manifest, all worth remembering:

- **The anchor dominates.** Asking for "a single small villager … keep it simple enough to read at twelve pixels"
  made the model redraw the anchor village with a speck in it, nine times out of twelve. The subject must be told to
  stand alone and fill the frame, and the reference must be named as style-only: "Do not draw a village, huts, fields
  or any scenery; the reference is for palette, line and shading only." Say "reads when shrunk to a thumbnail",
  never "small" or "tiny".
- **The motif spreads.** One line permitting spirals "where the subject calls for it" carved them into boulders,
  bushes, dunes and tree trunks. The rule is now per group: buildings get one band on an eave, boats a prow spiral,
  wild nature gets an explicit prohibition ("untouched by people: no carved ornament, no spirals, no borders").
- **Overhead means overhead.** Ground textures asked for "seen from above" came back as isometric tiles with
  decorative frames. They need "straight down from directly overhead, orthographic, fills the square frame edge to
  edge, no border, no tile edge, no thickness".
- **Materials drift.** "Ploughed earth in furrows" produced convincing wood grain. Naming the material against its
  near-miss fixes it: "it is soil, not timber: crumbly and granular, never wood grain."

Two mechanical rules: forbid the painted drop shadow (it darkens the magenta ground into something the chroma key
misses, and the renderer draws its own), and version the atlas URL by content hash (a repack under the same name is
served from cache).

## More prompt lessons (terrain pass, 2026-09-16)

- **"A second variant" is read as "show me a comparison."** Asking for a second version of a texture produced a 2×2
  sheet of four samples with white dividers, which tiled across the map as a grid of seams. Variation has to be
  written into the subject ("with the detail arranged differently across the square"), never as a meta-instruction,
  and the prompt must forbid the artefact outright: "a single continuous texture, not a grid, not four panels, not
  a comparison sheet, no dividing lines."
- **Painted ground replaces the procedural marks entirely.** Where a terrain has a texture, the old glyph decor must
  not draw over it, even when that means drawing nothing: the leftover wave strokes on water read as scratches.
- **A canopy texture is already the trees.** Forest keeps one scattered tree per tile instead of five, or the tile
  doubles up.
- **Tiled draws need an inset.** Sampling a sprite to its very edge pulls in the transparent gutter between atlas
  entries and shows as a pale seam on every tile boundary; half a pixel of inset and a four-pixel gutter fix it.

Icons are drawn by hand rather than generated. They have to take their colour from the surrounding text and stay
legible at sixteen pixels, and a painted sprite can do neither.

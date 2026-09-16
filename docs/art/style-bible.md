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

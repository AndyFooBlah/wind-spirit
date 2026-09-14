# Art direction and the art pipeline

Draft, 2026-09-14. The game runs on placeholder art: flat terrain colours with procedural decor, a glyph per building,
dots for people. This note argues for a style, names what has to be drawn, and lays out how to make it, at what cost,
and under what rights. Decisions marked **open** are yours.

## 1. Style

### Realistic or gamified

Gamified, and specifically **stylised flat painting**: clean shapes, a little painted texture, soft shadows, no outlines
thicker than a hair, no photorealism. Three reasons, all about the sim rather than taste.

- The world is a grid of 12-mile tiles and a village is a 12 × 12 grid of plots. Nothing on screen is at a real scale,
  and realism draws attention to that. Stylised art makes the abstraction feel chosen.
- Legibility beats fidelity here. A tile has to read as forest or marsh at 24 pixels on the region zoom and at 64 on
  the local zoom; a building has to read as granary or lookout at 40 pixels. Simplified silhouettes do that,
  rendered detail turns to mud.
- Consistency is the hard part of generated art, and flat, low-detail styles are far easier to keep consistent across
  a few hundred assets than painterly or photographic ones.

The references to have in mind: Dorfromantik's tiles, Islanders, Carto, the illustrated maps in older Ordnance Survey
guides, and printed woodcut-and-watercolour children's atlases. Not Civilization, not anything with rim lighting.

### Cute or serious

**Warm, with gravity.** The game is about trust, hunger, raids and dying villages, and a cute style would sell those
short: a village starving in a chibi style is a joke. But grim art would fight the rest of the experience, which is
slow, pastoral and mostly about watching people get on with things. The register to aim for is a well-made picture
book for adults: rounded but not bubbly, earnest, a little melancholy in winter. People are small figures with posture
and no faces at map scale; portraits (chiefs, the sun spirit) can carry faces and should be drawn with dignity.

### A cultural theme, or none

**Invented, deliberately.** Avoid recognisable references to any real neolithic or pre-industrial culture, for three
reasons that reinforce each other.

- The tech tree is already invented and obfuscated so that chiefs cannot lean on real history; the art should keep
  that promise. A recipe called "kaime mask" should not look Inuit, Yoruba or Māori.
- Borrowing a real people's material culture as flavour for a game about villages that fail and get raided is a
  trap, ethically and in reviews. Pastiche ("feathers, torii, horned helmets") is worse than neutral.
- An invented design language is what makes the game look like itself.

What "invented" means in practice: ground everything in universal materials (hide, reed, timber, fieldstone, clay,
wool) and universal forms (a lean-to, a round hut, a raised store, a palisade), then commit to a house motif system
that is nobody's. Proposal: **wind and water as the ornament** — spiral and wave lines carved or painted on eaves,
boats, pennants and pottery, since the two spirits are the wind and the sun and the world is an island in a sea. Each
lineage gets its colour (already in the game) and one motif variant, so colonies read as family without heraldry.

**Open:** a palette. My proposal is a restrained one: warm greys and ochres for the built world, four muted greens
and one wet blue-green for the land, a cool slate blue for water, and lineage colours as the only saturated hues so
they always read. Winter desaturates everything by a fixed step (the renderer already tints by season).

## 2. What has to be drawn

Counting from the current renderer and sim. Numbers are assets, not prompts; each needs a few variants.

| group | items | notes |
|---|---|---|
| terrain tiles | 11 terrains × 3–4 variants, plus coast, river and ford transitions | seamless at 24 and 64 px; transitions are the expensive part (a 4-bit autotile set is 16 pieces per boundary) |
| tile decor | trees, scrub, rocks, reeds, dunes, snow cover per season | overlaid, so tiles stay simple |
| water | ocean, lake, river with a flow direction; boats at map scale | |
| village plots | wild ground per terrain, cleared, field bare / planted / ripe / fallow, three growth stages | the plot grid is the most-looked-at surface in the game |
| buildings | tent, hut, big house, granary, workshop, smokehouse or kiln, lookout, palisade, wall; two size tiers of the shelters; under-construction frame | recipes are generated, so art is keyed to what a structure *does* (shelter, storage, watch, defence, craft), not to its name |
| people | child, adult, elder × standing, walking, working, sitting; the chief marked | 4-direction is a luxury; 2 (left/right) is enough at this scale |
| parties | explorers, settlers, envoys, raiders, refugees, expedition, each on foot / with cart / by boat | small, mostly silhouette and lineage colour |
| effects | storm spiral, hunger ring, prayer mark, smoke | |
| portraits | chiefs by trait, the sun spirit, the wind spirit | generated per village from traits; the one place faces belong |
| UI | icons for the 20 goods categories and 20-odd capabilities, season and weather glyphs, breath, trust, the pennant | vector, one style, one weight |

Roughly 250 to 400 finished assets once variants and states are counted. That is a small game's worth, and well within
what one person can direct and curate in a couple of weeks if generation is cheap and the review loop is fast.

## 3. How to make it

### The principle: a style bible first, then everything against it

Generated art goes wrong through drift: each image is fine and the set is a mess. The fix is to spend the first
effort on a **style anchor**, a single sheet (or four) that fixes palette, line, shading, proportion and motif, and
then generate every asset with that sheet as a reference image, in one session per group, with the same prompt
skeleton. The anchor is the thing to iterate by hand; the assets are the thing to mass-produce.

### Two kinds of asset, two tools

- **Vector for anything symbolic**: UI icons, goods, capabilities, pennants, season glyphs, and probably the
  buildings and party markers too. Vector output is tiny, scales to every zoom, recolours by CSS (lineage colours for
  free), and is easy to fix by hand. Recraft's vector models output real SVG and can lock a style from reference
  images without training; a vector image costs $0.08 (V4.1) to $0.30 (Pro) from their API unit price of $0.001.
- **Raster for the land**: terrain tiles, decor, water, plots, and the painted feel in general. Here the choice is
  between the Gemini image models on Vertex (already wired: same project, same service account, no new keys) and
  a game-asset tool with trainable styles.

### Candidate tools, checked against their live pages on 2026-09-14

| tool | strengths for this | cost | rights |
|---|---|---|---|
| Gemini 3 Pro Image (`gemini-3-pro-image`, Vertex and Gemini API) | up to 14 reference images including 3 style refs and 5 characters; conversational editing; strong text-free consistency | $0.134 per 1K/2K image | Google's terms grant the user the output; no training-data indemnity to rely on |
| Gemini 3.1 Flash Image (`gemini-3.1-flash-image`) | same reference-image workflow, 512 px to 4K | $0.067 per 1K image | as above |
| Gemini 3.1 Flash-Lite Image | volume variants once the anchor is fixed | $0.034 per 1K image | as above |
| Imagen 4 (`imagen-4.0-generate-001`, Vertex) | subject and style customisation as a product feature | not on the pricing page I could read; check before use | as above |
| OpenAI gpt-image family (`gpt-image-2`, `-1.5`, `-1-mini`) | good at following edits; per-image cost only via their calculator | token-priced, roughly a few cents to a dime per image | user owns output |
| Recraft V4.1 (raster and vector) | SVG output; style from references without training; background removal and vectorise as API calls | raster $0.035, vector $0.08, Pro vector $0.30, background removal $0.01 | paid plans: full ownership and commercial rights |
| Scenario | trains a LoRA on 15–50 of your own images and then keeps to it; built for exactly this | from $15 a month, training from about $45 | check their terms; subscription, not per image |
| Leonardo | cheaper cousin of Scenario, fine-tuning, transparent PNG | $12 to $48 a month | check their terms |
| FLUX (Black Forest Labs) | strong open-weights lineage; the API page I could read showed no per-image prices | unknown from the page | the [dev] weights are non-commercial; API terms differ; check |

Recommendation: **Gemini 3 Pro Image for the anchor and the raster sets, Recraft vector for the symbolic sets, and
nothing that needs a subscription until the pipeline has produced a first full pass.** If consistency across the
raster sets proves hard with reference images alone, Scenario's trained style is the fallback, and its training set
would be our own anchor images, which is the only training input we should ever give anyone.

### Expected cost

A first full pass: 400 assets, each generated four times to pick from, plus a hundred anchor iterations, is about
1,700 images. At the Pro image price that is about $230; at the Flash image price about $115; the vector work is
about 150 SVGs at $0.08 to $0.30, so $15 to $45. Call the first pass **$150 to $300**, and each later revision pass
a third of that. This is small next to the model bill for a single played game, and it means we can afford to throw
most of what we generate away, which is the whole trick.

### The pipeline

1. **Style bible** (a page in this repo): palette hex values, line weight, light direction (upper left, always),
   shading rule (one shadow tone, no gradients), proportion rules (a hut is two people tall), the motif system, and
   ten hard "never"s (no faces at map scale, no text, no real-culture markers, no rim light, no outlines).
2. **Anchor sheets**: four images made by hand with the Pro model and editing turns: a terrain sampler, a building
   sampler, a people sampler, an icon sampler. Iterate until they agree with each other. These are the reference
   images for everything after.
3. **Generation scripts** (`scripts/art/`): one prompt template per asset group, the anchor sheets attached as style
   references, the sim's own lists as the source of truth for what to draw (terrains from `params.ts`, structure
   roles from the recipe outputs, goods categories from `types.ts`). Four candidates per asset, seeded, saved with
   their prompts.
4. **Post-processing**: background removal (Recraft's endpoint, or `rembg` locally), palette quantisation to the
   bible's palette so nothing drifts in hue, downscale with a good filter to the target sizes (24, 64 and 128 px),
   pack into atlases with a JSON manifest.
5. **Review**: a contact sheet per group in the browser (an HTML page under `out/art/`), accept or reject per
   candidate, regenerate rejects with the accepted ones added as references. This is the human authorship step, and
   it should be recorded (see rights).
6. **Integration**: the renderer draws from the atlas by key (terrain id, structure role, person stage and activity,
   party kind) and falls back to today's glyphs for anything missing, so art can land group by group.

### Rights, in one paragraph each

**Copyright in the output.** Under the US Copyright Office's 2025 report, purely AI-generated images are not
copyrightable, and prompts alone do not make them so; human selection, arrangement and modification can be
protected, evaluated case by case. For a game that is fine in practice (nobody is going to sell our tiles), but it
argues for keeping the human authorship visible: the style bible, the hand-iterated anchors, the curation log, the
palette pass and the atlas arrangement are ours in a way the raw generations are not. Keep the rejected candidates
and the review log in the repo's history.

**Licences from the tools.** Google's and OpenAI's terms assign the output to the user; Recraft grants full commercial
rights on paid plans; FLUX [dev] weights are non-commercial, so use FLUX only through a commercial API if at all;
Scenario and Leonardo need their current terms read before a subscription. None of these offers an indemnity we
should plan around.

**Training-data risk.** The style should not imitate a named living artist or a named game; the prompts should
describe the look ("flat painted, woodcut-and-watercolour picture book") and never name one. That is both the right
thing and the practical way to keep a style that is ours.

## 4. Decisions to make

1. **Style**: stylised flat painting, warm with gravity. Look at the three style tests before deciding.
2. **Culture**: invented, wind-and-water motif, no real-culture references. A hard rule in the style bible.
3. **Palette**: the restrained proposal above, or something bolder.
4. **Tools**: Gemini Pro Image plus Recraft vector to start; Scenario only if consistency fails.
5. **Order of work**: plots and buildings first (the most-looked-at surface), then terrain, then people, then icons,
   then portraits.

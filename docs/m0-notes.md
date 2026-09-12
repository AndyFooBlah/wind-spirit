# M0 notes: what the balance harness taught us

*2026-09-12. Companion to technical-design.md §16. Numbers below are the calibrated values in `packages/sim/src/params.ts`.*

M0 delivered the pure sim, the world generator, scripted chiefs, and the harness. The suite (`pnpm harness -- assert --seeds 10`) runs eleven checks: determinism, replay, and the balance ladder from the concept. All pass. Getting there took eight tuning rounds; each round was a real design lesson, recorded here so nobody re-learns them.

## The ladder as measured

| Scenario | Result |
|---|---|
| Foragers starting at 20, 100 years | 92–93% of villages survive; the wild ceiling is about 40–50 people |
| Foragers starting at 50, 60 years | median falls to about 42 |
| Farmers without expansion, 150 years | median peak about 110; hunger is 46% of deaths |
| Sensible chiefs (farm, explore, colonize), 300 years | civilization persists in every seed; median first colony at year ~43; about 150–170 villages founded; hunger 41% of deaths; ~800 path tiles |

A 64 × 64 world fills up in about 300 years at ~1.3% annual growth. That is the intended pressure, and it says larger worlds or slower growth will matter once the map is visible.

## Lessons

1. **Fresh food cannot build stores.** Wild plants spoil in four weeks, meat in two, fish in two. Summer surplus is wasted and every winter is a shortfall. Storage is therefore the first survival technology, not a convenience: foragers with a granary (spoilage ×3) hold the winter; without one they dwindle. The M0 forager policy builds one at population 15.

2. **Starvation must be rationing, not selection.** The first model let a few people starve outright while everyone else ate; with cubic hunger mortality a village lost half its people in eight weeks. Now everyone eats the same reduced share and hunger accumulates as a fraction of a week. Deaths still happen, but populations get time to respond.

3. **Births regulate before deaths do.** Any birth gate that resets on "any hunger" produced a demographic spiral: mild winter hunger each year kept births below replacement until four workers were feeding ten people. Births now scale with a 25-week moving average of the shortfall fraction, and stop only when the village has been about 40% short on average. That is a smooth Malthusian regulator.

4. **Working life sets the ceiling.** Adults 15–55 with a high birth rate gave villages sixteen children and four elders on nine adults by year 15. Adulthood is now 14–60. This alone moved forager survival from 78% to 93%.

5. **Farming needs a plot cap.** A farm order runs every week of spring, so without a cap it plants every cleared plot and fertility collapses in ten years. The order carries a plot count and the sim plants the most fertile plots first, which yields a one-in-two rotation. Chiefs will need to learn this, or be told.

6. **A hard winter must not hit every source.** Halving all food in a hard winter killed villages with no stores outright. It now halves foraging and cuts hunting and fishing by a quarter, plus higher exposure. Hard winters still hurt.

7. **Hunt in winter, forage in summer.** The scripted policy reallocates by expected yield per source each season. Any chief prompt should present expected yields per source so an LLM chief can do the same.

8. **Never let hunger block planting.** The first farmer policy skipped planting when the village was hungry in spring, guaranteeing famine in autumn. Planting is the response to hunger, not something to postpone.

## Calibrated parameters worth knowing

| Parameter | Value |
|---|---|
| Yield per worker-week at full stock | forage 3.5, hunt 3.0, fish 4.0 person-weeks |
| Winter factors | plants 0.15, game 0.8, fish 0.6 |
| Regrowth per week | plants 5% (growing season), game 2%, fish 3%, timber 0.5% |
| Harvest per plot | 50 person-weeks at full fertility; −0.15 fertility per harvest, +0.05 per fallow season |
| Annual mortality | children 3%, adults 1.2%, elders 6% + 1.5% per year past 60 |
| Births | 10% per adult per year, scaled by hardship |
| Paths | +1 per party crossing, +2 per cart, 2% weekly decay, path at 6, road at 20 |

## Tools

- `pnpm harness -- run --seeds N --years Y --policy forager|farmer|sensible --pop P --out DIR` writes `rows.csv` and `report.html`.
- `pnpm harness -- assert --seeds N --out DIR` runs the suite and writes one report per scenario; exits non-zero on failure. CI runs it with six seeds.
- `packages/harness/src/debug.ts <seed> <policy> <pop> <years> <village>` prints a weekly trace of one village: orders, production, stores, hunger, stock fractions, fields, grain. This is how every lesson above was found.
- `packages/harness/src/sites.ts` prints site quality for villages by seed.

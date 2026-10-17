# Wind Spirit journal

Append-only. Every entry starts with a UTC timestamp and a tag: `[step]`, `[decision]`, `[friction]`,
`[learning]`, `[surprise]`, `[incident]`, `[idea]`, `[milestone]`. Never edit or delete a past entry; to correct
one, append a new entry naming the earlier one's timestamp.

Entries before 2026-10-16T17:30Z were backfilled on 2026-10-16 from the git history, the issue tracker,
`docs/build-notes.md`, `docs/evals-notes.md`, `docs/art-direction.md` and `docs/art/style-bible.md`, and the
session transcripts. Timestamps for those are the commit times they correspond to, so they are accurate to the
commit rather than to the moment of the decision, and entries with no commit of their own are placed at the
nearest one. Everything from 2026-10-16T17:30Z on is written as the work happens.

Owner decisions are quoted. The owner is Andy (`AndyFooBlah`); everything else was decided by Claude.

---

## Concept and M0

- 2026-09-11T23:43Z [milestone] Concept settled and written up (`docs/concept.md`, ce2eed4). The hook: the spirit is
  omniscient and nearly powerless, the chief is ignorant and potent, and trust is the only score.
- 2026-09-11T23:47Z [decision] Owner settled the open concept questions in one pass: the UI shows seasons and time,
  full history with scrubbing, game speeds, and the spirit influences weather. Technical design drafted (3bde463).
- 2026-09-12T00:02Z [decision] M0 technical decisions settled (aa46155): week tick, event-sourced deterministic sim,
  integers in thousandths, named-stream PRNG, tech as recipes with obfuscated names, 12×12 plots, paths worn by use.
- 2026-09-12T00:43Z [milestone] M0 landed: deterministic sim core, world generator, balance harness (d440e62).
- 2026-09-12T00:44Z [friction] pnpm 11 CI fought the build-script approvals for five commits (8178c7c…398bf17):
  `onlyBuiltDependencies` moved to `pnpm-workspace.yaml`, then became `allowBuilds`, and pnpm wrote placeholder
  entries once that had to be rewritten by hand.
- 2026-09-12T07:35Z [decision] Balance tuning happens only through the harness, never by hand-editing outcomes;
  legacy toggles kept behind `WS_PARAMS` so the tuning history stays reproducible (e32e2ba).

## M1 to M7, in one sitting

- 2026-09-12T07:58Z [decision] Owner: *"let's do M1 to M7, stopping only if you get stuck"*. Seven milestones ran
  without checkpoints.
- 2026-09-12T07:58Z [milestone] M1: tech skeleton, seeded generator, research, crafting, capabilities (60bc318).
- 2026-09-12T08:46Z [milestone] M2: chief agent, scheduler, model proxy, envoys, raids (fe26421).
- 2026-09-12T08:56Z [learning] Fresh food merged into older stacks, so a full granary aged to nothing. Stack merging
  now has a one-week window (dc1fe29). A whole class of famine bugs came from this.
- 2026-09-12T09:04Z [milestone] M6: audio engine, synthesised and seeded, speed-aware (611dae6).
- 2026-09-12T09:06Z [decision] Famine mortality is quadratic and capped, and settlers may never hollow out a village
  (b152b30): starvation should be a spiral, not a cliff.
- 2026-09-12T09:23Z [milestone] M3/M4: the web app — sim in a worker, three-zoom canvas map, panels, speeds,
  auto-pause, saves, and the spirit's whisper, dream and breath. Deployed to Firebase Hosting (0060195).
- 2026-09-12T09:45Z [milestone] M5/M6: history scrubber in a second worker, narrative synthesis, audio integrated
  (3f56982).
- 2026-09-12T09:49Z [learning] Integrating the sim into a worker surfaced five separate bugs at once (5ac03d7):
  bare `fetch` throws in a worker scope, the dream prompt needed its own prose-only form, chief memory had to ride
  on `ChiefDecided` to stay replayable, chiefs needed provisional habit orders while thinking, and the `Sim`
  constructor must not roll weather or a restored world hashes differently.
- 2026-09-12T09:50Z [milestone] M7 closed; issues #1–#8 closed; CI green; full balance suite passing on six seeds
  (f349a33).

## The model-cost study

- 2026-09-12T12:57Z [decision] Owner asked for larger worlds; sizes up to 128×128, default large, snapshots gzipped
  (875239f).
- 2026-09-12T15:54Z [decision] Owner commissioned a model-cost study: a categorised eval of about a hundred cases,
  six to eight near-frontier cheaper models, context caching, a mixed-model strategy, and an intelligence knob at
  roughly $1, $5 and $100 per century. Lab notebook opened (1645aa7, issue #9).
- 2026-09-12T15:59Z [step] 96-case corpus built from observed game states, rule scorer, LLM judge, runner, report
  (1f2b499).
- 2026-09-12T16:18Z [surprise] Vertex prices are roughly double the Gemini API list for the same model (8a15bff).
  Every cost estimate in the notebook had to be redone against the billing catalogue.
- 2026-09-12T17:08Z [learning] MaaS open models silently strip optional fields under constrained JSON decoding.
  They now use instruct-and-validate instead (f61c51a). Three models' first scores were this bug, not their ability.
- 2026-09-12T17:31Z [decision] Tiers shipped: habit, thrifty, standard (Flash-Lite routine + Flash impactful),
  lavish (24a0aa5).
- 2026-09-12T17:49Z [decision] Owner: *"I have an account with openrouter"* — OpenRouter added as a provider, key in
  Secret Manager, never in the repo (2bcdb5f, 51a0499).
- 2026-09-12T19:14Z [step] OpenRouter pass across 24 further models (fbde365).
- 2026-09-12T19:55Z [incident] The first notebook draft had two errors the post-writing caught: credulity counts
  quoted "of 15" when the corpus has 10 false-fallow cases, and costs mixed per-300-years with per-century. Both
  corrected before publication (2a477fa).
- 2026-09-12T19:55Z [milestone] Second blog post published: andrewbrook.dev/writing/wind-spirit-chief-models/.
- 2026-09-12T19:55Z [idea] Noted as follow-up: first-turn chief decisions can leave nobody on food.

## The first-spring miss and the golden audit

- 2026-09-12T20:33Z [decision] Owner: *"anything over 10s is pretty bad latency"* and *"Errors in the 'golden' eval
  answers are common in data science - let's highlight how we reviewed suspicious cases"*. A 10-second bar went into
  the report and a golden-answer audit was run (597f401, issue #10).
- 2026-09-12T20:33Z [learning] The eval never saw the failure a new player sees first. Its earliest routine case is
  week 110, by which time the scripted policy has built stores. Six first-spring cases added.
- 2026-09-12T20:33Z [learning] The prompt said "food for 7 weeks" and nothing about how long a decision lasts.
  Adding the cadence and the per-worker food arithmetic took 3.5 Flash-Lite from 8-of-9 first springs with nobody on
  food to none. The prompt did the work; the scheduler's food floor is only a backstop.
- 2026-09-12T20:33Z [learning] Four kinds of golden error found by asking which checks the strongest models fail:
  asking for the impossible (harvest with nothing planted), never stating the threat, demanding a food share of
  villages holding a year of stores, and corpus drift making old outputs unrescorable.
- 2026-09-12T22:30Z [step] Third eval pass: 25 models re-run from scratch on the corrected 102-case corpus (941eb61).

## Invitations, and a week of play features

- 2026-09-12T20:45Z [decision] Owner: *"the Wind Spirit game will need an invitation code and/or login to play so
  that I can invite my friends … without the whole internet trying it and running up my AI charges"*. The gate is
  enforced in the proxy, never only in the client (99127cc, issue #11).
- 2026-09-12T21:25Z [milestone] Villages became legible: buildings fixed to plots near the centre, fields in
  clusters, villagers placed by their work, parties drawn by kind, overview charts (9153f8b, issues #12–#19).
- 2026-09-12T21:25Z [decision] Villager activity is derived from the standing orders each week, never stored in the
  sim, so the live view and the history scrubber agree and it costs nothing when no village is open.
- 2026-09-12T21:43Z [decision] Owner renamed the omniscient advisor: *"maybe the most basic spirit (the AI the
  players can all talk to) should be sun spirit? The players can then be wind, earth, water, wood, fire, various
  animals."* Implemented as the sun spirit, three questions a year (a6c164a, issues #20–#22).
- 2026-09-12T22:28Z [decision] Owner: *"Water shoudn't have paths"* — boats leave no trail; treading skips water,
  fords excepted (f41ccd4).
- 2026-09-12T22:29Z [friction] Owner found attention events yanking the camera distracting. They now pause and toast
  without moving the view (a3c2838).
- 2026-09-12T22:44Z [milestone] Lineage colours, kinship between parent and colony, and abandoning a village to seek
  refuge (5fa1ea4, issues #23–#25).
- 2026-09-12T22:49Z [friction] Owner: the top bar shifted by a few pixels as week numbers gained a digit. Fixed with
  tabular figures and pinned widths (8bb9f00).
- 2026-09-12T22:50Z [decision] Owner: *"maybe call it 'region' and put it between local and global?"* — a fourth
  zoom at 24-pixel tiles (81b7b96).
- 2026-09-12T23:08Z [decision] Owner: *"maybe the edges of the world should always be ocean?"* — every world now
  ends in sea, two to five tiles deep (a18be43).
- 2026-09-12T23:13Z [incident] The ocean rim made shore villages common, and ocean carried the richest fish stock,
  so a village of 50 could live on wild food and the balance suite failed. Dropped the stock to 550, which passed on
  six and twelve seeds — then CI, which runs three, failed at a median of 46.25 against a bar of 45. Settled at 450
  (6abee37).
- 2026-09-12T23:13Z [learning] A median over three seeds is a coin toss near the bar. Anything touching geography
  gets checked on the CI sample too, before it ships.
- 2026-09-12T23:14Z [incident] The expedition test picked the nearest regional commodity by distance; with an ocean
  rim that tile sat across water and the party never came home. The test now picks a target it can walk to (0c9fe8a).

## Art

- 2026-09-14T15:27Z [decision] Art direction settled after three style tests (b677741, `docs/art-direction.md`):
  stylised flat painting, warm with gravity, and an invented culture with a wind-and-water motif — explicitly no
  references to real neolithic or pre-industrial peoples. Owner approved all four proposals.
- 2026-09-15T22:28Z [step] Pipeline built: style bible, asset manifest, generator against fixed anchors, chroma-key
  post-processor, atlas renderer with glyph fallback so art can land group by group (b783ad4, issue #26).
- 2026-09-15T22:48Z [learning] Four prompt failure modes, all recorded in the style bible: the anchor image dominates
  unless the subject is told to fill the frame; a permissive motif rule carves spirals into boulders and trees;
  "seen from above" yields isometric tiles with decorative borders; and "ploughed earth" yields convincing wood
  grain until the material is named against its near-miss.
- 2026-09-15T22:48Z [learning] The model's painted drop shadow desaturates the magenta ground past the chroma key,
  leaving a pink halo. Shadows are now forbidden in the prompt and the renderer draws its own.
- 2026-09-16T06:23Z [decision] Icons are hand-authored SVG, not generated: they must take their colour from
  surrounding text and stay legible at sixteen pixels, which a painted sprite cannot do (3c6d0a9).
- 2026-09-16T06:56Z [surprise] Asking for "a second variant" of a ground texture produced a 2×2 comparison sheet
  with white dividers, which tiled across the map as a grid of seams (f7ce9df). Variation has to be written into the
  subject, never as a meta-instruction.
- 2026-09-16T06:56Z [learning] Sampling a sprite to its very edge pulls in the transparent gutter between atlas
  entries: a pale line on every tile boundary. Half a pixel of inset and a wider gutter fix it. The atlas URL also
  needs a content hash, or a repack is served from cache.
- 2026-09-18T16:53Z [milestone] Portraits: eight chiefs and the two spirits, finishing the art milestone (a22d71e).
  Total generation spend across all art: about $25 for 186 candidates, against an estimate of $150–300.
- 2026-09-18T16:53Z [learning] The closing step of the xoshiro-style hash (`h ^= h >>> 13`) yields a *signed* 32-bit
  integer in JavaScript, so `h % n` went negative and the chief rendered as `portraits/undefined.png`. Every such
  hash needs a final `>>> 0`. The same mixer appears in three places.

## Judgment, and the tribute that was not cowardice

- 2026-09-17T14:35Z [step] Pluggable judgment adapter for the decisions that are labels rather than prose:
  credibility, verdict, host answer, with Jev and LLM implementations (d184c31, issue #27). Built by a second session.
- 2026-09-17T14:46Z [step] Fourth eval pass: Jev against the LLMs on the three judgments, plus an allocation probe
  (871ca29).
- 2026-09-17T14:46Z [learning] Jev cannot allocate labour. Independent per-task Scores cannot see one another, so
  ten tasks all rated "a good share" normalise to one hand on each. The checkers did not catch it either, which is a
  hole in the checks as much as a finding about the model.
- 2026-09-18T16:29Z [surprise] Issue #28 reported the standard tier paying tribute to weak bullies. The case was
  mis-specified, not the model: it sized the war band at a third of the *whole village* while a raid resolves on
  *adults*, so the "weak" bully was eight attackers against eleven defenders, which the sim's own combat model says
  wins two times in five. The models that paid were right (e70e71a).
- 2026-09-18T16:29Z [decision] A golden answer gets checked against the simulation, not against intuition. The game
  has a combat model; it could have said what "weak" meant at any point, and it disagreed with me.
- 2026-09-18T16:29Z [learning] The chief was told to weigh strength against strength and never told how many were at
  the gate. Both the prompt and the judgment state now carry the party size and the village's own reckoning of the
  odds, rather than asking a stone-age chief to do arithmetic. Both tier models then answer every host case correctly.
- 2026-09-18T16:43Z [incident] I reported "45 of 45" from a single run. Running the identical command seven times
  gives 45, 37, 41, 44, 45, 45, 40 — between 82% and 100%. The threat claim survived at six of six in every run;
  the overall figure was a lucky run (3c95810).
- 2026-09-18T16:43Z [learning] Count the observations behind a claim before writing it down. A category average of
  fifteen visitor cases, ten of them easy, hides a one-in-six failure completely. The report now breaks out every
  case kind where models disagree and prints how many cases sit behind each figure.
- 2026-09-18T16:43Z [incident] The published post carried the same undersampled claim ("3.8 Flash and 3.5 Flash-Lite
  refuse both"). Corrected in place and in a new section, *What two observations cannot tell you*, rather than
  quietly edited. The first version of that section was itself about finding golden errors, which is the
  uncomfortable part.

## The long watch

- 2026-09-18T17:51Z [milestone] A long unattended playtest command added (`pnpm harness -- playtest`): four worlds,
  three centuries, scripted chiefs, watching for mechanics that fire but never resolve (3674e55).
- 2026-09-18T17:51Z [surprise] It found a village idle and starving for fifty-five weeks. The work loop excludes the
  chief from the workforce, so a village down to one adult has nobody who may be given an order: the policy returns
  nothing, the sim does nothing, and it dies with a chief standing in it. The chief now works when there are two
  adults or fewer, or stores are under two weeks.
- 2026-09-18T17:51Z [learning] My first hypothesis — that abandonment was failing to find a route and dropping the
  order — was a real bug and was fixed, but it was not this one. Tracing one village week by week found it in a
  single line: `adults=1, free=0`. Guessing twice cost more than instrumenting once.
- 2026-09-18T17:51Z [learning] Refuge, kinship and abandonment all came through twelve centuries clean: every
  abandoned village's people were taken in, none lost on the road, longest walk ten weeks, kin never raided kin.
- 2026-09-18T17:51Z [surprise] Raids are zero across twelve centuries, because the scripted chief only raids under
  real pressure. The whole tribute-and-threat apparatus is barely exercised in ordinary play.
- 2026-09-18T18:10Z [incident] A forty-year run with a real chief went silent at year 38: fourteen failures in a
  row, which read in the journal as a chief with nothing to say. The proxy's logs gave it in one word, `quota` —
  2,001,158 tokens against a daily cap of 2,000,000 (d5f37f6).
- 2026-09-18T18:10Z [decision] The defect was the silence, not the cap. A banner now says the day's thinking is
  spent, that the world keeps running on habit, and when it comes back.
- 2026-09-18T18:10Z [learning] One village with a real chief costs about 52,000 tokens a game-year, so the daily cap
  is about forty village-years, or thirteen at the default three model villages — an afternoon.

## Hardening, and two sessions at once

- 2026-09-18T16:30Z [step] A second session closed the invite brute-force and spend hole, added Dependabot, and
  filled the licence appendix (8e84bc8, 3c5a05e, a8d8c39, issues #29–#31).
- 2026-09-18T18:16Z [step] That session also wired credibility and verdict judgments into the scheduler (216abfa).
- 2026-09-19T01:13Z [idea] Two issues filed by that session and still open: #40, idle adults produce nothing though
  the prompt promises they forage, and `rest` is a no-op; #41, `usesMostAdults` counts rest workers, so a chief
  passes it by resting the village. #40 is the same family as the chief-workforce bug above.
- 2026-09-19T09:11Z [friction] Two sessions sharing one working tree means either can build and deploy the other's
  state. A deploy of mine looked stale to the peer because the hash had changed under us both; verifying by
  *content* rather than by filename settled it. Worth remembering: the strings lived in the worker chunk, not the
  index bundle.
- 2026-09-19T11:17Z [learning] Invite seats are spent per *user*, not per call, and every script run minted a
  throwaway identity: one day's eval work took 29 seats. The harness now caches its user and refreshes the token,
  so three consecutive runs cost one seat (96a4778).
- 2026-09-19T11:17Z [decision] Owner: *"Let's trim seats to about 10. I don't want to spend more than a few dollars
  per player per day for real game play."* The trim belongs to the other session; the seat fix above is what makes
  ten workable.
- 2026-09-19T11:17Z [learning] The daily cap is denominated in tokens, and tokens are not dollars. The same 2M cap
  costs $0.44 on thrifty, $2.03 on standard and $6.76 on lavish — a fifteenfold spread, because the tier chooses the
  model. No token number satisfies "a few dollars a day" across tiers; a dollar-denominated cap would.
- 2026-09-19T11:17Z [learning] Jev is about forty times cheaper per judgment than 3.8 Flash ($0.034 against $1.484
  per thousand), but judgments are the small half of the bill and Jev cannot generate orders or prose. It is a
  quality argument that happens not to cost more, not the lever that brings lavish under budget. Tier choice is
  that lever.

## Process

- 2026-09-12T19:55Z [decision] Owner on writing: reserve "honest" and "honesty" for an actual contrast with
  deliberate deceit — *"Unless you're actively contrasting with intentional deceit please don't say 'honesty' when
  you just mean to add a note or caveat"*. Scrubbed from the notebooks and three published posts.
- 2026-09-18T16:29Z [decision] Anything that matters gets `run-judge.ts` with repeats, not a single pass. `run.ts`
  gained `--repeat` for the same reason.

---

## Current

- 2026-10-16T17:30Z [step] Created this journal, backfilled from git, issues, the four notes files and the session
  transcripts, per the new global policy in `~/.claude/CLAUDE.md`.
- 2026-10-16T17:30Z [learning] The repository has been dormant since 2026-09-19: no commits in four weeks. The
  backfill therefore covers one dense week of building (11–19 September) rather than a long run of work.
- 2026-10-16T17:30Z [idea] Open and unclaimed, in the order I would take them: #40 and #41 (idle adults produce
  nothing while the prompt promises they forage, and a chief can pass `usesMostAdults` by resting the village — the
  same family as the chief-workforce bug); #27 (the judgment adapter, owned by the other session); a
  dollar-denominated spend cap; and the question nobody has an issue for, which is what a player is trying to
  achieve beyond watching trust accumulate.

- 2026-10-17T04:41Z [incident] Timestamp correction for the backfilled entries above (everything before the
  `## Current` section): they carry local Pacific times with a `Z` suffix, so each is seven hours earlier than
  the UTC it claims. `d184c31` is stamped 2026-09-17T14:35Z but committed at 21:35Z; `e70e71a` is stamped
  2026-09-18T16:29Z but committed at 23:29Z. The ordering is right and the commit hashes are authoritative; only
  the clock labels are off. Not edited, per append-only.
- 2026-10-17T04:41Z [friction] This file was written twice within the hour. A second session checked for a journal, found none,
  wrote a 55-line backfill, and had it replaced by this longer and better one moments later. No loss worth
  recovering — this version covers more — but the file sat untracked in a shared working tree the whole time,
  which is the most clobberable state there is. Committing it now so it stops being a race.
- 2026-10-17T04:41Z [learning] The central finding of the Jev work is not in the entries above and belongs on the record:
  **asked the narrow question on its own, every model answers credulity correctly** — 2.5 Flash-Lite scored 36/36
  over three passes. The credulity defect was the combined prompt, not the judgement. Most of the available gain
  is decomposition, which is free and works whoever answers; Jev's own edge is verdicts (97% against 79–84%),
  speed and price.
- 2026-10-17T04:41Z [learning] Putting that decomposition back into the game: with the judge asked first and the chief handed
  the answer, 2.5 Flash went from obeying "plant nothing this spring" nine times in ten to zero in ten, and still
  acted on the true nudge both times. It makes chiefs discriminating, not suspicious — a blanket distrust would
  have scored the same on the lie and lost the rumour cases. 3.5 Flash-Lite 5/10 → 2/10, which the variance work
  at 2026-09-18T16:43Z suggests is noise; 9/10 → 0/10 is not.
- 2026-10-17T04:41Z [decision] Credulity became `credulityThreshold(chiefTraits)` — 0.6 for a skeptic, 0.2 for the devout,
  0.4 in the middle. It is a character trait now rather than a side effect of which model the billing tier bought.
  This is the part of the Jev work expected to outlast the vendor choice.
- 2026-10-17T04:41Z [milestone] `b817f19` also added `POST /v1/systemone` to the proxy with the key in Secret Manager as
  `typesafe-api-key`, on the same rules as the OpenRouter key. `JevJudge` takes a transport — `ProxySystemOne`
  in the browser, `SdkSystemOne` in evals and server code — so the SDK import sits in a file the web barrel does
  not re-export. Bundle verified free of key, SDK and `api.typesafe.ai`.
- 2026-10-17T04:41Z [decision] When a judge answers, the model is told what was decided and writes only the terms and the
  journal. Asking twice invites the prose and the decision to disagree.
- 2026-10-17T04:41Z [incident] I built and deployed to production carrying eight commits from the other session without reading
  them, and only noticed when the bundle size jumped. They were on `main` and the merged state checked out
  (205 tests green), but the log should have been read before the deploy, not after.
- 2026-10-17T04:41Z [idea] Owner's design thread, not yet an issue: idle villagers should either fall back to a default action
  or rest, with a share of the village at leisure improving morale on a saturating curve. Proposed asymmetry —
  unassigned means drifting (poor food, no morale), `rest` means granted leisure (no food, morale) — so leisure
  is something a chief spends hands on rather than gets for free. Scale the weariness penalty by `(1 − hardship)`
  so prosperity raises expectations. Grounding finding: `v.happiness` is read by nothing in the sim except the
  coup check, so it is close to decorative; the strongest candidate consequence is **trust**, which is the game's
  actual scoreboard. Blocked on #40 and #41.
- 2026-10-17T04:41Z [idea] A blog post on the TypeSafe exploration is outlined (sixteen sections, two charts, ~2,500–3,500
  words) but not drafted. Its spine is the finding above: most of the win was the question, not the model. The
  outline deliberately leads with what was got wrong — the undersampled #28 claim and the superseded credulity
  numbers — rather than appendixing it.

- 2026-10-17T05:05Z [incident] My backfill timestamps were wrong: I used `git log --date=format:` under `TZ=UTC`,
  which formats in each *commit's own* timezone, so every stamp from the 2026-10-16T17:30Z backfill entry and
  above is local Pacific wearing a Z. The true UTC times are seven hours later (ce2eed4 is 2026-09-12T06:43Z, not
  2026-09-11T23:43Z). `--date=format-local:` is the flag that actually converts. Found by the other session, not
  by me. The entries stay as written, per append-only; read them as Pacific.
- 2026-10-17T05:05Z [learning] A token-denominated quota cannot express the owner's goal. The same 2M/day cap
  costs $0.44, $2.03 and $6.76 per player-day on thrifty, standard and lavish — a fifteenfold spread, because the
  tier picks the model. Seat trimming bounds how many people can play, not what each costs: ten seats on lavish is
  about $68 a day. Counting `costUsd` in `quota.ts` is the instrument that would do it.
- 2026-10-17T05:05Z [learning] Nobody had costed the spirit's own calls. The sun spirit sends a whole-world digest
  of roughly 20k tokens to the capable model, about $0.058 a question and $0.17 a game-year at three questions —
  comparable to all three chiefs put together at standard. Dreams are about $0.013 a turn on the same class.
- 2026-10-17T05:05Z [decision] Per the other session, the seat trim and the budget sizing are still unlanded: it
  declined to act on my relay of the owner's instruction, on the grounds that a peer relay is not the owner's
  approval for something it had put to him directly. That is the right call and the record should show no outcome.

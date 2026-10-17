# Wind Spirit

## Journal

This project keeps an append-only journal at `JOURNAL.md` in the repo root. Record everything of significance as
the work happens, in the same commit as the change: steps, decisions (with who decided and why — quote the owner
when the owner decided), friction, lessons, surprises, incidents and ideas for future work.

- Every entry starts with a UTC timestamp and a tag: `- 2026-10-16T17:52Z [decision] …`
- Tags: `[step]`, `[decision]`, `[friction]`, `[learning]`, `[surprise]`, `[incident]`, `[idea]`, `[milestone]`.
- One line to a short paragraph. Not every turn, but everything significant, including failures and dead ends.
  Link commits, PRs, issues, run directories and docs.
- **Append-only.** Never edit or delete a past entry. To correct one, append a new entry naming the earlier
  entry's timestamp.
- Brief every subagent or session you start on this rule.

A copy is archived to the private `andy-private-docs` repo under `journals/` by a scheduled sync, which finds this
file automatically.

## Working rules carried from the build

- **Tune balance only through the harness** (`pnpm harness -- assert --seeds N`), never by hand-editing outcomes.
  `pnpm harness -- playtest --seeds 4 --years 300` is the long unattended watch for mechanics that stall.
- **A median over three seeds is a coin toss near a bar.** CI runs three; check anything touching geography or
  the economy on the CI sample as well as on six or twelve.
- **Count the observations behind a claim before writing it down.** Sampled models vary enough that a single run
  of 45 observations has swung between 82% and 100%. Use `run-judge.ts --repeat` or `run.ts --repeat`.
- **Check a golden eval answer against the simulation, not against intuition.** The sim's own combat and economy
  models will tell you what a case means; they have disagreed with the case author before.
- **Never put a model id in client code**, and never a key anywhere but Secret Manager.
- Several Claude sessions work in this repo at once and share one checkout. Verify a deploy by its *content*, not
  by its filename, and stage files individually.

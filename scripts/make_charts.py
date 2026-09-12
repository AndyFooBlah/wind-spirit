#!/usr/bin/env python3
"""Generate the blog charts for the balance-harness write-up as SVGs in blog/charts/.

Every chart is produced from harness output. Runs and traces are cached under out/
(harness runs → out/<name>/rows.csv, debug traces → out/traces/<name>.txt) and are
re-run only when the cache is missing, so `rm -rf out` regenerates everything from
the sim at the current commit.

Run from the repo root (needs pnpm install first):

    uv run --with matplotlib --with numpy python scripts/make_charts.py [--png DIR]

--png DIR additionally rasterises each chart into DIR for quick eyeballing.

Charts (light surface, the same palette as andrewbrook.dev's other charts):
  ladder-forager.svg        forager villages starting at 20 vs 50, 100 years
  farmer-150y.svg           farmer policy: population and food by source, 150 years
  sensible-300y.svg         sensible policy: total population and villages alive
  sensible-deaths.svg       sensible policy: deaths by cause per year
  collapse-hard-winter.svg  legacy rules: a hard winter wipes out a village with no stores
  collapse-hunger-block.svg legacy farmer that skips planting when hungry
  collapse-no-plot-cap.svg  legacy farmer with no plot cap: fertility collapse
  collapse-demographic.svg  legacy births + short working life: demographic spiral
  tuning-stages.svg         forager@20 survival at 100 years across the tuning stages
"""

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import textwrap
from collections import defaultdict
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
CHARTS = ROOT / "blog" / "charts"

# Palette: validated categorical order (blue, orange, aqua, yellow, magenta, green, violet, red)
# on the light surface; ink and grid match the site's existing charts.
BLUE, ORANGE, AQUA, YELLOW, MAGENTA, GREEN, VIOLET, RED = (
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948",
)
INK, INK2, INK3, GRID, SURFACE = "#0b0b0b", "#52514e", "#8a8985", "#e8e7e3", "#fcfcfb"
FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

plt.rcParams.update({
    "svg.fonttype": "none",
    "font.family": "sans-serif",
    "font.sans-serif": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
    "font.size": 10,
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "axes.edgecolor": GRID,
    "axes.labelcolor": INK2,
    "axes.titlecolor": INK,
    "axes.grid": True,
    "axes.grid.axis": "y",
    "grid.color": GRID,
    "grid.linewidth": 1,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.axisbelow": True,
    "xtick.color": INK2,
    "ytick.color": INK2,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "axes.labelsize": 9.5,
    "legend.frameon": False,
    "legend.fontsize": 9,
    "lines.linewidth": 2,
})

PNG_DIR: Path | None = None


# ----------------------------------------------------------------------------- data

def harness_run(name: str, args: list[str], env: dict[str, str] | None = None) -> list[dict]:
    """Run `pnpm harness -- run ...` once, cache rows.csv under out/<name>/, return the rows."""
    path = OUT / name / "rows.csv"
    if not path.exists():
        print("running harness:", name, " ".join(args), env or "")
        subprocess.run(["pnpm", "harness", "--", "run", *args, "--out", f"out/{name}"],
                       cwd=ROOT, env={**os.environ, **(env or {})}, check=True, stdout=subprocess.DEVNULL)
    with open(path) as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        for k, v in r.items():
            if k not in ("seed", "name"):
                r[k] = int(v)
    return rows


def trace(name: str, seed: str, policy: str, pop: int, years: int, village: int,
          env: dict[str, str] | None = None, every: int = 1) -> tuple[list[dict], int | None]:
    """Run the weekly debug tracer once and parse it. Returns (rows, death_tick)."""
    path = OUT / "traces" / f"{name}.txt"
    if not path.exists():
        print("running trace:", name)
        path.parent.mkdir(parents=True, exist_ok=True)
        res = subprocess.run(["npx", "tsx", "src/debug.ts", seed, policy, str(pop), str(years), str(village)],
                             cwd=ROOT / "packages" / "harness", capture_output=True, text=True, check=True,
                             env={**os.environ, **(env or {}), "WS_DEBUG_EVERY": str(every)})
        path.write_text(res.stdout)
    rows, died = [], None
    for line in path.read_text().splitlines():
        if line.startswith("village died"):
            died = rows[-1]["tick"] if rows else None
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 8 or not parts[0][:1].isdigit():
            continue
        tick, yr, season = (int(x) for x in parts[0].split())
        pop_, ch, ad, el = (int(x) for x in parts[1].split())
        prod, need, stores = (int(x) for x in parts[3].split())
        hunger, calm = (int(x) for x in parts[4].split())
        f = parts[6].split()
        planted, fields = (int(x) for x in f[0].split("/"))
        rows.append(dict(tick=tick, year=yr, season=season, pop=pop_, children=ch, adults=ad, elders=el,
                         prod=prod, need=need, stores=stores, hunger=hunger / 1000, calm=calm,
                         planted=planted, fields=fields, fertility=int(f[1][1:]) / 1000,
                         grain=int(f[2][5:]), deaths=int(parts[7]) if parts[7] else 0))
    return rows, died


def by_village(rows: list[dict], key: str, years: int, first_four: bool = True) -> np.ndarray:
    """(villages × years) matrix of one column; dead villages read 0 (rows are emitted for them)."""
    series: dict[tuple[str, int], np.ndarray] = {}
    for r in rows:
        if first_four and r["village"] >= 4:
            continue
        k = (r["seed"], r["village"])
        if k not in series:
            series[k] = np.zeros(years)
        if r["year"] < years:
            series[k][r["year"]] = r[key]
    return np.array(list(series.values()))


def by_seed_sum(rows: list[dict], key: str, years: int, alive_only: bool = False) -> np.ndarray:
    """(seeds × years) matrix summing one column over all villages of a seed."""
    acc: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(years))
    for r in rows:
        if r["year"] < years and (not alive_only or r["alive"]):
            acc[r["seed"]][r["year"]] += r[key]
    return np.array(list(acc.values()))


def pick(rows: list[dict], seed: str, village: int, key: str, years: int) -> np.ndarray:
    out = np.zeros(years)
    for r in rows:
        if r["seed"] == seed and r["village"] == village and r["year"] < years:
            out[r["year"]] = r[key]
    return out


# ----------------------------------------------------------------------------- drawing helpers

def figure(title: str, subtitle: str, rows: int = 1, height: float = 4.2, cols: int = 1, **kw):
    lines = textwrap.wrap(subtitle, 128)
    height += 0.17 * (len(lines) - 1)
    fig, axes = plt.subplots(rows, cols, figsize=(8.6, height), dpi=100, **kw)
    fig.text(0.035, 1 - 0.28 / height, title, fontsize=13, weight="bold", color=INK, ha="left", va="top")
    for i, line in enumerate(lines):
        fig.text(0.035, 1 - (0.52 + 0.17 * i) / height, line, fontsize=9.5, color=INK2, ha="left", va="top")
    fig._top_pad = 0.74 + 0.17 * (len(lines) - 1)  # inches reserved above the axes
    return fig, axes


def finish(fig, name: str, bottom: float = 0.55, hspace: float = 0.45):
    h = fig.get_figheight()
    fig.subplots_adjust(left=0.085, right=0.975, top=1 - fig._top_pad / h, bottom=bottom / h, hspace=hspace, wspace=0.18)
    CHARTS.mkdir(parents=True, exist_ok=True)
    path = CHARTS / name
    fig.savefig(path, format="svg", facecolor=SURFACE)
    svg = path.read_text()
    # matplotlib names a concrete font; let the browser pick the system UI font instead.
    for fam in plt.rcParams["font.sans-serif"]:
        svg = svg.replace(f"font-family: '{fam}'", f"font-family: {FONT}").replace(f'font-family:{fam}', f"font-family: {FONT}")
    path.write_text(svg)
    if PNG_DIR:
        fig.savefig(PNG_DIR / name.replace(".svg", ".png"), format="png", facecolor=SURFACE)
    plt.close(fig)
    print("wrote", path.relative_to(ROOT))


def band(ax, x, m: np.ndarray, color: str, label: str, lo: float = 10, hi: float = 90, ls: str = "-"):
    """Median line with a 10–90 percentile band across the first axis of m."""
    med = np.median(m, axis=0)
    ax.fill_between(x, np.percentile(m, lo, axis=0), np.percentile(m, hi, axis=0), color=color, alpha=0.14, lw=0)
    ax.plot(x, med, color=color, label=label, ls=ls)
    return med


def tidy(ax, xlabel: str | None = None, ylabel: str | None = None, zero: bool = True):
    if xlabel:
        ax.set_xlabel(xlabel)
    if ylabel:
        ax.set_ylabel(ylabel)
    if zero:
        ax.set_ylim(bottom=0)
    ax.yaxis.set_major_locator(MaxNLocator(5))
    ax.margins(x=0.01)


def mark_deaths(ax, rows: list[dict], y_at: float, color: str = RED):
    xs = [r["tick"] / 52 for r in rows for _ in range(r["deaths"])]
    if xs:
        ax.plot(xs, [y_at] * len(xs), "|", color=color, ms=9, mew=1.4, ls="none", label="a death")


def shade_winters(ax, years: float, start: float = 0):
    for y in range(int(start), int(np.ceil(years))):
        ax.axvspan(y + 39 / 52, y + 1, color=INK, alpha=0.045, lw=0)


# ----------------------------------------------------------------------------- charts

def chart_ladder():
    f20 = harness_run("f20", ["--seeds", "10", "--years", "100", "--policy", "forager", "--pop", "20", "--prefix", "f20"])
    f50 = harness_run("f50", ["--seeds", "10", "--years", "100", "--policy", "forager", "--pop", "50", "--prefix", "f50"])
    x = np.arange(100)
    fig, ax = figure("Wild food alone: a village of 20 grows, a village of 50 shrinks",
                     "Forager policy, 40 villages (10 seeds × 4) each; median village population with the 10–90% band. Dead villages count as 0.")
    m20 = band(ax, x, by_village(f20, "pop", 100), BLUE, "start at 20")
    m50 = band(ax, x, by_village(f50, "pop", 100), ORANGE, "start at 50")
    ax.text(99.5, m20[-1] + 1.5, f"{m20[-1]:.0f}", color=INK, fontsize=9, ha="right", va="bottom", weight="bold")
    ax.text(99.5, m50[-1] - 1.5, f"{m50[-1]:.0f}", color=INK, fontsize=9, ha="right", va="top", weight="bold")
    ax.axhline(50, color=INK3, lw=1, ls=(0, (3, 3)))
    ax.text(50, 51, "the concept's wild-food ceiling: about 50", color=INK3, fontsize=8.5, va="bottom", ha="center")
    tidy(ax, "year", "people per village")
    ax.legend(loc="lower right")
    finish(fig, "ladder-forager.svg")


def chart_farmer():
    fa = harness_run("farmer", ["--seeds", "10", "--years", "150", "--policy", "farmer", "--pop", "20", "--prefix", "farm"])
    x = np.arange(150)
    fig, (a1, a2) = figure("Farming lifts a village past 50, then it plateaus",
                           "Farmer policy (farm and build, never expand), 40 villages over 150 years. Top: median village with the 10–90% band. Bottom: median food produced per village by source.",
                           rows=2, height=6.4, sharex=True)
    m = band(a1, x, by_village(fa, "pop", 150), BLUE, "population")
    a1.axhline(50, color=INK3, lw=1, ls=(0, (3, 3)))
    a1.text(0.5, 51.5, "50", color=INK3, fontsize=8.5, va="bottom")
    a1.text(149.5, m[-1] + 3, f"{m[-1]:.0f}", color=INK, fontsize=9, ha="right", va="bottom", weight="bold")
    tidy(a1, ylabel="people per village")
    srcs = [("forage", "forage", AQUA), ("hunt", "hunt", ORANGE), ("fish", "fish", BLUE), ("farm", "farm", YELLOW)]
    ys = [np.median(by_village(fa, k, 150), axis=0) / 1000 for k, _, _ in srcs]
    a2.stackplot(x, *ys, labels=[l for _, l, _ in srcs], colors=[c for _, _, c in srcs], alpha=0.9, lw=0)
    tidy(a2, "year", "person-weeks of food per year")
    a2.legend(loc="upper left", ncol=4)
    finish(fig, "farmer-150y.svg", hspace=0.18)


def chart_sensible():
    se = harness_run("sensible", ["--seeds", "10", "--years", "300", "--policy", "sensible", "--pop", "20", "--prefix", "sens"])
    x = np.arange(300)
    fig, (a1, a2) = figure("Sensible chiefs fill a 64 × 64 world in about 300 years",
                           "Sensible policy (farm, explore, colonize), 10 seeds. Median across seeds with the 10–90% band.",
                           rows=2, height=6.4, sharex=True)
    pop = by_seed_sum(se, "pop", 300)
    m = band(a1, x, pop, BLUE, "people in the world")
    a1.text(297, m[-1] * 0.9, f"{m[-1]:,.0f}", color=INK, fontsize=9, ha="right", va="top", weight="bold")
    tidy(a1, ylabel="people in the world")
    alive = by_seed_sum(se, "alive", 300)
    m = band(a2, x, alive, ORANGE, "villages alive")
    a2.text(297, m[-1] * 0.9, f"{m[-1]:.0f}", color=INK, fontsize=9, ha="right", va="top", weight="bold")
    tidy(a2, "year", "villages alive")
    finish(fig, "sensible-300y.svg", hspace=0.18)

    fig, ax = figure("Deaths by cause under sensible chiefs",
                     "Median across 10 seeds of world-wide deaths per year. Hunger stays about two fifths of all deaths even when villages can expand.")
    causes = [("deathsAge", "age", BLUE), ("deathsHunger", "hunger", ORANGE), ("deathsTravel", "travel", AQUA)]
    ys = [np.median(by_seed_sum(se, k, 300), axis=0) for k, _, _ in causes]
    ax.stackplot(x, *ys, labels=[l for _, l, _ in causes], colors=[c for _, _, c in causes], alpha=0.9, lw=0)
    tot = np.array([by_seed_sum(se, k, 300).sum() for k, _, _ in causes])
    share = 100 * tot[1] / tot.sum()
    ax.text(0.02, 0.95, f"hunger: {share:.0f}% of all deaths over 300 years", transform=ax.transAxes, fontsize=9.5, color=INK, va="top")
    tidy(ax, "year", "deaths per year")
    ax.legend(loc="center left")
    finish(fig, "sensible-deaths.svg")


def chart_hard_winter():
    env = {"WS_PARAMS": json.dumps({"legacy": {"hardWinter": "all", "starvation": "selective"}})}
    seed, village, years = "f20-7", 2, 20
    legacy, died = trace("c1-legacy-f20-7-v2", seed, "legacy-forager-nogranary", 20, years, village, env=env)
    current, _ = trace("c1-current-f20-7-v2", seed, "forager", 20, years, village)
    t = np.array([r["tick"] for r in legacy]) / 52
    tc = np.array([r["tick"] for r in current]) / 52
    end = (died / 52 if died else years) + 0.3
    fig, (a1, a2, a3, a4) = figure("Collapse 1: a hard winter with no stores",
                                   f"Seed {seed}, one village, weekly, winters shaded. Legacy rules: no granary, a hard winter halves every food source, and the hungry starve one at a time. The same village under the current rules for comparison.",
                                   rows=4, height=9.8, sharex=True)
    for ax in (a1, a2, a3, a4):
        shade_winters(ax, end)
        if died:
            ax.axvline(died / 52, color=INK3, lw=1, ls=(0, (3, 3)))
    a1.plot(tc, [r["pop"] for r in current], color=BLUE, label="current rules")
    a1.plot(t, [r["pop"] for r in legacy], color=ORANGE, label="legacy rules")
    a1.legend(loc="lower left", ncol=2)
    a1.set_ylim(0, 30)
    tidy(a1, ylabel="people")
    if died:
        a1.text(died / 52 - 0.15, 27, "village dies", color=INK2, fontsize=8.5, ha="right", va="top")
    a2.plot(t, [r["need"] for r in legacy], color=INK2, lw=1.4, label="mouths to feed")
    a2.plot(t, [r["prod"] for r in legacy], color=ORANGE, label="food produced per week (legacy)")
    a2.fill_between(t, [r["prod"] for r in legacy], [r["need"] for r in legacy],
                    where=[r["prod"] < r["need"] for r in legacy], color=ORANGE, alpha=0.18, lw=0, label="shortfall")
    a2.legend(loc="upper right", ncol=3)
    a2.set_ylim(0, 48)
    tidy(a2, ylabel="person-weeks per week")
    a3.plot(t, [r["stores"] for r in legacy], color=AQUA, label="stores (legacy)")
    a3.plot(tc, [r["stores"] for r in current], color=BLUE, lw=1.2, label="stores (current rules)")
    a3.legend(loc="upper left", ncol=2)
    tidy(a3, ylabel="person-weeks in store")
    a4.plot(t, [r["hunger"] for r in legacy], color=RED, lw=1.6, label="hunger: weeks of food owed per person (legacy)")
    mark_deaths(a4, legacy, y_at=8.6)
    a4.set_ylim(0, 9.5)
    a4.legend(loc="center left", ncol=2)
    tidy(a4, "year", "weeks owed")
    a4.set_xlim(0, end)
    finish(fig, "collapse-hard-winter.svg", hspace=0.16)


def chart_hunger_block():
    leg = harness_run("c2-legacy", ["--seeds", "10", "--years", "150", "--policy", "legacy-farmer-hungerblock", "--pop", "20", "--prefix", "farm"])
    fa = harness_run("farmer", ["--seeds", "10", "--years", "150", "--policy", "farmer", "--pop", "20", "--prefix", "farm"])
    seed, village, years = "farm-3", 0, 70
    x = np.arange(years)
    fig, (a1, a2) = figure("Collapse 2: a chief that will not plant while hungry",
                           f"Seed {seed}, one village, yearly. The legacy farmer skips spring planting whenever anyone is hungry; the current farmer plants regardless.",
                           rows=2, height=6.4, sharex=True)
    a1.plot(x, pick(fa, seed, village, "pop", years), color=BLUE, label="current farmer")
    a1.plot(x, pick(leg, seed, village, "pop", years), color=ORANGE, label="legacy: hunger blocks planting")
    a1.legend(loc="upper left")
    tidy(a1, ylabel="people")
    hf = pick(fa, seed, village, "farm", years) / 1000
    hl = pick(leg, seed, village, "farm", years) / 1000
    a2.bar(x - 0.2, hf, width=0.4, color=BLUE, label="current farmer", lw=0)
    a2.bar(x + 0.2, hl, width=0.4, color=ORANGE, label="legacy", lw=0)
    alive_l = pick(leg, seed, village, "alive", years)
    zero = [i for i in range(5, years) if hl[i] == 0 and alive_l[i]]
    if zero:
        a2.annotate("hungry in spring, so nothing planted:\nno harvest, and the village is gone by winter", (zero[0] + 0.2, 40),
                    xytext=(zero[0] - 1.5, 1820), color=INK, fontsize=9, ha="right", va="center",
                    arrowprops=dict(arrowstyle="-", color=INK2, lw=1))
    a2.set_ylim(0, 2050)
    a1.annotate("stores empty at the end of winter", (49.6, 40), xytext=(20, 8), color=INK, fontsize=9,
                arrowprops=dict(arrowstyle="-", color=INK2, lw=1))
    a2.legend(loc="upper left")
    tidy(a2, "year", "harvest (person-weeks)")
    # keep the overall survival numbers handy for the caption
    n_dead = sum(1 for r in leg if r["year"] == 149 and r["village"] < 4 and not r["alive"])
    n_dead_f = sum(1 for r in fa if r["year"] == 149 and r["village"] < 4 and not r["alive"])
    print(f"  hunger-block: {n_dead}/40 villages dead at 150y vs {n_dead_f}/40 under the current farmer")
    finish(fig, "collapse-hunger-block.svg", hspace=0.18)


def chart_no_plot_cap():
    seed, village, years = "farm-0", 0, 40
    nocap, _ = trace("c3-nocap-farm-0-v0", seed, "legacy-farmer-nocap", 20, years, village, every=13)
    cur, _ = trace("c3-farmer-farm-0-v0", seed, "farmer", 20, years, village, every=13)
    leg = harness_run("c3-legacy", ["--seeds", "10", "--years", "150", "--policy", "legacy-farmer-nocap", "--pop", "20", "--prefix", "farm"])
    fa = harness_run("farmer", ["--seeds", "10", "--years", "150", "--policy", "farmer", "--pop", "20", "--prefix", "farm"])

    def yearly_fert(rows):  # last sampled week of each year (after harvest and autumn)
        f = {}
        for r in rows:
            f[r["year"]] = r["fertility"]
        return np.array([f.get(y, np.nan) for y in range(years)])

    x = np.arange(years)
    fig, (a1, a2) = figure("Collapse 3: plant every plot every year and the soil is gone in twenty",
                           f"Seed {seed}, one village. Mean fertility of cleared plots (top) and the yearly harvest (bottom), with and without the plot cap that gives a one-in-two rotation.",
                           rows=2, height=6.4, sharex=True)
    a1.plot(x, yearly_fert(cur), color=BLUE, label="current farmer (plot cap: plant half)")
    a1.plot(x, yearly_fert(nocap), color=ORANGE, label="legacy: no plot cap")
    a1.set_ylim(0, 1.05)
    a1.legend(loc="lower left")
    tidy(a1, ylabel="mean field fertility (0–1)")
    a2.bar(x - 0.2, pick(fa, seed, village, "farm", years) / 1000, width=0.4, color=BLUE, lw=0, label="current farmer")
    a2.bar(x + 0.2, pick(leg, seed, village, "farm", years) / 1000, width=0.4, color=ORANGE, lw=0, label="legacy: no plot cap")
    tidy(a2, "year", "harvest (person-weeks)")
    finish(fig, "collapse-no-plot-cap.svg", hspace=0.18)


def chart_demographic():
    env = {"WS_PARAMS": json.dumps({"ageAdultYears": 15, "ageElderYears": 55, "legacy": {"births": "calmgate"}})}
    leg = harness_run("c4-legacy", ["--seeds", "10", "--years", "100", "--policy", "forager", "--pop", "20", "--prefix", "f20"], env=env)
    f20 = harness_run("f20", ["--seeds", "10", "--years", "100", "--policy", "forager", "--pop", "20", "--prefix", "f20"])
    seed, village, years = "f20-4", 2, 100
    x = np.arange(years)
    fig, (a1, a2) = figure("Collapse 4: the demographic spiral",
                           f"Seed {seed}, one village, yearly, by life stage. Left: births stop on any hunger and adults work 15–55. Right: births scale with a hardship average and adults work 14–60.",
                           rows=1, cols=2, height=4.6)
    stages = [("children", "children", YELLOW), ("adults", "adults", BLUE), ("elders", "elders", VIOLET)]
    top = max(pick(rows, seed, village, "pop", years).max() for rows in (leg, f20)) * 1.08
    for ax, rows, title in ((a1, leg, "legacy rules: village dwindles and dies"), (a2, f20, "current rules: same village")):
        ys = [pick(rows, seed, village, k, years) for k, _, _ in stages]
        ax.stackplot(x, *ys, labels=[l for _, l, _ in stages], colors=[c for _, _, c in stages], alpha=0.9, lw=0)
        ax.text(0.02, 0.97, title, transform=ax.transAxes, fontsize=10, color=INK, va="top", weight="bold")
        ax.set_ylim(0, top)
        tidy(ax, "year", "people" if ax is a1 else None)
    a1.legend(loc="center right")
    finish(fig, "collapse-demographic.svg")


def chart_stages():
    A = {"ageAdultYears": 15, "ageElderYears": 55}
    L = lambda s, b, h: {"starvation": s, "births": b, "hardWinter": h}  # noqa: E731
    base = ["--seeds", "10", "--years", "100", "--pop", "20", "--prefix", "f20", "--policy"]
    stages = [
        ("every legacy rule", "stage0", "legacy-forager-nogranary", {**A, "legacy": L("selective", "calmgate", "all")}),
        ("+ granary\n(storage)", "stage1", "forager", {**A, "legacy": L("selective", "calmgate", "all")}),
        ("+ starvation as\nrationing", "stage2", "forager", {**A, "legacy": L("rationing", "calmgate", "all")}),
        ("+ births scale\nwith hardship", "stage3", "forager", {**A, "legacy": L("rationing", "hardship", "all")}),
        ("+ adults\nwork 14–60", "stage4", "forager", {"legacy": L("rationing", "hardship", "all")}),
        ("+ hard winter\nspares hunting\nand fishing", "stage5", "forager", None),
    ]
    rates = []
    for label, name, policy, params in stages:
        env = {"WS_PARAMS": json.dumps(params)} if params else None
        rows = harness_run(name, [*base, policy], env=env)
        alive = [r["alive"] for r in rows if r["year"] == 99 and r["village"] < 4]
        rates.append(100 * sum(alive) / len(alive))
    fig, ax = figure("Forager survival at 100 years, one fix at a time",
                     "Villages of 20 under the forager policy, 40 villages per stage (10 seeds × 4). Each bar adds one change to the one before it, in the order the lessons were learned.")
    x = np.arange(len(stages))
    colors = [INK3] + [BLUE] * (len(stages) - 2) + [AQUA]
    ax.bar(x, rates, color=colors, width=0.62, lw=0)
    for i, r in enumerate(rates):
        ax.text(i, r + 1.5, f"{r:.0f}%", ha="center", va="bottom", fontsize=10, color=INK, weight="bold")
    ax.set_xticks(x, [s[0] for s in stages], fontsize=8.8)
    ax.set_ylim(0, 108)
    ax.set_yticks([0, 25, 50, 75, 100], ["0%", "25%", "50%", "75%", "100%"])
    ax.axhline(90, color=INK3, lw=1, ls=(0, (3, 3)))
    ax.text(-0.3, 91.5, "target: 90% of villages", color=INK3, fontsize=8.5, ha="left", va="bottom")
    ax.set_ylabel("villages alive at year 100")
    ax.margins(x=0.03)
    finish(fig, "tuning-stages.svg", bottom=0.8)
    print("  stage survival:", [f"{r:.1f}" for r in rates])


def main() -> None:
    global PNG_DIR
    if "--png" in sys.argv:
        PNG_DIR = Path(sys.argv[sys.argv.index("--png") + 1]).resolve()
        PNG_DIR.mkdir(parents=True, exist_ok=True)
    chart_ladder()
    chart_farmer()
    chart_sensible()
    chart_hard_winter()
    chart_hunger_block()
    chart_no_plot_cap()
    chart_demographic()
    chart_stages()


if __name__ == "__main__":
    main()

"""Charts for the model-cost study. Reads docs/evals/results/*.json and writes blog/charts/eval-*.svg.
Run from the repo root: uv run --with matplotlib --with numpy python scripts/make_eval_charts.py
"""
import json, glob, os, math
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'blog', 'charts'); os.makedirs(OUT, exist_ok=True)
CATS = ['routine', 'crisis', 'visitor', 'expansion', 'spirit', 'dream']
LABEL = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash (Vertex)', 'gemini-3.1-pro-preview': 'Gemini 3.1 Pro (Vertex)', 'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite', 'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
  'gemini-2.5-flash': 'Gemini 2.5 Flash', 'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite', 'openai/gpt-oss-120b-maas': 'gpt-oss-120b (Vertex)', 'google/gemma-4-26b-a4b-it-maas': 'Gemma 4 26B (Vertex)',
  'deepseek-ai/deepseek-v3.2-maas': 'DeepSeek V3.2 (Vertex)', 'qwen/qwen3-235b-a22b-instruct-2507-maas': 'Qwen3 235B (Vertex)',
  'anthropic/claude-haiku-4.5': 'Claude Haiku 4.5', 'anthropic/claude-sonnet-5': 'Claude Sonnet 5', 'openai/gpt-5-mini': 'GPT-5 mini', 'openai/gpt-5-nano': 'GPT-5 nano', 'openai/gpt-5.4-nano': 'GPT-5.4 nano',
  'openai/gpt-5.6-luna': 'GPT-5.6 Luna', 'meta-llama/llama-4-maverick': 'Llama 4 Maverick', 'moonshotai/kimi-k2.5': 'Kimi K2.5', 'moonshotai/kimi-k3': 'Kimi K3', 'z-ai/glm-5.3-flash': 'GLM 5.3 Flash',
  'z-ai/glm-4.7': 'GLM 4.7', 'minimax/minimax-m2.7': 'MiniMax M2.7', 'deepseek/deepseek-v3.2': 'DeepSeek V3.2 (OR)', 'deepseek/deepseek-v4.1-flash': 'DeepSeek V4.1 Flash', 'deepseek/deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek/deepseek-v4-pro': 'DeepSeek V4 Pro', 'mistralai/mistral-medium-3.1': 'Mistral Medium 3.1', 'xiaomi/mimo-v2.5': 'MiMo v2.5', 'qwen/qwen3.8-flash': 'Qwen 3.8 Flash', 'nvidia/nemotron-3-ultra-550b-a55b': 'Nemotron 3 Ultra',
  'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super', 'google/gemini-3.8-flash': 'Gemini 3.8 Flash (OR)', 'google/gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite (OR)', 'google/gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite (OR)',
}
FAMILY = lambda m: 'Gemini' if 'gemini' in m else 'Claude' if 'anthropic' in m else 'OpenAI' if 'openai' in m else 'open weights'
COL = {'Gemini': '#2f6f7a', 'Claude': '#c9a227', 'OpenAI': '#4c9a2a', 'open weights': '#8c5f2a'}

runs = []
for f in sorted(glob.glob(os.path.join(ROOT, 'docs', 'evals', 'results', '*.json'))):
    d = json.load(open(f)); rs = d['results']; ok = [r for r in rs if not r.get('error')]
    if not rs: continue
    mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
    runs.append(dict(model=d['model'], label=LABEL.get(d['model'], d['model']), score=mean([r['score'] for r in rs]), cost=mean([r['cost'] for r in ok]) if ok else 0,
                     ms=mean([r['ms'] for r in ok]) if ok else 0, errors=len(rs) - len(ok), judge=mean([r['judge'] for r in rs if r.get('judge') is not None]),
                     cats={c: mean([r['score'] for r in rs if r['category'] == c]) for c in CATS}, fam=FAMILY(d['model'])))
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False, 'figure.facecolor': 'white', 'axes.facecolor': 'white'})

# 1. score vs cost, log x
fig, ax = plt.subplots(figsize=(9, 6))
for r in runs:
    if r['cost'] <= 0 or r['errors'] > 10: continue
    ax.scatter(r['cost'] * 1000, r['score'], s=70, color=COL[r['fam']], alpha=0.85, edgecolor='white', linewidth=0.8, zorder=3)
    ax.annotate(r['label'], (r['cost'] * 1000, r['score']), xytext=(5, 4), textcoords='offset points', fontsize=7.5)
ax.set_xscale('log'); ax.set_xlabel('cost per decision, tenths of a cent (log scale)'); ax.set_ylabel('rule score, mean over 96 cases'); ax.set_ylim(0.88, 1.0)
ax.axhline(0.974, color='#999', linestyle=':', linewidth=1); ax.text(0.4, 0.9755, 'Gemini 3.8 Flash baseline', fontsize=8, color='#666')
for k, c in COL.items(): ax.scatter([], [], color=c, label=k)
ax.legend(loc='lower left', frameon=False); ax.set_title('Chief decisions: quality against cost, models with fewer than 10 failed cases'); ax.grid(axis='y', color='#eee')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'eval-score-vs-cost.svg')); fig.savefig('/tmp/eval-score-vs-cost.png', dpi=110); plt.close(fig)

# 2. category profile for a chosen set
pick = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'openai/gpt-5.6-luna', 'z-ai/glm-5.3-flash', 'mistralai/mistral-medium-3.1', 'anthropic/claude-haiku-4.5', 'openai/gpt-oss-120b-maas', 'google/gemma-4-26b-a4b-it-maas']
sel = [r for r in runs if r['model'] in pick]; sel.sort(key=lambda r: pick.index(r['model']))
fig, ax = plt.subplots(figsize=(10, 5)); w = 0.8 / len(sel)
for i, r in enumerate(sel):
    ax.bar([j + i * w for j in range(len(CATS))], [r['cats'][c] for c in CATS], width=w, label=r['label'], color=plt.cm.viridis(i / max(1, len(sel) - 1)))
ax.set_xticks([j + 0.4 - w / 2 for j in range(len(CATS))]); ax.set_xticklabels(CATS); ax.set_ylim(0.4, 1.02); ax.set_ylabel('rule score'); ax.set_title('Where cheap models fall short: by category'); ax.legend(fontsize=7.5, ncol=3, frameon=False, loc='lower left'); ax.grid(axis='y', color='#eee')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'eval-categories.svg')); fig.savefig('/tmp/eval-categories.png', dpi=110); plt.close(fig)

# 3. latency, sorted
lat = sorted([r for r in runs if r['ms'] > 0], key=lambda r: r['ms'])
fig, ax = plt.subplots(figsize=(9, 8))
ax.barh([r['label'] for r in lat], [r['ms'] / 1000 for r in lat], color=[COL[r['fam']] for r in lat])
ax.axvline(5, color='#b3261e', linestyle=':', linewidth=1); ax.text(5.2, 0.5, 'a chief gets ~2 s a week at normal speed; above ~5 s it acts on habit while thinking', fontsize=7.5, color='#b3261e', rotation=90, va='bottom')
ax.set_xscale('log'); ax.set_xlabel('seconds per decision (log scale)'); ax.set_title('Latency: the axis that disqualified nine models'); ax.grid(axis='x', color='#eee'); ax.tick_params(axis='y', labelsize=8)
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'eval-latency.svg')); plt.close(fig)

# 4. judge vs rules
fig, ax = plt.subplots(figsize=(8, 6))
for r in runs:
    if r['errors'] > 10 or math.isnan(r['judge']): continue
    ax.scatter(r['score'], r['judge'], s=70, color=COL[r['fam']], alpha=0.85, edgecolor='white', zorder=3); ax.annotate(r['label'], (r['score'], r['judge']), xytext=(5, 3), textcoords='offset points', fontsize=7.5)
ax.set_xlabel('rule score'); ax.set_ylabel('judge score for journals and dream replies, 1 to 5'); ax.set_xlim(0.9, 1.0); ax.set_title('Doing the right thing and saying it well are different skills'); ax.grid(color='#eee')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'eval-judge-vs-rules.svg')); plt.close(fig)

# 5. cost per chief-century by tier
tiers = [('habit', 0), ('thrifty', 1.16), ('standard', 5.07), ('lavish', 16.2), ('baseline: 3.8 Flash for everything', 13.64), ('3.1 Pro for everything', 34.4)]
fig, ax = plt.subplots(figsize=(8, 4)); ax.barh([t[0] for t in tiers], [t[1] for t in tiers], color=['#999', '#2f6f7a', '#2f6f7a', '#2f6f7a', '#c9a227', '#c9a227'])
for i, t in enumerate(tiers): ax.text(t[1] + 0.4, i, f'${t[1]:.2f}', va='center', fontsize=9)
ax.set_xlabel('dollars per chief per century, normal cadence (13 routine + 4 impactful decisions a year)'); ax.set_title('The intelligence knob, costed from measured decisions'); ax.grid(axis='x', color='#eee')
fig.tight_layout(); fig.savefig(os.path.join(OUT, 'eval-tiers.svg')); plt.close(fig)
print('wrote', len(os.listdir(OUT)), 'charts')

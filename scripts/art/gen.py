"""Generate sprite candidates with Gemini 3 Pro Image on Vertex AI, every one against the same style anchors.

    python3 scripts/art/gen.py --group buildings [--only hut,granary] [--n 4] [--model gemini-3-pro-image]

Reads art/manifest.json (asset keys, groups, subjects), attaches art/anchors/*.png as style references plus any
already-picked sprites of the same group as object references, and writes out/art/<group>/<key>-<n>.png with a
sidecar .json holding the prompt and usage. Auth is Application Default Credentials (gcloud); no keys in the repo.
"""
import argparse, base64, json, os, subprocess, sys, time, urllib.request, urllib.error, glob

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROJECT = os.environ.get('GOOGLE_CLOUD_PROJECT', 'wind-spirit-prod')
BIBLE = ("in the style of the attached reference image: stylised flat painting, clean shapes, a little painted texture inside shapes, "
         "one soft shadow tone, no outlines, no gradients, no rim light, lit from the upper left, three-quarter overhead view at the same angle as the reference. "
         "Single subject centred on a plain flat magenta background (pure #FF00FF), nothing else in frame, no ground plane, no text, no lettering, "
         "no faces, no real-world cultural markers. Ornament only as a carved band of spirals and wave-lines where the subject calls for it.")


def token() -> str:
    return subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()


def b64(path: str) -> dict:
    with open(path, 'rb') as f:
        return {'inlineData': {'mimeType': 'image/png', 'data': base64.b64encode(f.read()).decode()}}


def generate(tok: str, model: str, prompt: str, refs: list[str], size: str) -> tuple[bytes | None, dict]:
    url = f'https://aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/global/publishers/google/models/{model}:generateContent'
    parts = [b64(r) for r in refs] + [{'text': prompt}]
    body = {'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': {'aspectRatio': '1:1', 'imageSize': size}}}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                res = json.load(r)
            break
        except urllib.error.HTTPError as e:
            msg = e.read()[:200].decode(errors='replace')
            if e.code in (429, 503) and attempt < 2:
                time.sleep(8 * (attempt + 1)); continue
            return None, {'error': f'{e.code} {msg}'}
    ps = res.get('candidates', [{}])[0].get('content', {}).get('parts', [])
    img = next((p['inlineData'] for p in ps if 'inlineData' in p), None)
    return (base64.b64decode(img['data']) if img else None), {'usage': res.get('usageMetadata', {}), 'text': ' '.join(p.get('text', '') for p in ps if 'text' in p)[:300]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--group', required=True); ap.add_argument('--only', default=''); ap.add_argument('--n', type=int, default=4)
    ap.add_argument('--model', default='gemini-3-pro-image'); ap.add_argument('--size', default='1K'); ap.add_argument('--start', type=int, default=0)
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(ROOT, 'art', 'manifest.json')))
    assets = [x for x in manifest['assets'] if x['group'] == a.group and (not a.only or x['key'] in a.only.split(','))]
    if not assets: sys.exit(f'no assets in group {a.group}')
    anchors = sorted(glob.glob(os.path.join(ROOT, 'art', 'anchors', '*.png')))[:3]
    picks = json.load(open(os.path.join(ROOT, 'art', 'picks', f'{a.group}.json'))) if os.path.exists(os.path.join(ROOT, 'art', 'picks', f'{a.group}.json')) else {}
    picked = [os.path.join(ROOT, 'out', 'art', a.group, f'{k}-{i}.png') for k, i in picks.items()]
    picked = [p for p in picked if os.path.exists(p)][:6]
    outdir = os.path.join(ROOT, 'out', 'art', a.group); os.makedirs(outdir, exist_ok=True)
    tok = token(); spent_in = spent_out = 0
    for asset in assets:
        prompt = f"{asset['subject']}, {BIBLE} {asset.get('extra', '')}".strip()
        if picked: prompt += ' The other attached images are finished sprites from the same set: match their scale, palette and rendering exactly.'
        for i in range(a.start, a.start + a.n):
            out = os.path.join(outdir, f"{asset['key']}-{i}.png")
            if os.path.exists(out): continue
            t0 = time.time(); img, meta = generate(tok, a.model, prompt, anchors + picked, a.size)
            if not img: print(f"{asset['key']}-{i}: FAILED {meta.get('error') or meta.get('text')}"); continue
            open(out, 'wb').write(img)
            json.dump({'key': asset['key'], 'prompt': prompt, 'refs': [os.path.relpath(r, ROOT) for r in anchors + picked], 'model': a.model, **meta}, open(out[:-4] + '.json', 'w'), indent=1)
            u = meta.get('usage', {}); spent_in += u.get('promptTokenCount', 0); spent_out += u.get('candidatesTokenCount', 0)
            print(f"{asset['key']}-{i}: {time.time() - t0:.0f}s")
    print(f'tokens in {spent_in} out {spent_out}')


if __name__ == '__main__':
    main()

# Wind Spirit

A civilization sandbox where every village is run by an AI chief and the player is a spirit who sees everything and can touch almost nothing.

- [Concept](docs/concept.md)
- [Technical design](docs/technical-design.md)
- [M0 notes: balance findings](docs/m0-notes.md)
- [Build notes: M1 and M2](docs/build-notes.md)

## Layout

| Package | Role |
|---|---|
| `packages/sim` | Pure, deterministic weekly simulation. No dependencies. |
| `packages/gen` | Seeded generators: world, names, tech. |
| `packages/harness` | Balance harness: runs the sim with scripted chiefs, emits CSV and a report. |
| `packages/agents` | The chief agent: village view, prompt, decision schema, parser, scheduler with fallback. |
| `services/llm-proxy` | Cloud Run proxy to Vertex AI Gemini with Firebase auth and quotas. |

## Develop

```
pnpm install
pnpm test
pnpm harness -- run --seeds 20 --years 300 --policy sensible --out out/run1
```

Code is licensed under Apache-2.0 (see LICENSE). Design documents in `docs/` are CC BY 4.0.

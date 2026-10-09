# AGENTS.md — read this first

**AtomSim** — an interactive 3D simulator of **real quantum electron clouds**
(`|ψ|²` sampled as a point cloud) for hydrogen-like orbitals and neutral atoms
(all 118 elements). Vanilla TypeScript + three.js + Vite. No framework, no backend.

> Read this file and `soul.md`. You should not need to read the source to start.
> Deeper detail lives in `docs/`.

## Commands

```bash
npm run dev        # Vite dev server, HMR  -> http://localhost:5173
npm run build      # typecheck-free bundle -> dist/
npm run preview    # serve dist/
npm run typecheck  # tsc --noEmit (run before calling anything done)
npm test           # node hydrogen.test.ts && node atoms.test.ts (Node runs .ts directly)
```

Always run `npm run typecheck` and `npm test` after a change. They are fast.

## File map

| File | Responsibility |
|---|---|
| `index.html` | The whole UI shell: 4 regions (topbar / left panel / viewport / right panel). All DOM ids live here. |
| `style.css` | Dark monospace "instrument" theme. Pink accent via `--accent`. |
| `main.ts` | Everything else: three.js scene, sampling orchestration, all panels, plots, wiring. **The big file.** |
| `sampler.worker.ts` | Runs `|ψ|²` sampling off the main thread; imports `hydrogen.ts`. |
| `hydrogen.ts` | Pure physics (no DOM/three). Wavefunctions + samplers. Testable in Node. |
| `atoms.ts` | Elements H–Og (118): electron configuration, Slater effective charge. Depends on `hydrogen.ts`. |
| `hydrogen.test.ts` | Physics assertions (radial, angular, sampling). |
| `atoms.test.ts` | Config + Slater `Z_eff` assertions. |
| `tsconfig.json` / `vite-env.d.ts` / `package.json` | Tooling. |

## Architecture in 5 lines

1. UI lives in `index.html`; `main.ts` wires listeners to ids and holds all state in `params`.
2. `rebuild()` requests samples from `sampler.worker.ts` → `BufferGeometry` → `THREE.Points`.
3. Sampling is in `hydrogen.ts`: `sampleCloud` (single orbital), `sampleShell`
   (filled shell), `sampleSuperposition` (two orbitals).
4. `atoms.ts` gives each element its configuration + per-subshell `Z_eff`, so
   hydrogenic shapes contract correctly.
5. Plots (`drawRPlot`, `drawEnergyLadder`, `drawSpectrum`, `drawCrossSection`)
   are 2D canvases redrawn from `updateInfo()` on every rebuild.

## Conventions

- Keep `hydrogen.ts` / `atoms.ts` **pure** (no DOM, no three) so Node tests work.
- Units: **atomic units**, `a₀ = 1`, `Z = 1` unless a `Z` argument is passed.
- Import with explicit `.ts` extensions (Vite + Node both handle it).
- TypeScript is `strict`; `noUnusedLocals`/`noUnusedParameters` are on.
- One-line comments explain *why*, not *what*.

## Gotchas (things that will bite you)

- **Point size is adaptive** (`updatePointSize`), scaled to the cloud radius and
  clamped to 1.5–8 px. Do not hardcode a size — tiny clouds (e.g. Co 1s,
  R98 ≈ 0.14 a₀) would blob into a solid disc.
- **Camera**: fixed distance by default; the `fit view` toggle re-frames per
  cloud. `frameCloud()` is only called on state changes, not on density/colour.
- **`Z_eff` matters.** Never sample at `Z = 1` for a multi-electron atom; use
  `zeff(Z, n, l)`. Heavy-atom inner shells are tiny and very dense.
- **Superposition uses the first orbital's `Z_eff` for both states** (approximation).
- **Orbital list is gated**: ground-config orbitals only, unless `excited` is on.
- The **energy ladder is evenly spaced by n** on purpose (real levels crowd at
  E = 0 and become unreadable).
- `node_modules/` and `dist/` are generated — never edit or document them.

## Common tasks

| Want to… | Do this |
|---|---|
| Add an element | Extend `SYMBOLS` + `NAMES` in `atoms.ts`. |
| Add a plot / panel | Add markup in `index.html`, style in `style.css`, draw + wire in `main.ts` (`updateInfo`). |
| Change colours / theme | `style.css` variables and the palettes near the top of `main.ts`. |
| Change the physics | `hydrogen.ts` (+ a test). |
| Change screening | `zeff()` in `atoms.ts`. |

## Deep dives

- `docs/ARCHITECTURE.md` — data flow and the rebuild pipeline.
- `docs/PHYSICS.md` — the equations, sampling methods, and every approximation.
- `docs/UI.md` — layout, the DOM-id map, and the theming variables.
- `soul.md` — why this exists and the design principles to preserve.

# Architecture

## Module boundaries

```
index.html ── loads ──▶ main.ts ── imports ──▶ hydrogen.ts  (pure physics)
   (DOM shell)            (all wiring)    └──▶ atoms.ts      (pure, imports hydrogen.ts)
        ▲                        │            └──▶ style.css (imported by main.ts)
        └── styled by style.css  └── spawns ─▶ sampler.worker.ts ──▶ hydrogen.ts
```

- **`hydrogen.ts`** — no DOM, no three. Pure functions → testable in Node.
- **`atoms.ts`** — no DOM, no three. Electron configuration + Slater screening.
- **`sampler.worker.ts`** — runs sampling off the main thread; imports `hydrogen.ts`.
- **`main.ts`** — impure. Owns the three.js scene, the `params` state object, all
  DOM wiring, and every 2D-canvas plot.
- **`index.html`** — the entire UI markup; every element has an `id` (see `UI.md`).
- **`style.css`** — the theme.

The boundary is deliberate: physics stays testable and rendering stays replaceable.

## State

All mutable UI state is one object in `main.ts`:

```ts
const params = {
  element, view: 'atom' | 'orbital', orbital, superpose, orbital2,
  density, colour: 'phase' | 'shell' | 'density',
  autoRotate, fitView, measure, excited,
};
```

DOM listeners mutate `params`, then call `update(reFrame)` (which resamples and,
when `reFrame` is true, re-frames the camera — only on *state* changes, not on
density/colour).

## Rebuild pipeline

`rebuild()` is the heart (async — it awaits the worker):

```
rebuild()
 ├─ currentZ() / curA() / curB() / curZeff()        # resolve current state
 ├─ requestSample(req)  ──▶ sampler.worker.ts       # { positions, dens, signs?, shells?, count }
 │    ├─ mode 'atom'     atomUnits(Z) per unit      # sampleShell / sampleCloud
 │    ├─ mode 'orbital'  sampleCloud(...)
 │    └─ mode 'super'    sampleSuperposition(...)
 │   (stale responses are dropped by request id)
 ├─ colorFor(count, dens, signs, shells, n)         # colour mode
 ├─ BufferGeometry(position, aColor) -> THREE.Points # dispose the old one
 ├─ lastCount, lastRadius = percentileRadius(...)   # 98th-pct radius
 ├─ updatePointSize()                               # size ∝ radius, 1.5–8 px
 ├─ scale axes / nucleus / marker
 ├─ updateInfo()                                    # left panel + all plots
 ├─ updateScaleBar()
 └─ syncHash()
```

`update(reFrame)` wraps `rebuild()` and updates the log; `frameCloud()` sets the
camera distance from `lastRadius` (only when `fitView`). `updateInfo()` fills the
property rows and redraws the four canvases (`drawRPlot`, `drawEnergyLadder`,
`drawSpectrum`, `drawCrossSection`).

## Rendering (three.js)

- One `THREE.Points` rebuilt on every `rebuild()`; the old geometry is disposed.
- Points use a custom `ShaderMaterial` (`aColor` attribute): round sprites,
  additive blending, and **depth fade** (distant points dim).
- `EffectComposer` = RenderPass → **UnrealBloomPass** (glow) → OutputPass (ACES
  tone mapping) so dense cores glow instead of clipping.
- `AxesHelper`-style `LineSegments` (X red / Y green / Z blue), a tiny nucleus
  sphere, and a white measurement `marker` (hidden until a click).
- Camera is fixed by default; `OrbitControls` still handles manual orbit/zoom.

## Per-frame work

`renderer.setAnimationLoop`: `controls.update()`, update `uDist`, `composer.render()`,
`updateAxisLabels()` (project the axis endpoints to screen and position HTML
labels), and an FPS counter. Nothing else runs per frame — all sampling is on
demand in `rebuild()`.

## Adding a feature

1. Physics? Add to `hydrogen.ts` (+ a test in `hydrogen.test.ts`).
2. Element data / screening? `atoms.ts` (+ `atoms.test.ts`).
3. UI: markup in `index.html`, style in `style.css`, draw/wire in `main.ts`.
4. Update the docs here.

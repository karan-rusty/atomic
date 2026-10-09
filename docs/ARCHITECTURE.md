# Architecture

## Module boundaries

```
index.html ── loads ──▶ main.ts ── imports ──▶ hydrogen.ts  (pure physics)
   (DOM shell)            (all wiring)    └──▶ atoms.ts      (pure, imports hydrogen.ts)
        ▲                                     └──▶ style.css (imported by main.ts)
        └── styled by style.css
```

- **`hydrogen.ts`** — no DOM, no three. Pure functions → testable in Node.
- **`atoms.ts`** — no DOM, no three. Electron configuration + Slater screening.
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

DOM listeners mutate `params`, then call `rebuild()` (and `frameCloud()` when the
*state* — not density/colour — changed).

## Rebuild pipeline

`rebuild()` is the heart:

```
rebuild()
 ├─ currentZ() / curA() / curB() / curZeff()        # resolve current state
 ├─ buildAtomCloud(Z)  OR  buildOrbitalCloud()      # -> { positions, colors, count }
 │    ├─ sampleShell(...)      per occupied subshell (atom view)
 │    ├─ sampleCloud(...)      single orbital (orbital view)
 │    └─ sampleSuperposition() two orbitals
 ├─ BufferGeometry(position, color) -> THREE.Points # dispose the old one
 ├─ lastCount, lastRadius = percentileRadius(...)   # 98th-pct radius
 ├─ updatePointSize()                               # size ∝ radius, 1.5–8 px
 ├─ scale axes / nucleus / marker
 ├─ updateInfo()                                    # left panel + all plots
 └─ updateScaleBar()
```

`frameCloud()` sets the camera distance from `lastRadius` (only when `fitView`).
`updateInfo()` fills the property rows and redraws the four canvases
(`drawRPlot`, `drawEnergyLadder`, `drawSpectrum`, `drawCrossSection`).

## Rendering (three.js)

- One `THREE.Points` rebuilt on every `rebuild()`; the old geometry is disposed.
- `PointsMaterial`: vertex colours, additive blending, a radial-gradient sprite
  so dots glow. Tone mapping is ACES so dense cores don't blow out to white.
- `AxesHelper`-style `LineSegments` (X red / Y green / Z blue), a tiny nucleus
  sphere, and a white measurement `marker` (hidden until a click).
- Camera is fixed by default; `OrbitControls` still handles manual orbit/zoom.

## Per-frame work

`renderer.setAnimationLoop`: `controls.update()`, render, `updateAxisLabels()`
(project the axis endpoints to screen and position HTML labels), and an FPS
counter. Nothing else runs per frame — all sampling is on demand in `rebuild()`.

## Adding a feature

1. Physics? Add to `hydrogen.ts` (+ a test in `hydrogen.test.ts`).
2. Element data / screening? `atoms.ts` (+ `atoms.test.ts`).
3. UI: markup in `index.html`, style in `style.css`, draw/wire in `main.ts`.
4. Update the docs here.

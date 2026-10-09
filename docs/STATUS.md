# Status & next steps

A snapshot for whoever picks this up next.

## Implemented

- **Physics** (`hydrogen.ts`): hydrogen-like `ψ_nlm = R_nl · Y_lm`, real spherical
  harmonics, `|ψ|²` sampling (`sampleCloud`, `sampleShell`, `sampleSuperposition`),
  `psiAt`, `mostProbableRadius`, `nodeRadii`.
- **Atoms** (`atoms.ts`): all **118 elements** — Aufbau configuration, Slater
  `Z_eff`, `atomUnits` (Hund's-rule open shells), `orbitalsForAtom`.
- **Views**: atom (all occupied shells) and orbital (single state), plus an
  **excited-state** toggle that unlocks non-ground orbitals.
- **Superposition** of two orbitals, with optional **time evolution** (shader).
- **Colour modes**: phase / shell / density.
- **Panels**: state vector + properties (E, ⟨r⟩, |L|, ⟨1/r⟩, most-probable r,
  nodes, node radii), R(r)/P(r) plot, energy-level ladder, emission spectrum,
  2D cross-section (XZ), orbital gallery.
- **Rendering**: adaptive point size, depth fade, UnrealBloom + ACES.
- **UX**: URL state sharing, PNG export, responsive layout, keyboard shortcuts,
  accessibility (aria, focus), measurement mode.
- **Performance**: sampling runs in a Web Worker.
- **Tests**: `hydrogen.test.ts`, `atoms.test.ts` (Node runs the `.ts` directly).

## Known limitations

- Multi-electron atoms are **Slater-screened hydrogenic**, not Hartree–Fock/DFT.
- Superposition uses the **first orbital's `Z_eff`** for both states.
- **Time evolution** is animated at a fixed *visual* rate (real beat frequencies
  are ~10¹⁵ Hz).
- The **cross-section is XZ only**; the **energy ladder is evenly spaced by n**;
  **spectral lines** use hydrogenic `E_n` and the `Δl = ±1` rule (no fine structure).
- The **nucleus marker is not to scale**. No spin / magnetic / relativistic effects.
- Sampling uses **rejection** (see the `shortcut:` comment) — not inverse-CDF.
- The density colormap is **duplicated** (JS `densityColor` + GLSL `densityColor`).
- **No formatter or linter** is configured.
- The **worker and shader are not unit-tested** — verified by headless render only.
- Bundle is ~590 kB (three.js is the bulk).

## Suggested next work (roughly prioritised)

1. **Add Prettier + ESLint** and an `npm run lint`/`format` script; wire into the
   "definition of done".
2. **Automated render smoke test** in CI (headless chromium: page loads, no
   console errors, canvas present).
3. **Inverse-CDF sampling** to replace rejection (the noted `shortcut:`) — faster
   for high `n` / high counts.
4. **Cross-section plane toggle** (XY/XZ/YZ) and an animated slice.
5. **Test coverage**: worker message round-trip, `colorFor`, hash round-trip.
6. **Code-split / tree-shake** to shrink the bundle.
7. **GPU (WebGPU) compute sampling** if counts grow.
8. **Molecular orbitals (LCAO)** — a much larger step.

## Verify

```bash
npm run typecheck && npm test && npm run build
# headless render check (needs chromium):
npm run preview &        # serves dist/ on :4173
chromium --headless=new --no-sandbox --use-gl=angle --use-angle=swiftshader \
  --window-size=1560,860 --virtual-time-budget=8000 \
  --screenshot=/tmp/shot.png http://localhost:4173/
```

Note: headless screenshots run virtual time, which does **not** wait for the
Web Worker — heavy states may appear mid-“sampling…”. Use a low `pts` value or
dump the DOM and check `#log` for `> N points drawn`.

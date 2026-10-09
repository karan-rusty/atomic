# AtomSim

An interactive 3D simulator of **real quantum electron clouds** — the `|ψ|²`
probability cloud, not the fake Bohr "electrons on rings" model.

Dense points = more likely, sparse = less likely. Colour can show the
wavefunction phase (+ψ / −ψ), the shell, or the density.

![hydrogen-like clouds](docs/screenshot.png)

## Features

- **Real sampled `|ψ|²`** for hydrogen-like orbitals (`1s … 7p`) and neutral
  atoms (all 118 elements, Slater-screened hydrogenic shapes).
- **Atom view** (all occupied shells) and **orbital view** (a single state),
  including an **excited-state** toggle.
- **Superposition** of two orbitals — see where they reinforce and cancel, with
  optional **time evolution** (the cloud oscillates at the beat frequency).
- **Orbital gallery** — clickable thumbnails of every orbital for the element.
- Live panels: quantum numbers, energy, `⟨r⟩`, `|L|`, `⟨1/r⟩`, most-probable
  radius, node radii, **R(r)/P(r) plot**, **energy-level ladder**,
  **emission spectrum**, and a **2D cross-section** heatmap.
- Colour modes (phase / shell / density), fit-view toggle, measurement mode
  (click to collapse the cloud to one point).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run typecheck`,
`npm test`.

## Honesty note

Hydrogen is exact. Everything with more electrons uses **Slater-screened
hydrogenic orbitals** — an approximation, labelled as `SCREENED` in the UI.
Filled shells are genuinely spherical. The nucleus marker is not to scale.
See `docs/PHYSICS.md` for the details and `soul.md` for the philosophy.

## For AI agents / contributors

Start with [`AGENTS.md`](AGENTS.md), then [`docs/`](docs/).

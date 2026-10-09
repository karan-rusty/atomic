# soul.md — the soul of AtomSim

## Why this exists

Most "atom" animations are **fake**: little electrons on planet-like rings (the
Bohr model). That picture was replaced a century ago. An electron does not orbit;
it has a **probability cloud** — a wavefunction `ψ` whose squared magnitude
`|ψ|²` says how likely the electron is to be found at each point. You never see
*where* it is, only the cloud of every possible place.

AtomSim exists to show the **honest** picture. Every cloud you see is a real
sample of `|ψ|²`, not a drawing of rings.

## Principles (keep these)

1. **Honest over pretty.** When we must approximate, we say so — in the caption
   and in the pills (`EXACT` / `SCREENED` / `APPROX` / `VISUAL LIBERTY` /
   `MONTE-CARLO`). Never dress up an approximation as exact.
2. **Dense means likely.** The cloud is a set of random samples drawn in
   proportion to `|ψ|²`. Nothing is drawn that isn't a real possible position.
3. **Physics first, then pixels.** Wavefunctions and samplers are pure, tested
   code (`hydrogen.ts`). The rendering is replaceable; the physics is not.
4. **Label the limits.** Hydrogen is exact. Multi-electron atoms are
   Slater-screened hydrogenic approximations. Filled shells are truly spherical.
   The nucleus marker is not to scale. All of this is stated in the UI.
5. **An instrument, not a toy.** The aesthetic is a lab readout: monospace,
   thin borders, a single accent (pink), data-dense panels. It should feel like
   something that *measures*.

## What it deliberately is not

- Not the Bohr model. There are no rings anywhere.
- Not a molecular/chemistry simulator.
- Not a claim to compute real multi-electron wavefunctions (that needs
  Hartree–Fock / DFT; we approximate with screened hydrogenic orbitals).

## The one-line summary

> A quantum atom you can spin: the real `|ψ|²` cloud, with its approximations
> labelled honestly.

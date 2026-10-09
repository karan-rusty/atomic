# Physics

Units are **atomic**: `a₀ = 1`, `ħ = 1`, `Z = 1` unless passed. Constants used:
`a₀ = 52.9177 pm`, `1 Ha = 27.2114 eV`, `hc = 1239.84 eV·nm`.

## Wavefunction

```
ψ_nlm(r, θ, φ) = R_nl(r) · Y_lm(θ, φ)
```

### Radial part (Z = 1)

```
R_nl(r) = sqrt( (2/n)³ · (n−l−1)! / (2n·(n+l)!) ) · e^(−r/n) · (2r/n)^l · L^{2l+1}_{n−l−1}(2r/n)
```

Generalized Laguerre `L^k_α(x)` by recurrence:

```
L_0^α = 1
L_1^α = 1 + α − x
L_{i+1}^α = ((2i+1+α−x)·L_i^α − (i+α)·L_{i−1}^α) / (i+1)
```

### Angular part — *real* spherical harmonics

```
Y_l0      = √((2l+1)/4π) · P_l^0(cosθ)
Y_l^{m>0} = √2 · √((2l+1)/4π · (l−m)!/(l+m)!) · P_l^m(cosθ) · cos(mφ)
Y_l^{m<0} = √2 · √((2l+1)/4π · (l−|m|)!/(l+|m|)!) · P_l^{|m|}(cosθ) · sin(|m|φ)
```

`P_l^m` by the standard associated-Legendre recurrence. Real harmonics give the
familiar lobes (`p_x`, `d_xy`, …) rather than complex donuts.

## Nuclear charge (Z ≠ 1)

Hydrogenic solutions scale exactly: `R_nl^Z(r) = Z^{3/2} · R_nl^{1}(Zr)`. So the
cloud for charge `Z` is the `Z=1` cloud scaled by `1/Z`. The samplers exploit
this: sample at `Z=1`, divide positions by `Z`. `rMax = 5n²/Z`.

## Sampling `|ψ|²`

The cloud is `count` random points drawn in proportion to `|ψ|²` — dense where the
electron is likely.

- **`sampleCloud(n,l,m,count,Z)`** — single orbital. Radii and angles are
  independent in `|ψ|²`, so each is sampled from its own marginal by **rejection**:
  radial density `P(r) = r²·R_nl(r)²`; angular density `|Y_lm|²` with `cosθ`
  uniform in `[−1,1]` and `φ` uniform in `[0,2π)`.
  `shortcut:` rejection sampling — swap to inverse-CDF tables if high-n, high-count
  clouds hitch.
- **`sampleShell(n,l,Z,count)`** — a *filled* subshell. Because
  `Σ_m |Y_lm|² = (2l+1)/4π` is constant, a full shell is **spherical**: sample the
  radius by rejection and the direction uniformly on the sphere.
- **`sampleSuperposition(a,b,count,Z)`** — `|ψ_a + ψ_b|²` by **importance
  sampling**: draw from `|ψ_a|²` or `|ψ_b|²` (50/50), accept with probability
  `|ψ_a+ψ_b|² / (2(|ψ_a|²+|ψ_b|²))` ∈ [0,1]. This is exact for the two-orbital mix.

## Effective nuclear charge (Slater's rules) — `atoms.ts`

For a multi-electron atom, each subshell is a hydrogenic orbital screened by the
other electrons. Groups: `(ns,np)` together; `nd` and `nf` separate. For an
electron in `(n,l)`:

- other electrons in the **same group**: `0.35` each (`0.30` for `1s`);
- for `s`/`p`: the `(n−1)` shell contributes `0.85` each, `≤(n−2)` contributes `1.00`;
- for `d`/`f`: everything inside contributes `1.00`.

`Z_eff = max(Z − S, 0.1)`. Verified values (in `atoms.test.ts`): C 2p = 3.25,
C 1s = 5.70, Na 3s = 2.20, Sc 3d = 3.00.

## Derived quantities (shown in the left panel)

```
E_n   = −Z²/2n²  Ha = −13.606 Z²/n² eV
⟨r⟩   = (3n² − l(l+1)) / (2Z)  a₀
⟨1/r⟩ = Z/n²  a₀⁻¹
|L|   = √(l(l+1))  ħ
nodes = (n−l−1) radial, l angular
```

Most-probable radius and node radii are found by numeric scans (`mostProbableRadius`,
`nodeRadii`).

## Approximations & caveats (state these; do not hide them)

- **Hydrogen (Z = 1) is exact.** Everything else is a **Slater-screened
  hydrogenic** approximation — not a Hartree–Fock / DFT solution.
- **Filled and half-filled subshells are drawn spherically — which is exact**
  (Σ_m |Y_lm|² is constant). **Open shells follow Hund's rule** (singly-occupied
  m first), so e.g. carbon 2p² shows two lobes while nitrogen 2p³ is spherical.
  (Which degenerate m are singly occupied is arbitrary; a canonical order is used.)
- **Superposition** uses the first orbital's `Z_eff` for both states. **Time
  evolution** computes `|ψ(t)|² = ½(|a|²+|b|²) + ab·cos(ΔE·t)` in the shader;
  the phase is animated at a fixed *visual* rate (real beat frequencies are
  ~10¹⁵ Hz, far too fast to see).
- **Spectrum** uses hydrogenic `E_n` with the valence `Z_eff` and assumes the
  `Δl = ±1` selection rule. No fine structure, spin, or relativistic effects.
- The **energy ladder is evenly spaced by n**, not to scale (real levels crowd at
  E = 0).
- The **nucleus marker is not to scale** (it is ~10⁻⁵ of the atom).
- The **cross-section** is the XZ plane (`y = 0`) only.

## References

- Standard hydrogenic solutions (Griffiths, *QM*; Atkins, *Physical Chemistry*).
- Slater, J. C. (1930), *Atomic Shielding Constants*.

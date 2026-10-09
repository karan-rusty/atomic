// hydrogen.ts — hydrogen-like wavefunctions.
// Atomic units: a0 = 1, Z = 1. No browser deps, so the node test can import it.

const factCache: number[] = [1];
function fact(k: number): number {
  for (let i = factCache.length; i <= k; i++) factCache[i] = factCache[i - 1] * i;
  return factCache[k];
}

// Generalized Laguerre L_k^alpha(x) via the standard recurrence.
function laguerre(k: number, alpha: number, x: number): number {
  let prev = 1;
  if (k === 0) return prev;
  let curr = 1 + alpha - x;
  for (let i = 1; i < k; i++) {
    const next = ((2 * i + 1 + alpha - x) * curr - (i + alpha) * prev) / (i + 1);
    prev = curr;
    curr = next;
  }
  return curr;
}

// Radial wavefunction R_nl(r).
export function radial(n: number, l: number, r: number): number {
  const rho = (2 * r) / n;
  const norm = Math.sqrt((2 / n) ** 3 * (fact(n - l - 1) / (2 * n * fact(n + l))));
  return norm * Math.exp(-r / n) * rho ** l * laguerre(n - l - 1, 2 * l + 1, rho);
}

// Associated Legendre P_l^m(x), x = cos(theta), via recurrence.
function plm(l: number, m: number, x: number): number {
  let pmm = 1;
  if (m > 0) {
    const somx2 = Math.sqrt((1 - x) * (1 + x));
    let f = 1;
    for (let i = 1; i <= m; i++) {
      pmm *= -f * somx2;
      f += 2;
    }
  }
  if (l === m) return pmm;
  let pmmp1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return pmmp1;
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = (x * (2 * ll - 1) * pmmp1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pmmp1;
    pmmp1 = pll;
  }
  return pll;
}

// Real spherical harmonic Y_lm(theta, phi).
export function realY(l: number, m: number, theta: number, phi: number): number {
  const am = Math.abs(m);
  const norm = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (fact(l - am) / fact(l + am)));
  const p = plm(l, am, Math.cos(theta));
  if (m === 0) return norm * p;
  const ang = norm * Math.SQRT2 * p; // sqrt(2) folds the +/-m normalization
  return m > 0 ? ang * Math.cos(m * phi) : ang * Math.sin(am * phi);
}

export interface Cloud {
  positions: Float32Array;
  signs: Int8Array;
}

// Sample `count` electron positions from |psi_nlm|^2.
// `Z` is the effective nuclear charge (hydrogenic shape scaled by 1/Z).
// Returns Cartesian positions and the sign of psi at each point (for phase color).
export function sampleCloud(n: number, l: number, m: number, count: number, Z = 1): Cloud {
  const rMax = Math.max(10, 5 * n * n);

  // Peak of the radial density P(r) = r^2 R(r)^2, from a fine grid.
  let pmax = 0;
  for (let i = 1; i < 4000; i++) {
    const r = (i / 4000) * rMax;
    const v = r * r * radial(n, l, r) ** 2;
    if (v > pmax) pmax = v;
  }
  pmax *= 1.001; // guard against grid under-sampling the true peak

  // Peak of |Y|^2 over the sphere.
  let ymax2 = 0;
  for (let it = 0; it <= 360; it++) {
    const theta = (it / 360) * Math.PI;
    for (let ip = 0; ip < 360; ip++) {
      const y = realY(l, m, theta, (ip / 360) * 2 * Math.PI);
      if (y * y > ymax2) ymax2 = y * y;
    }
  }
  ymax2 *= 1.001;

  const positions = new Float32Array(count * 3);
  const signs = new Int8Array(count);

  for (let k = 0; k < count; k++) {
    // Radii and angles are independent in |psi|^2, so sample each from its
    // own marginal by rejection.
    let r: number;
    for (;;) {
      r = Math.random() * rMax;
      if (Math.random() * pmax < r * r * radial(n, l, r) ** 2) break;
    }
    let theta: number, phi: number, yv: number;
    for (;;) {
      theta = Math.acos(2 * Math.random() - 1); // uniform in cos(theta)
      phi = Math.random() * 2 * Math.PI;
      yv = realY(l, m, theta, phi);
      if (Math.random() * ymax2 < yv * yv) break;
    }
    const st = Math.sin(theta);
    positions[3 * k] = r * st * Math.cos(phi);
    positions[3 * k + 1] = r * st * Math.sin(phi);
    positions[3 * k + 2] = r * Math.cos(theta);
    signs[k] = radial(n, l, r) * yv >= 0 ? 1 : -1;
  }
  // shortcut: rejection sampling; swap to inverse-CDF tables if high-n
  // clouds (n>=4, >=500k points) cause a visible hitch.
  if (Z !== 1) for (let i = 0; i < positions.length; i++) positions[i] /= Z;
  return { positions, signs };
}

// Sample `count` points from a filled subshell: radial |R_nl|^2, isotropic
// angle (sum over m of |Y_lm|^2 is constant, so a full shell is spherical).
export function sampleShell(n: number, l: number, Z: number, count: number): Float32Array {
  const rMax = Math.max(10, 5 * n * n);
  let pmax = 0;
  for (let i = 1; i < 4000; i++) {
    const r = (i / 4000) * rMax;
    const v = r * r * radial(n, l, r) ** 2;
    if (v > pmax) pmax = v;
  }
  pmax *= 1.001;

  const positions = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    let r: number;
    for (;;) {
      r = Math.random() * rMax;
      if (Math.random() * pmax < r * r * radial(n, l, r) ** 2) break;
    }
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * 2 * Math.PI;
    const st = Math.sqrt(1 - u * u);
    positions[3 * k] = (r * st * Math.cos(phi)) / Z;
    positions[3 * k + 1] = (r * st * Math.sin(phi)) / Z;
    positions[3 * k + 2] = (r * u) / Z;
  }
  return positions;
}

export interface Orbital {
  n: number;
  l: number;
  m: number;
}

// Signed wavefunction psi_nlm at a world point (Z^{3/2} factor omitted; it is
// constant for a given Z, so it cancels in densities and superpositions).
export function psiAt(n: number, l: number, m: number, Z: number, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z);
  if (r < 1e-12) return radial(n, l, 0) * realY(l, m, 0, 0);
  return radial(n, l, Z * r) * realY(l, m, Math.acos(z / r), Math.atan2(y, x));
}

// Radius at which the radial density r^2 R(r)^2 peaks.
export function mostProbableRadius(n: number, l: number, Z: number): number {
  const rMax = (5 * n * n) / Z;
  let best = 0;
  let bestV = -1;
  for (let i = 1; i <= 4000; i++) {
    const r = (i / 4000) * rMax;
    const v = r * r * radial(n, l, Z * r) ** 2;
    if (v > bestV) {
      bestV = v;
      best = r;
    }
  }
  return best;
}

// Radii of the radial nodes (zeros of R(r)) in (0, rMax].
export function nodeRadii(n: number, l: number, Z: number): number[] {
  const rMax = (5 * n * n) / Z;
  const out: number[] = [];
  let prev = radial(n, l, Z * (rMax / 4000)) > 0;
  for (let i = 2; i <= 4000; i++) {
    const r = (i / 4000) * rMax;
    const cur = radial(n, l, Z * r) > 0;
    if (cur !== prev) out.push(r);
    prev = cur;
  }
  return out;
}

// Sample from |psi_a + psi_b|^2 (a two-orbital superposition) by importance
// sampling: draw from either orbital, accept with |a+b|^2 / (2(|a|^2+|b|^2)).
export function sampleSuperposition(a: Orbital, b: Orbital, count: number, Z: number): Cloud {
  const pool = count * 4;
  const A = sampleCloud(a.n, a.l, a.m, pool, Z);
  const B = sampleCloud(b.n, b.l, b.m, pool, Z);
  const positions = new Float32Array(count * 3);
  const signs = new Int8Array(count);
  let k = 0;
  for (let i = 0; i < pool && k < count; i++) {
    for (const src of [A, B]) {
      const x = src.positions[3 * i], y = src.positions[3 * i + 1], z = src.positions[3 * i + 2];
      const pa = psiAt(a.n, a.l, a.m, Z, x, y, z);
      const pb = psiAt(b.n, b.l, b.m, Z, x, y, z);
      const denom = pa * pa + pb * pb;
      const acc = denom > 0 ? ((pa + pb) ** 2) / (2 * denom) : 0;
      if (Math.random() < acc) {
        positions[3 * k] = x;
        positions[3 * k + 1] = y;
        positions[3 * k + 2] = z;
        signs[k] = pa + pb >= 0 ? 1 : -1;
        k++;
        if (k >= count) break;
      }
    }
  }
  // Fallback if too few accepted (very different orbitals): top up from A.
  for (let i = 0; k < count && i < pool; i++) {
    positions[3 * k] = A.positions[3 * i];
    positions[3 * k + 1] = A.positions[3 * i + 1];
    positions[3 * k + 2] = A.positions[3 * i + 2];
    signs[k] = A.signs[i];
    k++;
  }
  return { positions, signs };
}

const S: Record<string, string> = { '0': 's' };
const P: Record<string, string> = { '0': 'p_z', '1': 'p_x', '-1': 'p_y' };
const D: Record<string, string> = { '0': 'd_z2', '1': 'd_xz', '-1': 'd_yz', '2': 'd_x2-y2', '-2': 'd_xy' };
const F: Record<string, string> = {
  '0': 'f_z3', '1': 'f_xz2', '-1': 'f_yz2', '2': 'f_z(x2-y2)',
  '-2': 'f_xyz', '3': 'f_x(x2-3y2)', '-3': 'f_y(3x2-y2)',
};

// Named orbitals of a single subshell (all m), e.g. (2,1) -> 2p_z, 2p_x, 2p_y.
export function subshellOrbitals(n: number, l: number): Record<string, Orbital> {
  const byL = [S, P, D, F];
  const map: Record<string, Orbital> = {};
  if (l < byL.length) {
    for (const mKey in byL[l]) map[`${n}${byL[l][mKey]}`] = { n, l, m: Number(mKey) };
  }
  return map;
}

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
// Returns Cartesian positions and the sign of psi at each point (for phase color).
export function sampleCloud(n: number, l: number, m: number, count: number): Cloud {
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
  return { positions, signs };
}

export interface Orbital {
  n: number;
  l: number;
  m: number;
}

const S: Record<string, string> = { '0': 's' };
const P: Record<string, string> = { '0': 'p_z', '1': 'p_x', '-1': 'p_y' };
const D: Record<string, string> = { '0': 'd_z2', '1': 'd_xz', '-1': 'd_yz', '2': 'd_x2-y2', '-2': 'd_xy' };
const F: Record<string, string> = {
  '0': 'f_z3', '1': 'f_xz2', '-1': 'f_yz2', '2': 'f_z(x2-y2)',
  '-2': 'f_xyz', '3': 'f_x(x2-3y2)', '-3': 'f_y(3x2-y2)',
};

// Display name -> { n, l, m } for n = 1..4.
export const ORBITALS: Record<string, Orbital> = (() => {
  const byL = [S, P, D, F];
  const map: Record<string, Orbital> = {};
  for (let n = 1; n <= 4; n++) {
    for (let l = 0; l < n; l++) {
      for (const mKey in byL[l]) {
        map[`${n}${byL[l][mKey]}`] = { n, l, m: Number(mKey) };
      }
    }
  }
  return map;
})();

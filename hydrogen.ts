const factCache: number[] = [1];
function fact(k: number): number {
  for (let i = factCache.length; i <= k; i++) factCache[i] = factCache[i - 1] * i;
  return factCache[k];
}

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

export function radial(n: number, l: number, r: number): number {
  const rho = (2 * r) / n;
  const norm = Math.sqrt((2 / n) ** 3 * (fact(n - l - 1) / (2 * n * fact(n + l))));
  return norm * Math.exp(-r / n) * rho ** l * laguerre(n - l - 1, 2 * l + 1, rho);
}

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

export function sampleCloud(n: number, l: number, m: number, count: number, Z = 1): Cloud {
  const rMax = Math.max(10, 5 * n * n);

  // Peak of the radial density P(r) = r^2 R(r)^2, from a fine grid.
  let pmax = 0;
  for (let i = 1; i < 4000; i++) {
    const r = (i / 4000) * rMax;
    const v = r * r * radial(n, l, r) ** 2;
    if (v > pmax) pmax = v;
  }
  pmax *= 1.001;
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
    let r: number;
    for (; ;) {
      r = Math.random() * rMax;
      if (Math.random() * pmax < r * r * radial(n, l, r) ** 2) break;
    }
    let theta: number, phi: number, yv: number;
    for (; ;) {
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
  if (Z !== 1) for (let i = 0; i < positions.length; i++) positions[i] /= Z;
  return { positions, signs };
}

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
    for (; ;) {
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

export function psiAt(n: number, l: number, m: number, Z: number, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z);
  if (r < 1e-12) return radial(n, l, 0) * realY(l, m, 0, 0);
  return radial(n, l, Z * r) * realY(l, m, Math.acos(z / r), Math.atan2(y, x));
}

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

export function angularNodePlanes(_l: number, m: number): number[] {
  const am = Math.abs(m);
  if (am === 0) return [];
  const out: number[] = [];
  for (let k = 0; k < am; k++) out.push(m > 0 ? ((2 * k + 1) * Math.PI) / (2 * am) : (k * Math.PI) / am);
  return out;
}

export function angularNodeCones(l: number, m: number): number[] {
  const am = Math.abs(m);
  const phi = m < 0 ? Math.PI / (2 * am) : 0;
  const f = (theta: number) => realY(l, m, theta, phi);
  const N = 2000;
  const out: number[] = [];
  let prev = f((1 / N) * Math.PI) > 0;
  for (let i = 2; i < N; i++) {
    const theta = (i / N) * Math.PI;
    const cur = f(theta) > 0;
    if (cur !== prev) out.push(theta);
    prev = cur;
  }
  return out.map((t) => (Math.abs(Math.cos(t)) < (1.5 * Math.PI) / N ? Math.PI / 2 : t));
}

export function sampleSuperposition(a: Orbital, b: Orbital, count: number, Za: number, Zb: number): Cloud {
  const pool = count * 3;
  const A = sampleCloud(a.n, a.l, a.m, pool, Za);
  const B = sampleCloud(b.n, b.l, b.m, pool, Zb);
  const positions = new Float32Array(count * 3);
  const signs = new Int8Array(count);
  let k = 0;
  for (let i = 0; i < pool && k < count; i++) {
    for (const src of [A, B]) {
      const x = src.positions[3 * i], y = src.positions[3 * i + 1], z = src.positions[3 * i + 2];
      const pa = psiAt(a.n, a.l, a.m, Za, x, y, z);
      const pb = psiAt(b.n, b.l, b.m, Zb, x, y, z);
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

export function subshellOrbitals(n: number, l: number): Record<string, Orbital> {
  const byL = [S, P, D, F];
  const map: Record<string, Orbital> = {};
  if (l < byL.length) {
    for (const mKey in byL[l]) map[`${n}${byL[l][mKey]}`] = { n, l, m: Number(mKey) };
  }
  return map;
}

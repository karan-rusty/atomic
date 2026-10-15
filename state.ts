import { psiAt, radial, subshellOrbitals, type Orbital } from './hydrogen.ts';
import { SYMBOLS, electronConfig, orbitalsForAtom, zeff } from './atoms.ts';

export const params = {
  element: 'C',
  view: 'atom' as 'atom' | 'orbital',
  orbital: '2p_z',
  superpose: false,
  orbital2: '2p_x',
  evolve: false,
  density: 100000,
  colour: 'phase' as 'phase' | 'shell' | 'density',
  units: 'a0' as 'a0' | 'pm' | 'ang',
  plane: 'xz' as 'xz' | 'xy' | 'yz',
  autoRotate: true,
  fitView: true,
  measure: false,
  trueScale: false,
  nodes: false,
  excited: false,
};

const Z_of = (symbol: string) => SYMBOLS.indexOf(symbol) + 1;

// Physical nucleus radius as a fraction of the cloud radius (a0 = 52.9177 pm):
// r_nuc = 1.2 fm * A^(1/3), A ~ 2Z. ~3e-5, so at true scale it vanishes.
export const nuclearRatio = (Z: number) => (1.2e-15 * Math.cbrt(2 * Z)) / 52.9177e-12;

export function availableOrbitals(): Record<string, Orbital> {
  if (!params.excited) return orbitalsForAtom(Z_of(params.element));
  const map: Record<string, Orbital> = {};
  for (let n = 1; n <= 6; n++) for (let l = 0; l < Math.min(n, 4); l++) Object.assign(map, subshellOrbitals(n, l));
  return map;
}
export let atomOrbitals = availableOrbitals();

// updateOrbitals() (controls) rebuilds the set; an imported binding is read-only.
export function setAtomOrbitals(map: Record<string, Orbital>): void {
  atomOrbitals = map;
}

export function percentileRadius(pos: Float32Array, count: number, p: number): number {
  const stride = Math.max(1, Math.floor(count / 10000));
  const radii: number[] = [];
  for (let i = 0; i < count; i += stride) radii.push(Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]));
  radii.sort((a, b) => a - b);
  return radii[Math.floor((radii.length - 1) * p)] || 1;
}

// --- current-state helpers ---
export function currentZ(): number {
  return Z_of(params.element);
}
export function curA(): Orbital {
  return atomOrbitals[params.orbital];
}
export function curB(): Orbital | null {
  return params.superpose ? atomOrbitals[params.orbital2] : null;
}
export function curZeff(): number {
  return zeff(currentZ(), curA().n, curA().l);
}

function currentPsi(x: number, y: number, z: number): number {
  const A = curA(),
    B = curB();
  let v = psiAt(A.n, A.l, A.m, curZeff(), x, y, z);
  if (B) v += psiAt(B.n, B.l, B.m, zeff(currentZ(), B.n, B.l), x, y, z);
  return v;
}
function atomDensity(Z: number, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z);
  let d = 0;
  for (const s of electronConfig(Z)) {
    const v = radial(s.n, s.l, zeff(Z, s.n, s.l) * r);
    d += v * v;
  }
  return d;
}
export function currentDensity(x: number, y: number, z: number): number {
  if (params.view === 'atom') return atomDensity(currentZ(), x, y, z);
  const v = currentPsi(x, y, z);
  return v * v;
}

export const sup = (n: number) => String(n).replace(/[0-9]/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]);

// Length units for the readouts (all stored internally in a₀ = bohr).
const LEN_UNITS = {
  a0: { f: 1, label: 'a₀', d: 3 },
  pm: { f: 52.9177, label: 'pm', d: 1 },
  ang: { f: 0.529177, label: 'Å', d: 2 },
};
export function fmtLen(a0: number, d?: number): string {
  const u = LEN_UNITS[params.units];
  return `${(a0 * u.f).toFixed(d ?? u.d)} ${u.label}`;
}

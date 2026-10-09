// atoms.ts — neutral elements (Z = 1..36) with Slater effective nuclear charge.
// Multi-electron atoms have no closed-form wavefunction; we approximate each
// occupied subshell as a hydrogenic orbital screened by the other electrons.

import { subshellOrbitals, type Orbital } from './hydrogen.ts';

export const SYMBOLS = [
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si',
  'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co',
  'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
];

export interface Subshell {
  n: number;
  l: number;
  e: number;
}

// Madelung (Aufbau) filling order for Z <= 36.
const AUFBAU: Array<[number, number]> = [
  [1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [3, 2], [4, 1],
  [5, 0], [4, 2], [5, 1], [6, 0], [4, 3], [5, 2], [6, 1], [7, 0],
];
const CAPACITY = [2, 6, 10, 14];

// Occupied subshells of the neutral atom with nuclear charge Z.
export function electronConfig(Z: number): Subshell[] {
  const out: Subshell[] = [];
  let left = Z;
  for (const [n, l] of AUFBAU) {
    if (left <= 0) break;
    const e = Math.min(left, CAPACITY[l]);
    out.push({ n, l, e });
    left -= e;
  }
  return out;
}

// Slater group order: (ns,np) share a group; nd and nf are their own.
// block 0 = s/p, 2 = d, 3 = f.
const SLATER_ORDER: Array<[number, number]> = (() => {
  const o: Array<[number, number]> = [];
  for (let n = 1; n <= 7; n++) {
    o.push([n, 0]);
    if (n >= 3) o.push([n, 2]);
    if (n >= 4) o.push([n, 3]);
  }
  return o;
})();

function groupIndex(n: number, l: number): number {
  const block = l <= 1 ? 0 : l;
  return SLATER_ORDER.findIndex(([gn, gb]) => gn === n && gb === block);
}

// Effective nuclear charge felt by an electron in subshell (n, l), via Slater's rules.
export function zeff(Z: number, n: number, l: number): number {
  const cfg = electronConfig(Z);
  const groups = new Map<number, number>();
  for (const s of cfg) {
    const gi = groupIndex(s.n, s.l);
    groups.set(gi, (groups.get(gi) ?? 0) + s.e);
  }
  const gi = groupIndex(n, l);
  const occupied = cfg.some((s) => s.n === n && s.l === l);
  const sameOthers = (groups.get(gi) ?? 0) - (occupied ? 1 : 0);

  let shielded = sameOthers * (n === 1 ? 0.3 : 0.35);
  for (const [k, e] of groups) {
    if (k === gi || k > gi) continue; // same group handled; groups to the right shield nothing
    const [gn] = SLATER_ORDER[k];
    if (l <= 1) {
      if (gn === n - 1) shielded += e * 0.85;
      else if (gn <= n - 2) shielded += e * 1.0;
    } else {
      shielded += e * 1.0; // d/f electrons: everything inside counts fully
    }
  }
  return Math.max(Z - shielded, 0.1);
}

// The orbitals that actually exist in the neutral atom's ground configuration.
export function orbitalsForAtom(Z: number): Record<string, Orbital> {
  const map: Record<string, Orbital> = {};
  for (const s of electronConfig(Z)) Object.assign(map, subshellOrbitals(s.n, s.l));
  return map;
}

import { subshellOrbitals, type Orbital } from './hydrogen.ts';

export const SYMBOLS = [
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
  'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
  'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
  'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
  'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
  'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
];

export const NAMES = [
  'Hydrogen', 'Helium', 'Lithium', 'Beryllium', 'Boron', 'Carbon', 'Nitrogen',
  'Oxygen', 'Fluorine', 'Neon', 'Sodium', 'Magnesium', 'Aluminium', 'Silicon',
  'Phosphorus', 'Sulfur', 'Chlorine', 'Argon', 'Potassium', 'Calcium',
  'Scandium', 'Titanium', 'Vanadium', 'Chromium', 'Manganese', 'Iron',
  'Cobalt', 'Nickel', 'Copper', 'Zinc', 'Gallium', 'Germanium', 'Arsenic',
  'Selenium', 'Bromine', 'Krypton', 'Rubidium', 'Strontium', 'Yttrium',
  'Zirconium', 'Niobium', 'Molybdenum', 'Technetium', 'Ruthenium', 'Rhodium',
  'Palladium', 'Silver', 'Cadmium', 'Indium', 'Tin', 'Antimony', 'Tellurium',
  'Iodine', 'Xenon', 'Caesium', 'Barium', 'Lanthanum', 'Cerium', 'Praseodymium',
  'Neodymium', 'Promethium', 'Samarium', 'Europium', 'Gadolinium', 'Terbium',
  'Dysprosium', 'Holmium', 'Erbium', 'Thulium', 'Ytterbium', 'Lutetium',
  'Hafnium', 'Tantalum', 'Tungsten', 'Rhenium', 'Osmium', 'Iridium',
  'Platinum', 'Gold', 'Mercury', 'Thallium', 'Lead', 'Bismuth', 'Polonium',
  'Astatine', 'Radon', 'Francium', 'Radium', 'Actinium', 'Thorium',
  'Protactinium', 'Uranium', 'Neptunium', 'Plutonium', 'Americium', 'Curium',
  'Berkelium', 'Californium', 'Einsteinium', 'Fermium', 'Mendelevium',
  'Nobelium', 'Lawrencium', 'Rutherfordium', 'Dubnium', 'Seaborgium',
  'Bohrium', 'Hassium', 'Meitnerium', 'Darmstadtium', 'Roentgenium',
  'Copernicium', 'Nihonium', 'Flerovium', 'Moscovium', 'Livermorium',
  'Tennessine', 'Oganesson',
];

export const elementName = (Z: number): string => NAMES[Z - 1] ?? `Z=${Z}`;

export interface Subshell {
  n: number;
  l: number;
  e: number;
}

// Madelung (Aufbau) filling order, enough for all 118 elements.
const AUFBAU: Array<[number, number]> = [
  [1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [3, 2], [4, 1],
  [5, 0], [4, 2], [5, 1], [6, 0], [4, 3], [5, 2], [6, 1], [7, 0],
  [5, 3], [6, 2], [7, 1],
];
const CAPACITY = [2, 6, 10, 14];

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

export const ATOMIC_MASS: number[] = [
  1.008, 4.0026, 6.94, 9.0122, 10.81, 12.011, 14.007, 15.999, 18.998, 20.180,
  22.990, 24.305, 26.982, 28.085, 30.974, 32.06, 35.45, 39.95, 39.098, 40.078,
  44.956, 47.867, 50.942, 51.996, 54.938, 55.845, 58.933, 58.693, 63.546, 65.38,
  69.723, 72.630, 74.922, 78.971, 79.904, 83.798, 85.468, 87.62, 88.906, 91.224,
  92.906, 95.95, 98, 101.07, 102.91, 106.42, 107.87, 112.41, 114.82, 118.71,
  121.76, 127.60, 126.90, 131.29, 132.91, 137.33, 138.91, 140.12, 140.91, 144.24,
  145, 150.36, 151.96, 157.25, 158.93, 162.50, 164.93, 167.26, 168.93, 173.05,
  174.97, 178.49, 180.95, 183.84, 186.21, 190.23, 192.22, 195.08, 196.97, 200.59,
  204.38, 207.2, 208.98, 209, 210, 222, 223, 226, 227, 232.04,
  231.04, 238.03, 237, 244, 243, 247, 247, 251, 252, 257,
  258, 259, 266, 267, 268, 269, 270, 269, 278, 281,
  282, 285, 286, 289, 290, 293, 294, 294,
];

export function periodOf(Z: number): number {
  if (Z <= 2) return 1;
  if (Z <= 10) return 2;
  if (Z <= 18) return 3;
  if (Z <= 36) return 4;
  if (Z <= 54) return 5;
  if (Z <= 86) return 6;
  return 7;
}

export function groupOf(Z: number): number {
  const p = periodOf(Z);
  if (p === 1) return Z === 1 ? 1 : 18;
  if (p === 2) return Z <= 4 ? Z - 2 : Z + 8;
  if (p === 3) return Z <= 12 ? Z - 10 : Z + 8;
  if (p === 4) return Z - 18;
  if (p === 5) return Z - 36;
  if (p === 6) return Z <= 56 ? Z - 54 : Z <= 71 ? 3 : Z - 68;
  return Z <= 88 ? Z - 86 : Z <= 103 ? 3 : Z - 100;
}

// s/p/d/f block: the subshell that fills last by the Madelung rule.
export function blockOf(Z: number): string {
  const cfg = electronConfig(Z);
  let best = cfg[0];
  for (const s of cfg) if (s.n + s.l >= best.n + best.l) best = s;
  return 'spdf'[best.l] ?? 's';
}

export function categoryOf(Z: number): string {
  const g = groupOf(Z);
  if (g === 18) return 'noble gas';
  if (Z === 1) return 'nonmetal';
  if (g === 1) return 'alkali metal';
  if (g === 2) return 'alkaline earth';
  if ([9, 17, 35, 53, 85, 117].includes(Z)) return 'halogen';
  if (Z >= 57 && Z <= 71) return 'lanthanide';
  if (Z >= 89 && Z <= 103) return 'actinide';
  if ([5, 14, 32, 33, 51, 52].includes(Z)) return 'metalloid';
  if (g >= 3 && g <= 12) return 'transition metal';
  if ([13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116].includes(Z)) return 'post-transition metal';
  return 'nonmetal';
}

export interface AtomUnit {
  n: number;
  l: number;
  m: number | null;
  ze: number;
}

function mOrder(l: number): number[] {
  const out = [0];
  for (let m = 1; m <= l; m++) out.push(m, -m);
  return out;
}

export function atomUnits(Z: number): AtomUnit[] {
  const units: AtomUnit[] = [];
  for (const s of electronConfig(Z)) {
    const ze = zeff(Z, s.n, s.l);
    if (s.e >= 2 * s.l + 1) units.push({ n: s.n, l: s.l, m: null, ze });
    else for (const m of mOrder(s.l).slice(0, s.e)) units.push({ n: s.n, l: s.l, m, ze });
  }
  return units;
}

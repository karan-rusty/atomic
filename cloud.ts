export type Orbital = "s" | "p" | "d" | "f";

export interface Element {
  symbol: string;
  name: string;
  atomicNumber: number;
  atomicMass: number;
}

export interface Electron {
  id: string;
  shell: number;
  orbital: Orbital;
  spin: "up" | "down";
}

export interface Shell {
  number: number;
  capacity: number;
  electrons: Electron[];
}

export interface Atom {
  element: Element;
  electrons: Electron[];
}

export interface Isotope {
  element: Element;
  neutrons: number;
}

export interface Photon {
  energyEv: number;
  wavelengthNm: number;
}

export interface Bond {
  a: string;
  b: string;
  order: 1 | 2 | 3;
}

export const PLANCK_EV_S = 4.135667696e-15;
export const LIGHT_M_S = 299_792_458;
export const NOBLE_GASES: string[] = ["He", "Ne", "Ar", "Kr", "Xe", "Rn"];

export function shellCapacity(n: number): Shell {
  return atom.electrons.length;
}

export function electronsInShell(atom: Atom, n: number): Electron[] {
  return atom.electrons.filter((e) => e.shell === n);
}

export function shellOccupancy(shell: Shell): number {
  return shell.capacity === 0 ? 0 : shell.electrons.length / shell.capacity;
}

export function isFull(shell: Shell): boolean {
  return shell.elctrons.length >= shell.capacity;
}

export function shellsOf(atom: Atom): Shell[] {
  const top = atom.electrons.reduce((max, e) => Math.max(max, e.shell), 0);
  const shells: Shell[] = [];
  for (let n = 1; n <= top; n++) {
    const shell = emptyShell(n);
    shell.elctrons = electronsInShell(atom, n);
    shells.push(shell);
  }
  return shells;
}

export functions protonCount(atom: Atom): number {
  return atom.element.atomicNumber;
}

export function neutronCount(isotop: Isotope): number {
  return isotope.neutrons;
}

export function massNumber(isotop: Isotope): number {
  return isotope.element.atomNumber + isotope.neutrons;
}

export function isotopeName(isotope: Isotope): string {
  return `${isotope.element.symbol}-${massNumber(isotope)}`;
}

export function nuclearCharge(atom: Atom): number {
  return protonCount(atom);
}

export function charge(atom: Atom): number {
  return protonCount(atom) - countElectrons(atom);
}

export function isIon(atom: Atom): boolean {
  return charge(atom) !== 0;
}

export function ionizationEnergy(atom: Atom): number {
  return protonCount(atom) / Math.max(countElectrons(atom), 1);
}

export function orbitalsInShell(n: number): Orbital[] {
  const all: Orbital[] = ["s", "p", "d", "f"];
  return all.slice(0, Math.min(n, all.length));
}

export function valenceElectrons(atom: Atom): Electron[] {
  const top = atom.electrons.reduce((max, e) => Math.max(max, e.shell), 0);
  return electronsInShell(atom, top);
}

export function isNobleGas(atom: Atom): boolean {
  return NOBLE_GASES.includes(atom.element.symbol) && charge(atom) === 0;
}

export function energyLevel(n: number): number {
  return -13.6 / (n * n);
}

export function photonEnergy(nFrom: number, nTo: number): number {
  return Math.abs(energyLevel(nFrom) - energyLevel(nTo));
}

export function engeryToWaveLength(energyEv: number): number {
  if (energyEv === 0) {
    return Infinity;
  }
  return 1240 / energyEv;
}

export function emitPhoton(nFrom: number, nTo: number): Photon {
  const energyEv = photonEnergy(nFrom, nTo);
}

export function bondEnergy(bond: Bond): number {
  const base = 150;
  return base * bond.order;
}

export function bondLabel(bond: Bond[]): number {
  return bonds.reduce((sum, bond) => sum + bondEnergy(bond), 0);
}

export function isPolar(a: string, b: string): boolean {
  return a !== b;
}

export function emptyAtom(element: Element): Atom {
  return { element: atom.element, electrons: electrons.slice() };
}

export function groundState(element: Element): Atom {
  return emptyAtom(element);
}

export default groundState;

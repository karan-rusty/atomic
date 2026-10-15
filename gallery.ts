import { SYMBOLS } from './atoms.ts';
import { $ } from './scene.ts';
import { atomOrbitals, availableOrbitals, currentZ, params, setAtomOrbitals } from './state.ts';
import { LADDER_NMAX, SPEC_HI, SPEC_LO, drawMini, energyHa, ladderY, measCtxArgs, specX } from './plots.ts';
import { resetTally } from './measure.ts';
import { update } from './sampler.ts';
import { fillSelect, setTriggerLabel } from './selectMenu.ts';
import { toast } from './controls.ts';

export function updateOrbitals(): void {
  setAtomOrbitals(availableOrbitals());
  const names = Object.keys(atomOrbitals);
  if (!names.includes(params.orbital)) params.orbital = names[0];
  if (!names.includes(params.orbital2)) params.orbital2 = names[Math.min(1, names.length - 1)];
  fillSelect($<HTMLSelectElement>('orbital'), names, params.orbital);
  fillSelect($<HTMLSelectElement>('orbital2'), names, params.orbital2);
  buildGallery();
}

export function syncView(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#view button')) {
    const on = b.dataset.v === params.view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  $('orbSection').classList.toggle('hidden', params.view !== 'orbital');
  $('orb2Row').classList.toggle('hidden', !(params.view === 'orbital' && params.superpose));
  $('evolveRow').classList.toggle('hidden', !(params.view === 'orbital' && params.superpose));
}

function highlightGallery(): void {
  for (const cv of document.querySelectorAll<HTMLCanvasElement>('#gallery canvas'))
    cv.classList.toggle('active', params.view === 'orbital' && cv.dataset.orb === params.orbital);
}

function buildGallery(): void {
  const g = $('gallery');
  g.innerHTML = '';
  const Z = currentZ();
  for (const name of Object.keys(atomOrbitals)) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    cv.title = name;
    cv.dataset.orb = name;
    drawMini(cv, atomOrbitals[name], Z);
    cv.addEventListener('click', () => {
      if (params.view !== 'orbital') setView('orbital');
      setOrbital(name);
    });
    g.appendChild(cv);
  }
  highlightGallery();
}

function setElement(sym: string): void {
  params.element = sym;
  elementSel.value = sym;
  setTriggerLabel(elementSel);
  updateOrbitals();
  resetTally();
  update(true);
}
export function stepElement(d: number): void {
  const i = SYMBOLS.indexOf(params.element);
  setElement(SYMBOLS[(i + d + SYMBOLS.length) % SYMBOLS.length]);
}

// Jump to a principal shell (from the energy ladder / a spectral line).
function gotoShell(n: number): void {
  if (params.view !== 'orbital') {
    params.view = 'orbital';
    syncView();
  }
  if (!params.excited && !Object.values(atomOrbitals).some((o) => o.n === n)) {
    params.excited = true;
    excitedInput.checked = true;
    updateOrbitals();
  }
  const wantL = measCtxArgs[1];
  const names = Object.keys(atomOrbitals).filter((k) => atomOrbitals[k].n === n);
  if (!names.length) return;
  const pick = names.find((k) => atomOrbitals[k].l === wantL && atomOrbitals[k].m === 0) ?? names[0];
  setOrbital(pick);
}

export function setView(v: 'atom' | 'orbital'): void {
  params.view = v;
  syncView();
  highlightGallery();
  resetTally();
  update(true);
}
function setOrbital(name: string): void {
  params.orbital = name;
  orbitalSel.value = name;
  setTriggerLabel(orbitalSel);
  highlightGallery();
  resetTally();
  update(true);
}
function setSuperpose(v: boolean): void {
  params.superpose = v;
  superposeInput.checked = v;
  syncView();
  resetTally();
  update(true);
}
export function setExcited(v: boolean): void {
  params.excited = v;
  excitedInput.checked = v;
  updateOrbitals();
  resetTally();
  update(true);
}

const elementSel = $<HTMLSelectElement>('element');
const excitedInput = $<HTMLInputElement>('excited');
const orbitalSel = $<HTMLSelectElement>('orbital');
const superposeInput = $<HTMLInputElement>('superpose');

elementSel.addEventListener('change', () => setElement(elementSel.value));
excitedInput.addEventListener('change', () => setExcited(excitedInput.checked));
for (const b of document.querySelectorAll<HTMLButtonElement>('#view button'))
  b.addEventListener('click', () => setView(b.dataset.v as 'atom' | 'orbital'));
orbitalSel.addEventListener('change', () => setOrbital(orbitalSel.value));
superposeInput.addEventListener('change', () => setSuperpose(superposeInput.checked));

// Clicking the energy ladder / a spectral line jumps to that shell.
$('eladder').addEventListener('click', (e) => {
  const cv = e.currentTarget as HTMLCanvasElement;
  const r = cv.getBoundingClientRect();
  const y = (e.clientY - r.top) * (cv.height / r.height);
  let best = 1,
    bd = Infinity;
  for (let n = 1; n <= LADDER_NMAX; n++) {
    const d = Math.abs(y - ladderY(n, cv.height));
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  gotoShell(best);
});
$('spectrum').addEventListener('click', (e) => {
  const cv = e.currentTarget as HTMLCanvasElement;
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) * (cv.width / r.width);
  const Ze = measCtxArgs[2];
  let bestNi = 0,
    bestNf = 0,
    bd = 8; // px hit radius
  for (let ni = 2; ni <= 6; ni++)
    for (let nf = 1; nf < ni; nf++) {
      const dE = (energyHa(ni, Ze) - energyHa(nf, Ze)) * 27.2114;
      if (dE <= 0) continue;
      const nm = 1239.84 / dE;
      if (nm < SPEC_LO || nm > SPEC_HI) continue;
      const d = Math.abs(x - specX(nm, cv.width));
      if (d < bd) {
        bd = d;
        bestNi = ni;
        bestNf = nf;
      }
    }
  if (bestNi) {
    const nm = 1239.84 / ((energyHa(bestNi, Ze) - energyHa(bestNf, Ze)) * 27.2114);
    toast(`${bestNi}→${bestNf} · ${nm.toFixed(0)} nm`);
    gotoShell(bestNi);
  }
});

import {
  $,
  buildNodals,
  composer,
  controls,
  lastRadius,
  lastSample,
  marker,
  nucleus,
  renderer,
  updatePointSize,
  updateScaleBar,
  viewport,
} from './scene.ts';
import { curA, curZeff, currentZ, nuclearRatio, params } from './state.ts';
import { drawCrossSection } from './plots.ts';
import { drawMeas, measurements, recordMeasurement, takeMeasurement } from './measure.ts';
import { updateInfo } from './panels.ts';
import { applyEvolution, frameCloud, recolour, update } from './sampler.ts';
import { syncHash } from './hash.ts';
import { setTriggerLabel } from './selectMenu.ts';

const orbital2Sel = $<HTMLSelectElement>('orbital2');
const pointsInput = $<HTMLInputElement>('points');
const colourSel = $<HTMLSelectElement>('colour');
const rotInput = $<HTMLInputElement>('rot');
const fitInput = $<HTMLInputElement>('fit');
const measureInput = $<HTMLInputElement>('measure');
const evolveInput = $<HTMLInputElement>('evolve');
const trueScaleInput = $<HTMLInputElement>('truescale');
const nodesInput = $<HTMLInputElement>('nodes');
const measure100 = $<HTMLButtonElement>('measure100');
const unitsSel = $<HTMLSelectElement>('units');
const planeSel = $<HTMLSelectElement>('plane');
// initControlValues() still needs these two; gallery.ts owns the other handles.
const excitedInput = $<HTMLInputElement>('excited');
const superposeInput = $<HTMLInputElement>('superpose');

// --- actions (shared by controls and keyboard) ---
function setColour(mode: typeof params.colour): void {
  params.colour = mode;
  colourSel.value = mode;
  setTriggerLabel(colourSel);
  recolour();
}
export function cycleColour(): void {
  const m: Array<typeof params.colour> = ['phase', 'shell', 'density'];
  setColour(m[(m.indexOf(params.colour) + 1) % m.length]);
}
export function setRotate(v: boolean): void {
  params.autoRotate = v;
  rotInput.checked = v;
  controls.autoRotate = v;
}
export function setFit(v: boolean): void {
  params.fitView = v;
  fitInput.checked = v;
  if (v) frameCloud();
  else updatePointSize();
}
export function setMeasure(v: boolean): void {
  params.measure = v;
  measureInput.checked = v;
  if (!v) marker.visible = false;
  viewport.classList.toggle('measuring', v);
}
export function setEvolve(v: boolean): void {
  params.evolve = v;
  evolveInput.checked = v;
  applyEvolution(lastSample);
  syncHash();
}
function setTrueScale(v: boolean): void {
  params.trueScale = v;
  trueScaleInput.checked = v;
  nucleus.scale.setScalar(lastRadius * (v ? nuclearRatio(currentZ()) : 0.012));
  updateInfo();
  syncHash();
}
function setNodes(v: boolean): void {
  params.nodes = v;
  nodesInput.checked = v;
  buildNodals(curA().n, curA().l, curA().m, curZeff());
  updateInfo();
  syncHash();
}
function takeMany(n: number): void {
  let last: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    last = takeMeasurement();
    recordMeasurement(Math.hypot(last[0], last[1], last[2]));
  }
  marker.position.set(last[0], last[1], last[2]);
  marker.visible = true;
  drawMeas();
  $('log').textContent = `> took ${n} measurements (${measurements.length.toLocaleString()} total)`;
}
export function savePng(): void {
  composer.render();
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = `atomsim-${params.element}-${params.view}.png`;
  a.click();
  $('log').textContent = '> PNG saved';
  toast('PNG saved');
}

// Brief centred feedback; the log line is easy to miss at the bottom of a panel.
let toastTimer = 0;
export function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1600);
}

function copyLink(): void {
  syncHash();
  navigator.clipboard
    ?.writeText(location.href)
    .then(() => {
      $('log').textContent = '> link copied';
      toast('link copied');
    })
    .catch(() => {
      $('log').textContent = '> copy failed';
      toast('copy failed');
    });
}

// --- initial control values ---
// main.ts calls this after applyHash(): imported modules run before the entry point.
export function initControlValues(): void {
  pointsInput.value = String(params.density);
  colourSel.value = params.colour;
  rotInput.checked = params.autoRotate;
  controls.autoRotate = params.autoRotate;
  fitInput.checked = params.fitView;
  excitedInput.checked = params.excited;
  superposeInput.checked = params.superpose;
  measureInput.checked = params.measure;
  viewport.classList.toggle('measuring', params.measure);
  evolveInput.checked = params.evolve;
  trueScaleInput.checked = params.trueScale;
  nodesInput.checked = params.nodes;
  unitsSel.value = params.units;
  setTriggerLabel(unitsSel);
  planeSel.value = params.plane;
  setTriggerLabel(planeSel);
}

// --- listeners ---

orbital2Sel.addEventListener('change', () => {
  params.orbital2 = orbital2Sel.value;
  update(true);
});
pointsInput.addEventListener('change', () => {
  params.density = Number(pointsInput.value);
  update(false);
});
colourSel.addEventListener('change', () => setColour(colourSel.value as typeof params.colour));
rotInput.addEventListener('change', () => setRotate(rotInput.checked));
fitInput.addEventListener('change', () => setFit(fitInput.checked));
measureInput.addEventListener('change', () => setMeasure(measureInput.checked));
evolveInput.addEventListener('change', () => setEvolve(evolveInput.checked));
trueScaleInput.addEventListener('change', () => setTrueScale(trueScaleInput.checked));
nodesInput.addEventListener('change', () => setNodes(nodesInput.checked));
unitsSel.addEventListener('change', () => {
  params.units = unitsSel.value as typeof params.units;
  updateInfo();
  updateScaleBar();
  syncHash();
});
planeSel.addEventListener('change', () => {
  params.plane = planeSel.value as typeof params.plane;
  drawCrossSection();
  syncHash();
});
measure100.addEventListener('click', () => {
  if (params.measure) takeMany(100);
});
$('copylink').addEventListener('click', copyLink);
$('savepng').addEventListener('click', savePng);

// Redraw the plots when the collapsed section is opened (they are skipped while hidden).
const plotsDetails = document.querySelector<HTMLDetailsElement>('#plots');
plotsDetails?.addEventListener('toggle', () => {
  if (plotsDetails.open) updateInfo();
});

renderer.domElement.addEventListener('click', () => {
  if (!params.measure) return;
  const p = takeMeasurement();
  recordMeasurement(Math.hypot(p[0], p[1], p[2]));
  marker.position.set(p[0], p[1], p[2]);
  marker.visible = true;
  drawMeas();
  $('log').textContent = `> measured (${p.map((v) => v.toFixed(2)).join(', ')}) a₀`;
});

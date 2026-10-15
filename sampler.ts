import * as THREE from 'three';
import { atomUnits, zeff } from './atoms.ts';
import {
  $,
  axes,
  buildNodals,
  camera,
  controls,
  densityColor,
  lastCount,
  lastRadius,
  lastSample,
  lastShellN,
  marker,
  material,
  NEG,
  nucleus,
  pointUniforms,
  points,
  POS,
  scene,
  setLastCount,
  setLastDensity,
  setLastRadius,
  setLastSample,
  setLastShellN,
  setPoints,
  SHELL_COLORS,
  updatePointSize,
  updateScaleBar,
  writeColor,
} from './scene.ts';
import { curA, curB, curZeff, currentDensity, currentZ, nuclearRatio, params, percentileRadius } from './state.ts';
import { updateInfo } from './panels.ts';
import { syncHash } from './hash.ts';

export interface SampleResult {
  id: number;
  positions: Float32Array;
  dens: Float32Array;
  signs: Int8Array | null;
  shells: Uint8Array | null;
  psi: Float32Array | null;
  count: number;
}

const worker = new Worker(new URL('./sampler.worker.ts', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map<number, (r: SampleResult) => void>();
worker.onmessage = (e: MessageEvent<SampleResult>) => {
  const resolve = pending.get(e.data.id);
  if (resolve) {
    pending.delete(e.data.id);
    resolve(e.data);
  }
};
function requestSample(req: Record<string, unknown>): Promise<SampleResult> {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...req, id });
  });
}

function colorFor(
  count: number,
  dens: Float32Array,
  signs: Int8Array | null,
  shells: Uint8Array | null,
  shellN: number,
): Float32Array {
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  if (params.colour === 'density') {
    for (let i = 0; i < count; i++) {
      densityColor(dens[i], c);
      writeColor(colors, i, c);
    }
  } else if (params.colour === 'shell' || !signs) {
    if (shells)
      for (let i = 0; i < count; i++) {
        c.copy(SHELL_COLORS[shells[i]]);
        writeColor(colors, i, c);
      }
    else {
      c.copy(SHELL_COLORS[shellN]);
      for (let i = 0; i < count; i++) writeColor(colors, i, c);
    }
  } else {
    for (let i = 0; i < count; i++) {
      c.copy(signs[i] > 0 ? POS : NEG);
      writeColor(colors, i, c);
    }
  }
  return colors;
}

async function rebuild(): Promise<void> {
  const Z = currentZ();
  let req: Record<string, unknown>;
  if (params.view === 'atom') {
    const units = atomUnits(Z);
    const per = Math.max(1000, Math.floor(params.density / units.length));
    req = { mode: 'atom', count: per * units.length, Z, units: units.map((u) => ({ ...u, per })) };
  } else {
    const A = curA(),
      B = curB();
    req = {
      mode: B ? 'super' : 'orbital',
      count: params.density,
      Z: curZeff(),
      Zb: B ? zeff(Z, B.n, B.l) : undefined,
      a: A,
      b: B ?? undefined,
    };
  }

  const res = await requestSample(req);
  if (res.id !== reqId) return; // a newer request superseded this one

  setLastSample(res);
  setLastShellN(curA().n);
  const { positions, dens, signs, shells, count } = res;
  const colors = colorFor(count, dens, signs, shells, lastShellN);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
  }
  const cloud = new THREE.Points(geo, material);
  setPoints(cloud);
  scene.add(cloud);
  applyEvolution(res);

  setLastCount(count);
  setLastRadius(percentileRadius(positions, count, 0.98));
  setLastDensity(currentDensity);

  updatePointSize();
  axes.scale.setScalar(lastRadius * 1.15);
  nucleus.scale.setScalar(lastRadius * (params.trueScale ? nuclearRatio(Z) : 0.012));
  marker.scale.setScalar(lastRadius * 0.02);
  marker.visible = false;
  buildNodals(curA().n, curA().l, curA().m, curZeff());
  updateInfo();
  updateScaleBar();
  syncHash();
}

// Attach/remove the time-evolution attribute from the current cloud. Runs on a
// fresh sample and on the evolve toggle, so the latter needs no resample.
export function applyEvolution(res: SampleResult | null): void {
  const psi = res?.psi ?? null;
  const on = params.superpose && params.evolve && params.view === 'orbital' && !!psi && !!points;
  pointUniforms.uTimeEvo.value = on ? 1 : 0;
  if (!points) return;
  const geo = points.geometry;
  if (on && psi && res) {
    geo.setAttribute('aPsi', new THREE.BufferAttribute(psi, 2));
    let dmax = 1e-30;
    for (let i = 0; i < res.count; i++) {
      const pa = psi[2 * i],
        pb = psi[2 * i + 1];
      const d = 0.5 * (pa * pa + pb * pb) + Math.abs(pa * pb);
      if (d > dmax) dmax = d;
    }
    pointUniforms.uDensMax.value = dmax;
  } else {
    geo.deleteAttribute('aPsi');
  }
}

// Recolour the existing cloud in place (no resample, no new random positions).
export function recolour(): void {
  if (!lastSample || !points) {
    update(false);
    return;
  }
  const colors = colorFor(lastSample.count, lastSample.dens, lastSample.signs, lastSample.shells, lastShellN);
  const attr = points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
  (attr.array as Float32Array).set(colors);
  attr.needsUpdate = true;
  syncHash();
}

// Resample, then optionally re-frame (only on state changes, not density/colour).
// The first cloud is always framed, even with fit view off, so a shared
// "fit=0" link is not absurdly zoomed out on load.
let firstBuild = true;
export function update(reFrame: boolean): void {
  $('log').textContent = '> sampling…';
  rebuild().then(() => {
    if (reFrame && (params.fitView || firstBuild)) frameCloud();
    firstBuild = false;
    $('log').textContent = `> ${lastCount.toLocaleString()} points drawn`;
  });
}

export function frameCloud(): void {
  camera.position
    .set(0.7, 0.45, 0.9)
    .normalize()
    .multiplyScalar(Math.max(3 * lastRadius, 2));
  controls.target.set(0, 0, 0);
  updatePointSize();
  updateScaleBar();
}

import { radial, sampleCloud, sampleShell, sampleSuperposition } from './hydrogen.ts';
import { electronConfig, zeff } from './atoms.ts';
import { $ } from './scene.ts';
import { curA, curB, curZeff, currentZ, fmtLen, params } from './state.ts';
import { measCtxArgs } from './plots.ts';

// Empirical histogram of measured radii over the analytic P(r) shape. The
// analytic curve is only shown in orbital view — atom view is a mix of shells.

export function drawMeas(): void {
  const cv = $<HTMLCanvasElement>('meas');
  const w = cv.clientWidth;
  if (!w) return; // hidden while the plots section is collapsed
  cv.width = w;
  const ctx = cv.getContext('2d')!;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  $('meascount').textContent = measurements.length.toLocaleString();
  const [n, l, Z] = measCtxArgs;
  const rMax = (5 * n * n) / Z;
  const N = 120;
  const bins = new Float32Array(N);
  for (const r of measurements) {
    const i = Math.min(N - 1, Math.max(0, Math.floor((r / rMax) * N)));
    bins[i]++;
  }
  let bmax = 1e-30;
  for (let i = 0; i < N; i++) if (bins[i] > bmax) bmax = bins[i];
  const base = h - 13,
    top = 4,
    plotH = base - top;
  ctx.fillStyle = 'rgba(255,92,158,0.55)';
  const bw = w / N;
  for (let i = 0; i < N; i++) ctx.fillRect(i * bw, base - (bins[i] / bmax) * plotH, bw + 0.5, (bins[i] / bmax) * plotH);
  if (params.view === 'orbital') {
    let pmax = 1e-30;
    const ps: number[] = [];
    for (let i = 0; i <= N; i++) {
      const r = (i / N) * rMax;
      const R = radial(n, l, Z * r);
      const P = r * r * R * R;
      ps.push(P);
      if (P > pmax) pmax = P;
    }
    ctx.strokeStyle = 'rgba(77,184,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * w;
      const y = base - (ps[i] / pmax) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#61727a';
  ctx.font = '10px monospace';
  ctx.fillText('r = 0', 4, h - 2);
  ctx.textAlign = 'right';
  ctx.fillText(fmtLen(rMax, 1), w - 6, h - 2);
  ctx.textAlign = 'left';
}

// ---------- measurement ----------
export const measurements: number[] = [];
const MEAS_MAX = 20000; // cap memory; histogram is stable well before this

export function takeMeasurement(): [number, number, number] {
  const Z = currentZ();
  if (params.view === 'atom') {
    const shells = electronConfig(Z);
    const s = shells[Math.floor(Math.random() * shells.length)];
    const pos = sampleShell(s.n, s.l, zeff(Z, s.n, s.l), 1);
    return [pos[0], pos[1], pos[2]];
  }
  const A = curA(),
    B = curB(),
    Zs = curZeff();
  const c = B ? sampleSuperposition(A, B, 1, Zs, zeff(Z, B.n, B.l)) : sampleCloud(A.n, A.l, A.m, 1, Zs);
  return [c.positions[0], c.positions[1], c.positions[2]];
}

export function recordMeasurement(r: number): void {
  measurements.push(r);
  if (measurements.length > MEAS_MAX) measurements.shift();
}

// Only a change of distribution (element/view/orbital/superpose/excited)
// invalidates the tally; visual toggles must not wipe it.
export function resetTally(): void {
  measurements.length = 0;
}

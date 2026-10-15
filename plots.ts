import * as THREE from 'three';
import { psiAt, radial, type Orbital } from './hydrogen.ts';
import { zeff } from './atoms.ts';
import { $, densityColor, lastDensity, lastRadius } from './scene.ts';
import { fmtLen, params } from './state.ts';

export function drawRPlot(n: number, l: number, Z: number): void {
  const cv = $<HTMLCanvasElement>('rplot');
  const w = cv.clientWidth;
  if (!w) return; // hidden while the plots section is collapsed
  cv.width = w;
  const ctx = cv.getContext('2d')!;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const strip = 13,
    top = 4,
    base = h - strip,
    plotH = base - top;
  const rMax = (5 * n * n) / Z;
  const N = 120;
  let rmax = 1e-30,
    pmax = 1e-30;
  const rs: number[] = [],
    ps: number[] = [];
  for (let i = 0; i <= N; i++) {
    const r = (i / N) * rMax;
    const R = radial(n, l, Z * r);
    const P = r * r * R * R;
    rs.push(R);
    ps.push(P);
    if (Math.abs(R) > rmax) rmax = Math.abs(R);
    if (P > pmax) pmax = P;
  }
  // P(r) filled
  ctx.fillStyle = 'rgba(255,92,158,0.35)';
  for (let i = 0; i < N; i++) {
    const bw = w / N;
    ctx.fillRect(i * bw, base - (ps[i] / pmax) * plotH, bw + 0.5, (ps[i] / pmax) * plotH);
  }
  // R(r) line, signed, centred on zero line (zero line = base - 0.5*plotH)
  const mid = base - 0.5 * plotH;
  ctx.strokeStyle = 'rgba(77,184,255,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * w;
    const y = mid - (rs[i] / rmax) * (0.5 * plotH) * 0.9;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();
  ctx.fillStyle = '#61727a';
  ctx.font = '10px monospace';
  ctx.fillText('R(r)', 4, 12);
  ctx.fillText('r = 0', 4, h - 2);
  ctx.textAlign = 'right';
  ctx.fillText(fmtLen(rMax, 1), w - 6, h - 2);
  ctx.textAlign = 'left';
}

// Empirical histogram of measured radii over the analytic P(r) shape. The
// analytic curve is only shown in orbital view — atom view is a mix of shells.
export let measCtxArgs: [number, number, number] = [1, 0, 1];

// updateInfo() (panels) points the histogram at the state it is drawn for.
export function setMeasCtx(ctx: [number, number, number]): void {
  measCtxArgs = ctx;
}

// E_n in hartree for the current effective charge.
export const energyHa = (n: number, Ze: number) => -(Ze * Ze) / (2 * n * n);

// Level spacing is even by n (real levels crowd toward E=0, which is unreadable).
// Shared so the canvas hit-test and the drawing agree.
export const LADDER_NMAX = 6;
export const ladderY = (n: number, h: number) => 8 + (1 - (n - 1) / (LADDER_NMAX - 1)) * (h - 26);

// Emission spectrum is drawn on a log wavelength axis; shared with its hit-test.
export const SPEC_LO = 80,
  SPEC_HI = 1600; // nm
export const specX = (nm: number, w: number) =>
  ((Math.log(nm) - Math.log(SPEC_LO)) / (Math.log(SPEC_HI) - Math.log(SPEC_LO))) * w;

export function drawEnergyLadder(focusN: number, Ze: number): void {
  const cv = $<HTMLCanvasElement>('eladder');
  const w = cv.clientWidth;
  if (!w) return; // hidden while the plots section is collapsed
  cv.width = w;
  const ctx = cv.getContext('2d')!;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);

  ctx.font = '10px monospace';
  for (let n = 1; n <= LADDER_NMAX; n++) {
    const yy = ladderY(n, h);
    const on = n === focusN;
    ctx.strokeStyle = on ? '#ff5c9e' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(30, yy);
    ctx.lineTo(w - 44, yy);
    ctx.stroke();
    ctx.fillStyle = on ? '#ff5c9e' : '#61727a';
    ctx.fillText(`n=${n}`, 2, yy + 3);
    ctx.textAlign = 'right';
    ctx.fillText(`${(energyHa(n, Ze) * 27.2114).toFixed(1)}`, w - 2, yy + 3);
    ctx.textAlign = 'left';
  }
  // allowed transitions (delta l = +-1) from the focus level, drawn mid-panel
  ctx.strokeStyle = 'rgba(255,92,158,0.5)';
  ctx.setLineDash([3, 3]);
  for (let n = 1; n <= LADDER_NMAX; n++) {
    if (n === focusN) continue;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, ladderY(focusN, h));
    ctx.lineTo(w * 0.5, ladderY(n, h));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function wlToRGB(nm: number): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / 65;
  } else if (nm <= 780) {
    r = 1;
  } else return [0.4, 0.4, 0.4];
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

export function drawSpectrum(focusN: number, Ze: number): void {
  const cv = $<HTMLCanvasElement>('spectrum');
  const w = cv.clientWidth;
  if (!w) return; // hidden while the plots section is collapsed
  cv.width = w;
  const ctx = cv.getContext('2d')!;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  for (let ni = 2; ni <= 6; ni++) {
    for (let nf = 1; nf < ni; nf++) {
      const dE = (energyHa(ni, Ze) - energyHa(nf, Ze)) * 27.2114;
      if (dE <= 0) continue;
      const nm = 1239.84 / dE;
      if (nm < SPEC_LO || nm > SPEC_HI) continue;
      const [r, g, b] = wlToRGB(nm);
      const inv = ni === focusN || nf === focusN;
      ctx.strokeStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${inv ? 1 : 0.55})`;
      ctx.lineWidth = inv ? 2 : 1;
      const x = specX(nm, w);
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, h - 12);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#61727a';
  ctx.font = '10px monospace';
  ctx.fillText('121 nm', 2, h - 2);
  ctx.textAlign = 'right';
  ctx.fillText('1600 nm', w - 2, h - 2);
  ctx.textAlign = 'left';
}

export function drawCrossSection(): void {
  const cv = $<HTMLCanvasElement>('xsec');
  const N = cv.width;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const R = lastRadius * 1.25;
  const c = new THREE.Color();
  let max = 1e-30;
  const vals = new Float32Array(N * N);
  const plane = params.plane;
  $('xsecplane').textContent = plane.toUpperCase();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = ((i / (N - 1)) * 2 - 1) * R;
      const b = (1 - (j / (N - 1)) * 2) * R;
      const d = !lastDensity
        ? 0
        : plane === 'xz'
          ? lastDensity(a, 0, b)
          : plane === 'xy'
            ? lastDensity(a, b, 0)
            : lastDensity(0, a, b);
      vals[j * N + i] = d;
      if (d > max) max = d;
    }
  }
  for (let k = 0; k < N * N; k++) {
    densityColor(Math.sqrt(vals[k] / max), c);
    img.data[4 * k] = c.r * 255;
    img.data[4 * k + 1] = c.g * 255;
    img.data[4 * k + 2] = c.b * 255;
    img.data[4 * k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function drawMini(cv: HTMLCanvasElement, orb: Orbital, Z: number): void {
  const ctx = cv.getContext('2d')!;
  const N = cv.width;
  const img = ctx.createImageData(N, N);
  const ze = zeff(Z, orb.n, orb.l);
  const R = (3 * orb.n * orb.n) / ze;
  const c = new THREE.Color();
  let max = 1e-30;
  const vals = new Float32Array(N * N);
  // Slice through the orbital's brightest azimuth: the m<0 (sin) harmonics
  // vanish on the XZ plane, which would render them solid black.
  const ph = orb.m < 0 ? Math.PI / (2 * Math.abs(orb.m)) : 0;
  const cx = Math.cos(ph),
    cy = Math.sin(ph);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = ((i / (N - 1)) * 2 - 1) * R;
      const z = (1 - (j / (N - 1)) * 2) * R;
      const v = psiAt(orb.n, orb.l, orb.m, ze, a * cx, a * cy, z);
      vals[j * N + i] = v * v;
      if (v * v > max) max = v * v;
    }
  }
  for (let k = 0; k < N * N; k++) {
    densityColor(Math.sqrt(vals[k] / max), c);
    img.data[4 * k] = c.r * 255;
    img.data[4 * k + 1] = c.g * 255;
    img.data[4 * k + 2] = c.b * 255;
    img.data[4 * k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

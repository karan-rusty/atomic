// main.ts — three.js point-cloud renderer wired to the custom AtomSim UI.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {
  mostProbableRadius, nodeRadii, psiAt, radial,
  sampleCloud, sampleShell, sampleSuperposition, subshellOrbitals, type Orbital,
} from './hydrogen.ts';
import { SYMBOLS, electronConfig, elementName, orbitalsForAtom, zeff } from './atoms.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewport = $('viewport');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.2;

const CAM_DIST = 16; // fallback / initial camera distance
camera.position.set(0.7, 0.45, 0.9).normalize().multiplyScalar(CAM_DIST);
controls.target.set(0, 0, 0);

// --- axes + nucleus + measurement marker ---
function makeAxes(): THREE.LineSegments {
  const pos = new Float32Array([-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1]);
  const cols = [[1, 0.42, 0.42], [0.42, 0.85, 0.54], [0.42, 0.66, 1]];
  const col = new Float32Array(18);
  for (let a = 0; a < 3; a++)
    for (let s = 0; s < 2; s++) {
      col[(a * 2 + s) * 3] = cols[a][0];
      col[(a * 2 + s) * 3 + 1] = cols[a][1];
      col[(a * 2 + s) * 3 + 2] = cols[a][2];
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }));
}
const axes = makeAxes();
scene.add(axes);
const nucleus = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfff0f6 }));
scene.add(nucleus);
const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
marker.visible = false;
scene.add(marker);

const sprite = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

const POS = new THREE.Color('#ff5c9e');
const NEG = new THREE.Color('#4db8ff');
const DARK = new THREE.Color('#2a1030');
const WHITE = new THREE.Color('#ffffff');
const SHELL_COLORS = [
  new THREE.Color('#ffffff'), new THREE.Color('#ff5c9e'), new THREE.Color('#ffb14d'),
  new THREE.Color('#e0ff4d'), new THREE.Color('#4db8ff'), new THREE.Color('#b06cff'),
  new THREE.Color('#ff6bb5'), new THREE.Color('#9fb2c8'),
];

function densityColor(t: number, out: THREE.Color): THREE.Color {
  out.copy(DARK).lerp(POS, Math.min(1, t * 1.4));
  if (t > 0.6) out.lerp(WHITE, (t - 0.6) / 0.4);
  return out;
}

const params = {
  element: 'C',
  view: 'atom' as 'atom' | 'orbital',
  orbital: '2p_z',
  superpose: false,
  orbital2: '2p_x',
  density: 100000,
  colour: 'phase' as 'phase' | 'shell' | 'density',
  autoRotate: true,
  fitView: true,
  measure: false,
  excited: false,
};

const POINT_SCALE = 0.008;
const material = new THREE.PointsMaterial({
  size: 1, map: sprite, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});

let points: THREE.Points | null = null;
let lastCount = 0;
let lastRadius = 1;
let lastDensity: ((x: number, y: number, z: number) => number) | null = null;

const Z_of = (symbol: string) => SYMBOLS.indexOf(symbol) + 1;

function availableOrbitals(): Record<string, Orbital> {
  if (!params.excited) return orbitalsForAtom(Z_of(params.element));
  const map: Record<string, Orbital> = {};
  for (let n = 1; n <= 6; n++) for (let l = 0; l < Math.min(n, 4); l++) Object.assign(map, subshellOrbitals(n, l));
  return map;
}
let atomOrbitals = availableOrbitals();

function percentileRadius(pos: Float32Array, count: number, p: number): number {
  const stride = Math.max(1, Math.floor(count / 10000));
  const radii: number[] = [];
  for (let i = 0; i < count; i += stride) radii.push(Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]));
  radii.sort((a, b) => a - b);
  return radii[Math.floor((radii.length - 1) * p)] || 1;
}

const writeColor = (colors: Float32Array, i: number, c: THREE.Color) => {
  colors[3 * i] = c.r; colors[3 * i + 1] = c.g; colors[3 * i + 2] = c.b;
};

// --- current-state helpers ---
function currentZ(): number { return Z_of(params.element); }
function curA(): Orbital { return atomOrbitals[params.orbital]; }
function curB(): Orbital | null { return params.superpose ? atomOrbitals[params.orbital2] : null; }
function curZeff(): number { return zeff(currentZ(), curA().n, curA().l); }

function currentPsi(x: number, y: number, z: number): number {
  const A = curA(), B = curB(), Z = curZeff();
  let v = psiAt(A.n, A.l, A.m, Z, x, y, z);
  if (B) v += psiAt(B.n, B.l, B.m, Z, x, y, z);
  return v;
}
function atomDensity(Z: number, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z);
  let d = 0;
  for (const s of electronConfig(Z)) { const v = radial(s.n, s.l, zeff(Z, s.n, s.l) * r); d += v * v; }
  return d;
}
function currentDensity(x: number, y: number, z: number): number {
  if (params.view === 'atom') return atomDensity(currentZ(), x, y, z);
  const v = currentPsi(x, y, z);
  return v * v;
}

function buildAtomCloud(Z: number): { positions: Float32Array; colors: Float32Array; count: number } {
  const shells = electronConfig(Z);
  const per = Math.max(1000, Math.floor(params.density / shells.length));
  const count = per * shells.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  let off = 0;
  for (const s of shells) {
    const ze = zeff(Z, s.n, s.l);
    positions.set(sampleShell(s.n, s.l, ze, per), off * 3);
    const rmp = mostProbableRadius(s.n, s.l, ze);
    const peak = rmp * rmp * radial(s.n, s.l, ze * rmp) ** 2 || 1;
    for (let i = 0; i < per; i++) {
      if (params.colour === 'density') {
        const x = positions[3 * (off + i)], y = positions[3 * (off + i) + 1], z = positions[3 * (off + i) + 2];
        const r = Math.hypot(x, y, z);
        const v = radial(s.n, s.l, ze * r) ** 2 * r * r;
        densityColor(Math.min(1, Math.sqrt(v / peak)), c);
      } else {
        c.copy(SHELL_COLORS[s.n]);
      }
      writeColor(colors, off + i, c);
    }
    off += per;
  }
  return { positions, colors, count };
}

function buildOrbitalCloud(): { positions: Float32Array; colors: Float32Array; count: number } {
  const A = curA(), B = curB(), Zs = curZeff();
  const { positions, signs } = B
    ? sampleSuperposition(A, B, params.density, Zs)
    : sampleCloud(A.n, A.l, A.m, params.density, Zs);
  const count = signs.length;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();

  if (params.colour === 'density') {
    const vals = new Float32Array(count);
    let max = 1e-30;
    for (let i = 0; i < count; i++) {
      const v = currentPsi(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
      vals[i] = v * v;
      if (vals[i] > max) max = vals[i];
    }
    for (let i = 0; i < count; i++) { densityColor(Math.sqrt(vals[i] / max), c); writeColor(colors, i, c); }
  } else if (params.colour === 'shell') {
    c.copy(SHELL_COLORS[A.n]);
    for (let i = 0; i < count; i++) writeColor(colors, i, c);
  } else {
    for (let i = 0; i < count; i++) { c.copy(signs[i] > 0 ? POS : NEG); writeColor(colors, i, c); }
  }
  return { positions, colors, count };
}

function rebuild(): void {
  const Z = currentZ();
  const built = params.view === 'atom' ? buildAtomCloud(Z) : buildOrbitalCloud();
  const { positions, colors, count } = built;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (points) { scene.remove(points); points.geometry.dispose(); }
  points = new THREE.Points(geo, material);
  scene.add(points);

  lastCount = count;
  lastRadius = percentileRadius(positions, count, 0.98);
  lastDensity = currentDensity;

  updatePointSize();
  axes.scale.setScalar(lastRadius * 1.15);
  nucleus.scale.setScalar(lastRadius * 0.012);
  marker.scale.setScalar(lastRadius * 0.02);
  marker.visible = false;
  updateInfo();
  updateScaleBar();
}

function frameCloud(): void {
  if (!params.fitView) return;
  camera.position.set(0.7, 0.45, 0.9).normalize().multiplyScalar(Math.max(3 * lastRadius, 2));
  controls.target.set(0, 0, 0);
  updatePointSize();
  updateScaleBar();
}

function updatePointSize(): void {
  const dist = camera.position.distanceTo(controls.target) || CAM_DIST;
  const wpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewport.clientHeight;
  material.size = Math.min(8 * wpp, Math.max(1.5 * wpp, lastRadius * POINT_SCALE));
}

// ---------- left-panel plots ----------
const sup = (n: number) => String(n).replace(/[0-9]/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]);

function addProp(key: string, value: string, tag?: string): void {
  const row = document.createElement('div');
  row.className = 'prop';
  row.innerHTML = `<span class="k">${key}</span><span class="v">${value}</span>` +
    (tag ? `<span class="tagcell"><span class="pill tag">${tag}</span></span>` : '');
  $('props').appendChild(row);
}

function drawRPlot(n: number, l: number, Z: number): void {
  const cv = $<HTMLCanvasElement>('rplot');
  cv.width = cv.clientWidth;
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const strip = 13, top = 4, base = h - strip, plotH = base - top;
  const rMax = (5 * n * n) / Z;
  const N = 120;
  let rmax = 1e-30, pmax = 1e-30;
  const rs: number[] = [], ps: number[] = [];
  for (let i = 0; i <= N; i++) {
    const r = (i / N) * rMax;
    const R = radial(n, l, Z * r);
    const P = r * r * R * R;
    rs.push(R); ps.push(P);
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
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  ctx.fillStyle = '#61727a';
  ctx.font = '10px monospace';
  ctx.fillText('R(r)', 4, 12);
  ctx.fillText('r = 0', 4, h - 2);
  ctx.textAlign = 'right';
  ctx.fillText(`${rMax.toFixed(1)} a₀`, w - 6, h - 2);
  ctx.textAlign = 'left';
}

// E_n in hartree for the current effective charge.
const energyHa = (n: number, Ze: number) => -(Ze * Ze) / (2 * n * n);

function drawEnergyLadder(focusN: number, Ze: number): void {
  const cv = $<HTMLCanvasElement>('eladder');
  cv.width = cv.clientWidth;
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const NMAX = 6;
  // Even spacing by n (levels crowd toward E=0 in reality, which is unreadable).
  const y = (n: number) => 8 + (1 - (n - 1) / (NMAX - 1)) * (h - 26);

  ctx.font = '10px monospace';
  for (let n = 1; n <= NMAX; n++) {
    const yy = y(n);
    const on = n === focusN;
    ctx.strokeStyle = on ? '#ff5c9e' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = on ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(30, yy); ctx.lineTo(w - 44, yy); ctx.stroke();
    ctx.fillStyle = on ? '#ff5c9e' : '#61727a';
    ctx.fillText(`n=${n}`, 2, yy + 3);
    ctx.textAlign = 'right';
    ctx.fillText(`${(energyHa(n, Ze) * 27.2114).toFixed(1)}`, w - 2, yy + 3);
    ctx.textAlign = 'left';
  }
  // allowed transitions (delta l = +-1) from the focus level, drawn mid-panel
  ctx.strokeStyle = 'rgba(255,92,158,0.5)';
  ctx.setLineDash([3, 3]);
  for (let n = 1; n <= NMAX; n++) {
    if (n === focusN) continue;
    ctx.beginPath(); ctx.moveTo(w * 0.5, y(focusN)); ctx.lineTo(w * 0.5, y(n)); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function wlToRGB(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  else return [0.4, 0.4, 0.4];
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

function drawSpectrum(focusN: number, Ze: number): void {
  const cv = $<HTMLCanvasElement>('spectrum');
  cv.width = cv.clientWidth;
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const lo = 80, hi = 1600; // nm, log-ish
  const xOf = (nm: number) => ((Math.log(nm) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * w;
  for (let ni = 2; ni <= 6; ni++) {
    for (let nf = 1; nf < ni; nf++) {
      const dE = (energyHa(ni, Ze) - energyHa(nf, Ze)) * 27.2114;
      if (dE <= 0) continue;
      const nm = 1239.84 / dE;
      if (nm < lo || nm > hi) continue;
      const [r, g, b] = wlToRGB(nm);
      const inv = ni === focusN || nf === focusN;
      ctx.strokeStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${inv ? 1 : 0.55})`;
      ctx.lineWidth = inv ? 2 : 1;
      const x = xOf(nm);
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, h - 12); ctx.stroke();
    }
  }
  ctx.fillStyle = '#61727a';
  ctx.font = '10px monospace';
  ctx.fillText('121 nm', 2, h - 2);
  ctx.textAlign = 'right';
  ctx.fillText('1600 nm', w - 2, h - 2);
  ctx.textAlign = 'left';
}

function drawCrossSection(): void {
  const cv = $<HTMLCanvasElement>('xsec');
  const N = cv.width;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const R = lastRadius * 1.25;
  const c = new THREE.Color();
  let max = 1e-30;
  const vals = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i / (N - 1)) * 2 - 1) * R;
      const z = (1 - (j / (N - 1)) * 2) * R;
      const d = lastDensity ? lastDensity(x, 0, z) : 0;
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

function updateInfo(): void {
  const Z = currentZ();
  const sym = params.element;
  const exact = Z === 1;
  const superpose = params.superpose && params.view === 'orbital';
  $('crumb').textContent =
    `${sym} · ${params.view === 'atom' ? 'full atom' : params.orbital + (superpose ? ` + ${params.orbital2}` : '')} · |ψ|² Monte-Carlo`;
  $('stateatom').textContent = `${elementName(Z).toUpperCase()} Z=${Z}`;
  $('exactpill').textContent = exact ? 'EXACT' : 'SCREENED';
  $('drawcount').textContent = `${lastCount.toLocaleString()} draws`;
  $('drawlabel').textContent = `|ψ|² Monte-Carlo · ${lastCount.toLocaleString()} draws`;
  $('props').innerHTML = '';

  if (params.view === 'orbital') {
    const A = curA();
    const Ze = curZeff();
    const lEff = A.l;
    $('statename').textContent = superpose ? `${params.orbital} + ${params.orbital2}` : `${params.orbital} (m = ${A.m})`;
    $('qn').textContent = `n=${A.n}  ℓ=${lEff}  m=${A.m}   Z_eff=${Ze.toFixed(2)}${superpose ? '  (mixed)' : ''}`;
    $('statedesc').textContent = superpose
      ? 'Superposition of two states: |ψ_a + ψ_b|² shows where they reinforce and cancel.'
      : exact
        ? 'Ordinary hydrogen: electron + proton. Shapes are exact.'
        : `${elementName(Z)}: screened hydrogenic orbital (Slater approximation).`;
    const E = energyHa(A.n, Ze);
    addProp('Energy', `${E.toFixed(4)} Ha · ${(E * 27.2114).toFixed(3)} eV`, exact ? 'EXACT' : 'SCREENED');
    const rmean = (3 * A.n * A.n - lEff * (lEff + 1)) / (2 * Ze);
    addProp('⟨r⟩', `${rmean.toFixed(3)} a₀ · ${(rmean * 52.9177).toFixed(1)} pm`, exact ? 'EXACT' : 'SCREENED');
    addProp('|L|', `${Math.sqrt(lEff * (lEff + 1)).toFixed(3)} ℏ`, 'EXACT');
    addProp('⟨1/r⟩', `${(Ze / (A.n * A.n)).toFixed(3)} a₀⁻¹`, exact ? 'EXACT' : 'SCREENED');
    const rmp = mostProbableRadius(A.n, lEff, Ze);
    addProp('most probable r', `${rmp.toFixed(3)} a₀`, 'NUMERICAL');
    const nodes = nodeRadii(A.n, lEff, Ze);
    addProp('nodes', `${A.n - lEff - 1} radial · ${lEff} angular`, 'EXACT');
    if (nodes.length) addProp('node radii', nodes.map((r) => r.toFixed(2)).join(', ') + ' a₀', 'NUMERICAL');
    addProp('Sampled points', lastCount.toLocaleString(), 'MONTE-CARLO');
    $('histpill').textContent = exact ? 'EXACT' : 'SCREENED';
    $('energypill').textContent = exact ? 'EXACT' : 'SCREENED';
    drawRPlot(A.n, lEff, Ze);
    drawEnergyLadder(A.n, Ze);
    drawSpectrum(A.n, Ze);
    $('annot').textContent = `axes ±${(lastRadius * 1.15).toFixed(1)} a₀ · z is the quantization axis · nucleus marker not to scale`;
  } else {
    const cfg = electronConfig(Z);
    const outer = cfg.reduce((a, b) => (b.n > a.n ? b : a), cfg[0]);
    $('statename').textContent = elementName(Z);
    $('qn').textContent = `Z=${Z}  ·  ${cfg.length} occupied subshell${cfg.length > 1 ? 's' : ''}`;
    $('statedesc').textContent = 'Neutral atom: each shell is a screened hydrogenic orbital (Slater). Filled shells are spherical.';
    addProp('Electrons', String(Z), exact ? 'EXACT' : 'APPROX');
    addProp('Configuration', cfg.map((s) => `${s.n}${'spdf'[s.l]}${sup(s.e)}`).join(' '), exact ? 'EXACT' : 'APPROX');
    const Ze = zeff(Z, outer.n, outer.l);
    addProp('valence Z_eff', Ze.toFixed(2), 'SCREENED');
    addProp('Sampled points', lastCount.toLocaleString(), 'MONTE-CARLO');
    $('histpill').textContent = exact ? 'EXACT' : 'SCREENED';
    $('energypill').textContent = exact ? 'EXACT' : 'SCREENED';
    drawRPlot(outer.n, outer.l, Ze);
    drawEnergyLadder(outer.n, Ze);
    drawSpectrum(outer.n, Ze);
    $('annot').textContent = `axes ±${(lastRadius * 1.15).toFixed(1)} a₀ · colour = shell (n) · nucleus marker not to scale`;
  }
  drawCrossSection();
}

// ---------- viewport overlays ----------
const axisDefs: Array<[string, [number, number, number], string]> = [
  ['X', [1, 0, 0], '#ff6b6b'], ['Y', [0, 1, 0], '#6bd88a'], ['Z', [0, 0, 1], '#6ba8ff'],
];
const axisEls = axisDefs.map(([, , color], i) => {
  const el = document.createElement('div');
  el.className = 'axis-label';
  el.style.color = color;
  el.textContent = axisDefs[i][0];
  $('axislabels').appendChild(el);
  return el;
});

const tmpV = new THREE.Vector3();
function updateAxisLabels(): void {
  const L = lastRadius * 1.15;
  axisDefs.forEach(([, dir, ], i) => {
    tmpV.set(dir[0], dir[1], dir[2]).multiplyScalar(L).project(camera);
    axisEls[i].style.left = `${(tmpV.x * 0.5 + 0.5) * viewport.clientWidth}px`;
    axisEls[i].style.top = `${(-tmpV.y * 0.5 + 0.5) * viewport.clientHeight}px`;
    axisEls[i].style.display = tmpV.z < 1 ? 'block' : 'none';
  });
}

function updateScaleBar(): void {
  const dist = camera.position.distanceTo(controls.target) || CAM_DIST;
  const wpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewport.clientHeight;
  const target = 80 * wpp;
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find((v) => v >= target) ?? 100;
  $('scalebar').innerHTML = `<i style="width:${nice / wpp}px"></i>${nice} a₀`;
}

// ---------- measurement ----------
renderer.domElement.addEventListener('click', () => {
  if (!params.measure) return;
  const Z = currentZ();
  let p: [number, number, number];
  if (params.view === 'atom') {
    const shells = electronConfig(Z);
    const s = shells[Math.floor(Math.random() * shells.length)];
    const pos = sampleShell(s.n, s.l, zeff(Z, s.n, s.l), 1);
    p = [pos[0], pos[1], pos[2]];
  } else {
    const A = curA(), B = curB(), Zs = curZeff();
    const c = B ? sampleSuperposition(A, B, 1, Zs) : sampleCloud(A.n, A.l, A.m, 1, Zs);
    p = [c.positions[0], c.positions[1], c.positions[2]];
  }
  marker.position.set(p[0], p[1], p[2]);
  marker.visible = true;
  $('log').textContent = `> measured (${p.map((v) => v.toFixed(2)).join(', ')}) a₀`;
});

// ---------- UI wiring ----------
function fillSelect(sel: HTMLSelectElement, values: string[], current: string): void {
  sel.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  if (values.includes(current)) sel.value = current;
}

function updateOrbitals(): void {
  atomOrbitals = availableOrbitals();
  const names = Object.keys(atomOrbitals);
  if (!names.includes(params.orbital)) params.orbital = names[0];
  if (!names.includes(params.orbital2)) params.orbital2 = names[Math.min(1, names.length - 1)];
  fillSelect($<HTMLSelectElement>('orbital'), names, params.orbital);
  fillSelect($<HTMLSelectElement>('orbital2'), names, params.orbital2);
}

function syncView(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#view button'))
    b.classList.toggle('active', b.dataset.v === params.view);
  $('orbSection').classList.toggle('hidden', params.view !== 'orbital');
  $('orb2Row').classList.toggle('hidden', !(params.view === 'orbital' && params.superpose));
}

fillSelect($<HTMLSelectElement>('element'), SYMBOLS, params.element);
updateOrbitals();
syncView();

$<HTMLSelectElement>('element').addEventListener('change', (e) => {
  params.element = (e.target as HTMLSelectElement).value;
  updateOrbitals(); rebuild(); frameCloud();
});

$<HTMLInputElement>('excited').addEventListener('change', (e) => {
  params.excited = (e.target as HTMLInputElement).checked;
  updateOrbitals(); rebuild(); frameCloud();
});

for (const b of document.querySelectorAll<HTMLButtonElement>('#view button'))
  b.addEventListener('click', () => { params.view = b.dataset.v as 'atom' | 'orbital'; syncView(); rebuild(); frameCloud(); });

$<HTMLSelectElement>('orbital').addEventListener('change', (e) => {
  params.orbital = (e.target as HTMLSelectElement).value; rebuild(); frameCloud();
});
$<HTMLInputElement>('superpose').addEventListener('change', (e) => {
  params.superpose = (e.target as HTMLInputElement).checked; syncView(); rebuild(); frameCloud();
});
$<HTMLSelectElement>('orbital2').addEventListener('change', (e) => {
  params.orbital2 = (e.target as HTMLSelectElement).value; rebuild(); frameCloud();
});

const pointsInput = $<HTMLInputElement>('points');
pointsInput.value = String(params.density);
pointsInput.addEventListener('change', () => { params.density = Number(pointsInput.value); rebuild(); });

const colourSel = $<HTMLSelectElement>('colour');
colourSel.value = params.colour;
colourSel.addEventListener('change', () => { params.colour = colourSel.value as typeof params.colour; rebuild(); });

const rotInput = $<HTMLInputElement>('rot');
rotInput.checked = params.autoRotate;
controls.autoRotate = params.autoRotate;
rotInput.addEventListener('change', () => { controls.autoRotate = rotInput.checked; });

const fitInput = $<HTMLInputElement>('fit');
fitInput.checked = params.fitView;
fitInput.addEventListener('change', () => {
  params.fitView = fitInput.checked;
  if (params.fitView) frameCloud(); else updatePointSize();
});

$<HTMLInputElement>('measure').addEventListener('change', (e) => {
  params.measure = (e.target as HTMLInputElement).checked;
  if (!params.measure) marker.visible = false;
});

addEventListener('resize', () => {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  updatePointSize(); updateScaleBar(); drawCrossSection();
});

renderer.setSize(viewport.clientWidth, viewport.clientHeight);
camera.aspect = viewport.clientWidth / viewport.clientHeight;
camera.updateProjectionMatrix();

rebuild();
frameCloud();

let frames = 0, t0 = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  updateAxisLabels();
  frames++;
  const now = performance.now();
  if (now - t0 >= 500) { $('fps').textContent = `${Math.round((frames * 1000) / (now - t0))} FPS`; frames = 0; t0 = now; }
});

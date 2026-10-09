// main.ts — three.js point-cloud renderer wired to the custom AtomSim UI.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import {
  mostProbableRadius, nodeRadii, psiAt, radial,
  sampleCloud, sampleShell, sampleSuperposition, subshellOrbitals, type Orbital,
} from './hydrogen.ts';
import { SYMBOLS, electronConfig, elementName, orbitalsForAtom, atomUnits, zeff } from './atoms.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewport = $('viewport');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', '3D electron probability cloud');

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
const pointUniforms = {
  uSize: { value: 0.1 },   // world-space point size
  uScale: { value: 800 },  // viewport scaling for size attenuation
  uDist: { value: 16 },    // camera distance, for depth fade
};
const material = new THREE.ShaderMaterial({
  uniforms: pointUniforms,
  vertexShader: `
    attribute vec3 aColor;
    uniform float uSize;
    uniform float uScale;
    uniform float uDist;
    varying vec3 vColor;
    varying float vFade;
    void main() {
      vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * uScale / max(-mv.z, 0.0001);
      vFade = clamp(1.6 - (-mv.z) / max(uDist, 0.0001), 0.22, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vFade;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.0, r) * vFade;
      gl_FragColor = vec4(vColor * a, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.18);
composer.addPass(bloom);
composer.addPass(new OutputPass());

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

interface SampleResult {
  id: number;
  positions: Float32Array;
  dens: Float32Array;
  signs: Int8Array | null;
  shells: Uint8Array | null;
  count: number;
}

const worker = new Worker(new URL('./sampler.worker.ts', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map<number, (r: SampleResult) => void>();
worker.onmessage = (e: MessageEvent<SampleResult>) => {
  const resolve = pending.get(e.data.id);
  if (resolve) { pending.delete(e.data.id); resolve(e.data); }
};
function requestSample(req: Record<string, unknown>): Promise<SampleResult> {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...req, id });
  });
}

function colorFor(count: number, dens: Float32Array, signs: Int8Array | null, shells: Uint8Array | null, shellN: number): Float32Array {
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  if (params.colour === 'density') {
    for (let i = 0; i < count; i++) { densityColor(dens[i], c); writeColor(colors, i, c); }
  } else if (params.colour === 'shell' || !signs) {
    if (shells) for (let i = 0; i < count; i++) { c.copy(SHELL_COLORS[shells[i]]); writeColor(colors, i, c); }
    else { c.copy(SHELL_COLORS[shellN]); for (let i = 0; i < count; i++) writeColor(colors, i, c); }
  } else {
    for (let i = 0; i < count; i++) { c.copy(signs[i] > 0 ? POS : NEG); writeColor(colors, i, c); }
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
    const A = curA(), B = curB();
    req = { mode: B ? 'super' : 'orbital', count: params.density, Z: curZeff(), a: A, b: B ?? undefined };
  }

  const res = await requestSample(req);
  if (res.id !== reqId) return; // a newer request superseded this one

  const { positions, dens, signs, shells, count } = res;
  const colors = colorFor(count, dens, signs, shells, curA().n);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
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
  syncHash();
}

// Resample, then optionally re-frame (only on state changes, not density/colour).
function update(reFrame: boolean): void {
  $('log').textContent = '> sampling…';
  rebuild().then(() => {
    if (reFrame) frameCloud();
    $('log').textContent = `> ${lastCount.toLocaleString()} points drawn`;
  });
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
  const size = Math.min(8 * wpp, Math.max(1.5 * wpp, lastRadius * POINT_SCALE));
  pointUniforms.uSize.value = size;
  pointUniforms.uScale.value =
    (viewport.clientHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
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

function drawMini(cv: HTMLCanvasElement, orb: Orbital, Z: number): void {
  const ctx = cv.getContext('2d')!;
  const N = cv.width;
  const img = ctx.createImageData(N, N);
  const ze = zeff(Z, orb.n, orb.l);
  const R = (3 * orb.n * orb.n) / ze;
  const c = new THREE.Color();
  let max = 1e-30;
  const vals = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i / (N - 1)) * 2 - 1) * R;
      const z = (1 - (j / (N - 1)) * 2) * R;
      const v = psiAt(orb.n, orb.l, orb.m, ze, x, 0, z);
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
    cv.width = cv.height = 44;
    cv.title = name;
    cv.dataset.orb = name;
    drawMini(cv, atomOrbitals[name], Z);
    cv.addEventListener('click', () => { if (params.view !== 'orbital') setView('orbital'); setOrbital(name); });
    g.appendChild(cv);
  }
  highlightGallery();
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
    $('statedesc').textContent = 'Neutral atom: screened hydrogenic orbitals (Slater). Open shells show unpaired lobes (Hund\'s rule); filled shells are spherical.';
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
function applyHash(): void {
  const h = new URLSearchParams(location.hash.slice(1));
  const el = h.get('el'); if (el && SYMBOLS.includes(el)) params.element = el;
  const view = h.get('view'); if (view === 'atom' || view === 'orbital') params.view = view;
  const orb = h.get('orb'); if (orb) params.orbital = orb;
  const orb2 = h.get('orb2'); if (orb2) params.orbital2 = orb2;
  const pts = Number(h.get('pts')); if (pts) params.density = Math.max(10000, Math.min(200000, pts));
  const col = h.get('col'); if (col === 'phase' || col === 'shell' || col === 'density') params.colour = col;
  params.superpose = h.get('sup') === '1';
  params.excited = h.get('exc') === '1';
  params.autoRotate = h.get('rot') !== '0';
  params.fitView = h.get('fit') !== '0';
}

function syncHash(): void {
  const h = new URLSearchParams({
    el: params.element, view: params.view, orb: params.orbital, orb2: params.orbital2,
    pts: String(params.density), col: params.colour,
    sup: params.superpose ? '1' : '0', exc: params.excited ? '1' : '0',
    rot: params.autoRotate ? '1' : '0', fit: params.fitView ? '1' : '0',
  });
  history.replaceState(null, '', '#' + h.toString());
}

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
  buildGallery();
}

function syncView(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#view button')) {
    const on = b.dataset.v === params.view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  $('orbSection').classList.toggle('hidden', params.view !== 'orbital');
  $('orb2Row').classList.toggle('hidden', !(params.view === 'orbital' && params.superpose));
}

applyHash();
fillSelect($<HTMLSelectElement>('element'), SYMBOLS, params.element);
updateOrbitals();
syncView();

const elementSel = $<HTMLSelectElement>('element');
const excitedInput = $<HTMLInputElement>('excited');
const orbitalSel = $<HTMLSelectElement>('orbital');
const superposeInput = $<HTMLInputElement>('superpose');
const orbital2Sel = $<HTMLSelectElement>('orbital2');
const pointsInput = $<HTMLInputElement>('points');
const colourSel = $<HTMLSelectElement>('colour');
const rotInput = $<HTMLInputElement>('rot');
const fitInput = $<HTMLInputElement>('fit');
const measureInput = $<HTMLInputElement>('measure');

// --- actions (shared by controls and keyboard) ---
function setElement(sym: string): void { params.element = sym; elementSel.value = sym; updateOrbitals(); update(true); }
function stepElement(d: number): void { const i = SYMBOLS.indexOf(params.element); setElement(SYMBOLS[(i + d + SYMBOLS.length) % SYMBOLS.length]); }
function setView(v: 'atom' | 'orbital'): void { params.view = v; syncView(); highlightGallery(); update(true); }
function setOrbital(name: string): void { params.orbital = name; orbitalSel.value = name; highlightGallery(); update(true); }
function setSuperpose(v: boolean): void { params.superpose = v; superposeInput.checked = v; syncView(); update(true); }
function setExcited(v: boolean): void { params.excited = v; excitedInput.checked = v; updateOrbitals(); update(true); }
function setColour(mode: typeof params.colour): void { params.colour = mode; colourSel.value = mode; update(false); }
function cycleColour(): void { const m: Array<typeof params.colour> = ['phase', 'shell', 'density']; setColour(m[(m.indexOf(params.colour) + 1) % m.length]); }
function setRotate(v: boolean): void { params.autoRotate = v; rotInput.checked = v; controls.autoRotate = v; }
function setFit(v: boolean): void { params.fitView = v; fitInput.checked = v; if (v) frameCloud(); else updatePointSize(); }
function setMeasure(v: boolean): void { params.measure = v; measureInput.checked = v; if (!v) marker.visible = false; }
function savePng(): void {
  composer.render();
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = `atomsim-${params.element}-${params.view}.png`;
  a.click();
  $('log').textContent = '> PNG saved';
}
function copyLink(): void {
  syncHash();
  navigator.clipboard?.writeText(location.href)
    .then(() => { $('log').textContent = '> link copied'; })
    .catch(() => { $('log').textContent = '> copy failed'; });
}

// --- initial control values ---
pointsInput.value = String(params.density);
colourSel.value = params.colour;
rotInput.checked = params.autoRotate;
controls.autoRotate = params.autoRotate;
fitInput.checked = params.fitView;
excitedInput.checked = params.excited;
superposeInput.checked = params.superpose;
measureInput.checked = params.measure;

// --- listeners ---
elementSel.addEventListener('change', () => setElement(elementSel.value));
excitedInput.addEventListener('change', () => setExcited(excitedInput.checked));
for (const b of document.querySelectorAll<HTMLButtonElement>('#view button'))
  b.addEventListener('click', () => setView(b.dataset.v as 'atom' | 'orbital'));
orbitalSel.addEventListener('change', () => setOrbital(orbitalSel.value));
superposeInput.addEventListener('change', () => setSuperpose(superposeInput.checked));
orbital2Sel.addEventListener('change', () => { params.orbital2 = orbital2Sel.value; update(true); });
pointsInput.addEventListener('change', () => { params.density = Number(pointsInput.value); update(false); });
colourSel.addEventListener('change', () => setColour(colourSel.value as typeof params.colour));
rotInput.addEventListener('change', () => setRotate(rotInput.checked));
fitInput.addEventListener('change', () => setFit(fitInput.checked));
measureInput.addEventListener('change', () => setMeasure(measureInput.checked));
$('copylink').addEventListener('click', copyLink);
$('savepng').addEventListener('click', savePng);

// --- keyboard shortcuts ---
addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'SELECT' || tag === 'INPUT') return;
  switch (e.key) {
    case 'v': setView(params.view === 'atom' ? 'orbital' : 'atom'); break;
    case 'r': setRotate(!params.autoRotate); break;
    case 'f': setFit(!params.fitView); break;
    case 'c': cycleColour(); break;
    case 'e': setExcited(!params.excited); break;
    case 'm': setMeasure(!params.measure); break;
    case 's': savePng(); break;
    case '[': stepElement(-1); break;
    case ']': stepElement(1); break;
    case 'Escape': marker.visible = false; break;
  }
});

addEventListener('resize', () => {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  updatePointSize(); updateScaleBar(); drawCrossSection();
});

renderer.setSize(viewport.clientWidth, viewport.clientHeight);
composer.setSize(viewport.clientWidth, viewport.clientHeight);
camera.aspect = viewport.clientWidth / viewport.clientHeight;
camera.updateProjectionMatrix();

update(true);

let frames = 0, t0 = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  pointUniforms.uDist.value = camera.position.distanceTo(controls.target) || CAM_DIST;
  composer.render();
  updateAxisLabels();
  frames++;
  const now = performance.now();
  if (now - t0 >= 500) { $('fps').textContent = `${Math.round((frames * 1000) / (now - t0))} FPS`; frames = 0; t0 = now; }
});

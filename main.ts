// main.ts — three.js point-cloud renderer wired to the custom AtomSim UI.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { radial, sampleCloud, sampleShell } from './hydrogen.ts';
import { SYMBOLS, electronConfig, elementName, orbitalsForAtom, zeff } from './atoms.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewport = $('viewport');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping; // keep the dense core from blowing out
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.2;

// --- axes + nucleus marker ---
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
const nucleus = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff0f6 }),
);
scene.add(nucleus);

// Soft round sprite so points glow instead of showing as squares.
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

const POS = new THREE.Color('#ff5c9e'); // +psi (pink)
const NEG = new THREE.Color('#4db8ff'); // -psi
const NEUTRAL = new THREE.Color('#d9a6c4');
const SHELL_COLORS = [
  new THREE.Color('#ffffff'), new THREE.Color('#ff5c9e'), new THREE.Color('#ffb14d'),
  new THREE.Color('#e0ff4d'), new THREE.Color('#4db8ff'), new THREE.Color('#b06cff'),
  new THREE.Color('#ff6bb5'), new THREE.Color('#9fb2c8'),
];

const params = {
  element: 'C',
  view: 'atom' as 'atom' | 'orbital',
  orbital: '2p_z',
  density: 100000,
  pointSize: 0.03,
  phaseColor: true,
  autoRotate: true,
};

const material = new THREE.PointsMaterial({
  size: params.pointSize,
  map: sprite,
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});

let points: THREE.Points | null = null;
let lastCount = 0;
let lastRadius = 1;

const Z_of = (symbol: string) => SYMBOLS.indexOf(symbol) + 1;
let atomOrbitals = orbitalsForAtom(Z_of(params.element));

// 98th-percentile radius, so the camera frames the cloud regardless of Z.
function percentileRadius(pos: Float32Array, count: number, p: number): number {
  const stride = Math.max(1, Math.floor(count / 10000));
  const radii: number[] = [];
  for (let i = 0; i < count; i += stride) {
    radii.push(Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]));
  }
  radii.sort((a, b) => a - b);
  return radii[Math.floor((radii.length - 1) * p)] || 1;
}

// All occupied subshells of a neutral atom, each screened by its own Zeff.
function buildAtomCloud(Z: number): { positions: Float32Array; colors: Float32Array; count: number } {
  const shells = electronConfig(Z);
  const per = Math.max(1000, Math.floor(params.density / shells.length));
  const count = per * shells.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  let off = 0;
  for (const s of shells) {
    positions.set(sampleShell(s.n, s.l, zeff(Z, s.n, s.l), per), off * 3);
    c.copy(SHELL_COLORS[s.n]);
    for (let i = off * 3; i < (off + per) * 3; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    off += per;
  }
  return { positions, colors, count };
}

function buildOrbitalCloud(Z: number): { positions: Float32Array; colors: Float32Array; count: number } {
  const { n, l, m } = atomOrbitals[params.orbital];
  const { positions, signs } = sampleCloud(n, l, m, params.density, zeff(Z, n, l));
  const colors = new Float32Array(signs.length * 3);
  const c = new THREE.Color();
  for (let i = 0; i < signs.length; i++) {
    c.copy(params.phaseColor ? (signs[i] > 0 ? POS : NEG) : NEUTRAL);
    colors[3 * i] = c.r;
    colors[3 * i + 1] = c.g;
    colors[3 * i + 2] = c.b;
  }
  return { positions, colors, count: signs.length };
}

function rebuild(reframe: boolean): void {
  const Z = Z_of(params.element);
  const { positions, colors, count } =
    params.view === 'atom' ? buildAtomCloud(Z) : buildOrbitalCloud(Z);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
  }
  points = new THREE.Points(geo, material);
  scene.add(points);

  lastCount = count;
  lastRadius = percentileRadius(positions, count, 0.98);

  axes.scale.setScalar(lastRadius * 1.15);
  nucleus.scale.setScalar(lastRadius * 0.012);

  if (reframe) {
    const d = 3 * lastRadius;
    camera.position.set(0.7, 0.45, 0.9).normalize().multiplyScalar(Math.max(d, 2));
    controls.target.set(0, 0, 0);
  }
  updateInfo();
}

const sup = (n: number) => String(n).replace(/[0-9]/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]);

function addProp(key: string, value: string, tag?: string): void {
  const row = document.createElement('div');
  row.className = 'prop';
  row.innerHTML = `<span class="k">${key}</span><span class="v">${value}</span>` +
    (tag ? `<span class="tagcell"><span class="pill tag">${tag}</span></span>` : '');
  $('props').appendChild(row);
}

function drawHist(n: number, l: number, Z: number): void {
  const cv = $<HTMLCanvasElement>('hist');
  cv.width = cv.clientWidth;
  const ctx = cv.getContext('2d')!;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const rMax = (4 * n * n) / Z;
  const bars = 48;
  const vals: number[] = [];
  let max = 0;
  for (let i = 0; i < bars; i++) {
    const r = ((i + 0.5) / bars) * rMax;
    const v = r * r * radial(n, l, Z * r) ** 2; // scaled to charge Z
    vals.push(v);
    if (v > max) max = v;
  }
  const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const bh = (vals[i] / max) * (h - 10);
    ctx.fillStyle = `rgba(255,92,158,${0.3 + 0.6 * (vals[i] / max)})`;
    ctx.fillRect(i * bw + 1, h - 7 - bh, bw - 2, bh);
  }
  ctx.fillStyle = 'rgba(255,255,255,.15)';
  ctx.fillRect(0, h - 7, w, 1);
  ctx.fillStyle = '#61727a';
  ctx.font = '10px monospace';
  ctx.fillText('r = 0', 4, h - 0.5);
  ctx.textAlign = 'right';
  ctx.fillText(`${rMax.toFixed(1)} a₀`, w - 6, h - 0.5);
  ctx.textAlign = 'left';
}

function updateInfo(): void {
  const Z = Z_of(params.element);
  const sym = params.element;
  const exact = Z === 1;
  $('crumb').textContent = `${sym} · ${params.view === 'atom' ? 'full atom' : params.orbital} · |ψ|² Monte-Carlo`;
  $('stateatom').textContent = `${elementName(Z).toUpperCase()} Z=${Z}`;
  $('exactpill').textContent = exact ? 'EXACT' : 'SCREENED';
  $('drawcount').textContent = `${lastCount.toLocaleString()} draws`;
  $('drawlabel').textContent = `|ψ|² Monte-Carlo · ${lastCount.toLocaleString()} draws`;
  $('log').textContent = `> ${lastCount.toLocaleString()} points drawn`;
  $('props').innerHTML = '';

  if (params.view === 'orbital') {
    const { n, l, m } = atomOrbitals[params.orbital];
    const ze = zeff(Z, n, l);
    $('statename').textContent = `${params.orbital} (m = ${m})`;
    $('qn').textContent = `n=${n}  ℓ=${l}  m=${m}   Z_eff=${ze.toFixed(2)}`;
    $('statedesc').textContent = exact
      ? 'Ordinary hydrogen: electron + proton. Shapes are exact.'
      : `${elementName(Z)}: screened hydrogenic orbital (Slater approximation).`;
    const E = (-ze * ze) / (2 * n * n);
    addProp('Energy', `${E.toFixed(4)} Ha · ${(E * 27.2114).toFixed(3)} eV`, exact ? 'EXACT' : 'SCREENED');
    const rmean = (3 * n * n - l * (l + 1)) / (2 * ze);
    addProp('⟨r⟩', `${rmean.toFixed(3)} a₀ · ${(rmean * 52.9177).toFixed(1)} pm`, exact ? 'EXACT' : 'SCREENED');
    addProp('Nodes', `${n - l - 1} radial · ${l} angular`, 'EXACT');
    addProp('Sampled points', lastCount.toLocaleString(), 'MONTE-CARLO');
    $('histpill').textContent = exact ? 'EXACT' : 'SCREENED';
    drawHist(n, l, ze);
    $('annot').textContent = `axes ±${(lastRadius * 1.15).toFixed(1)} a₀ · z is the quantization axis · nucleus marker not to scale`;
  } else {
    const cfg = electronConfig(Z);
    const outer = cfg.reduce((a, b) => (b.n > a.n ? b : a), cfg[0]);
    $('statename').textContent = elementName(Z);
    $('qn').textContent = `Z=${Z}  ·  ${cfg.length} occupied subshell${cfg.length > 1 ? 's' : ''}`;
    $('statedesc').textContent =
      'Neutral atom: each shell is a screened hydrogenic orbital (Slater). Filled shells are spherical.';
    addProp('Electrons', String(Z), exact ? 'EXACT' : 'APPROX');
    addProp('Configuration', cfg.map((s) => `${s.n}${'spdf'[s.l]}${sup(s.e)}`).join(' '), exact ? 'EXACT' : 'APPROX');
    addProp('Sampled points', lastCount.toLocaleString(), 'MONTE-CARLO');
    $('histpill').textContent = exact ? 'EXACT' : 'SCREENED';
    drawHist(outer.n, outer.l, zeff(Z, outer.n, outer.l));
    $('annot').textContent = `axes ±${(lastRadius * 1.15).toFixed(1)} a₀ · colour = shell (n) · nucleus marker not to scale`;
  }
}

// --- UI wiring ---
function fillSelect(sel: HTMLSelectElement, values: string[], current: string): void {
  sel.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  }
  if (values.includes(current)) sel.value = current;
}

function updateOrbitals(): void {
  atomOrbitals = orbitalsForAtom(Z_of(params.element));
  const names = Object.keys(atomOrbitals);
  if (!names.includes(params.orbital)) params.orbital = names[0];
  fillSelect($<HTMLSelectElement>('orbital'), names, params.orbital);
}

function syncView(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#view button')) {
    b.classList.toggle('active', b.dataset.v === params.view);
  }
  $('orbSection').classList.toggle('hidden', params.view !== 'orbital');
  $('phaseRow').classList.toggle('hidden', params.view !== 'orbital');
}

fillSelect($<HTMLSelectElement>('element'), SYMBOLS, params.element);
updateOrbitals();
syncView();

const elementSel = $<HTMLSelectElement>('element');
elementSel.addEventListener('change', () => {
  params.element = elementSel.value;
  updateOrbitals();
  rebuild(true);
});

for (const b of document.querySelectorAll<HTMLButtonElement>('#view button')) {
  b.addEventListener('click', () => {
    params.view = b.dataset.v as 'atom' | 'orbital';
    syncView();
    rebuild(true);
  });
}

const orbSel = $<HTMLSelectElement>('orbital');
orbSel.addEventListener('change', () => {
  params.orbital = orbSel.value;
  rebuild(true);
});

const pointsInput = $<HTMLInputElement>('points');
pointsInput.value = String(params.density);
pointsInput.addEventListener('change', () => {
  params.density = Number(pointsInput.value);
  rebuild(false);
});

const phaseInput = $<HTMLInputElement>('phase');
phaseInput.checked = params.phaseColor;
phaseInput.addEventListener('change', () => {
  params.phaseColor = phaseInput.checked;
  if (params.view === 'orbital') rebuild(false);
});

const rotInput = $<HTMLInputElement>('rot');
rotInput.checked = params.autoRotate;
controls.autoRotate = params.autoRotate;
rotInput.addEventListener('change', () => {
  controls.autoRotate = rotInput.checked;
});

addEventListener('resize', () => {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

const sizeToViewport = () => renderer.setSize(viewport.clientWidth, viewport.clientHeight);
sizeToViewport();
camera.aspect = viewport.clientWidth / viewport.clientHeight;
camera.updateProjectionMatrix();

rebuild(true);

let frames = 0;
let t0 = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - t0 >= 500) {
    $('fps').textContent = `${Math.round((frames * 1000) / (now - t0))} FPS`;
    frames = 0;
    t0 = now;
  }
});

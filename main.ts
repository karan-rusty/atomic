// main.ts — three.js point-cloud renderer wired to the custom AtomSim UI.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import {
  angularNodeCones,
  angularNodePlanes,
  mostProbableRadius,
  nodeRadii,
  psiAt,
  radial,
  sampleCloud,
  sampleShell,
  sampleSuperposition,
  subshellOrbitals,
  type Orbital,
} from './hydrogen.ts';
import {
  SYMBOLS,
  electronConfig,
  elementName,
  orbitalsForAtom,
  atomUnits,
  zeff,
  ATOMIC_MASS,
  periodOf,
  groupOf,
  blockOf,
  categoryOf,
} from './atoms.ts';

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
  const cols = [
    [1, 0.42, 0.42],
    [0.42, 0.85, 0.54],
    [0.42, 0.66, 1],
  ];
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
  return new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }),
  );
}
const axes = makeAxes();
scene.add(axes);
const nucleus = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfff0f6 }));
scene.add(nucleus);
const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
marker.visible = false;
scene.add(marker);

const nodals = new THREE.Group();
scene.add(nodals);
const NODAL_MAT = new THREE.MeshBasicMaterial({ color: 0x9fb2c8, wireframe: true, transparent: true, opacity: 0.16 });
function clearNodals(): void {
  for (const c of [...nodals.children]) {
    (c as THREE.Mesh).geometry.dispose();
    nodals.remove(c);
  }
}
// Radial nodes are spheres; angular nodes are planes through z (m != 0) and
// double cones (zeros of P_l^|m|). Drawn only for a single orbital state.
function buildNodals(n: number, l: number, m: number, Z: number): void {
  clearNodals();
  if (!params.nodes || params.view !== 'orbital') return;
  const R = lastRadius * 1.25;
  for (const r of nodeRadii(n, l, Z)) nodals.add(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), NODAL_MAT));
  for (const phi of angularNodePlanes(l, m)) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), NODAL_MAT);
    // PlaneGeometry normal is +z; aim it along the plane normal (-sin, cos, 0).
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-Math.sin(phi), Math.cos(phi), 0));
    nodals.add(mesh);
  }
  for (const theta of angularNodeCones(l, m)) {
    // The Legendre zeros are symmetric about pi/2; draw each surface once.
    if (theta > Math.PI / 2 + 1e-6) continue;
    if (Math.abs(Math.cos(theta)) < 1e-6) {
      // Equatorial node (e.g. p_z): a flat disk in the xy-plane.
      nodals.add(new THREE.Mesh(new THREE.CircleGeometry(R, 48), NODAL_MAT));
      continue;
    }
    const hgt = R * Math.cos(theta),
      rad = R * Math.sin(theta);
    const g = new THREE.ConeGeometry(rad, hgt, 32, 1, true);
    g.rotateX(-Math.PI / 2); // axis +y -> -z
    g.translate(0, 0, hgt / 2); // apex -> origin, opens toward +z
    nodals.add(new THREE.Mesh(g, NODAL_MAT));
    const g2 = g.clone().scale(1, 1, -1);
    nodals.add(new THREE.Mesh(g2, NODAL_MAT));
  }
}

const POS = new THREE.Color('#ff5c9e');
const NEG = new THREE.Color('#4db8ff');
const DARK = new THREE.Color('#2a1030');
const WHITE = new THREE.Color('#ffffff');
const SHELL_COLORS = [
  new THREE.Color('#ffffff'),
  new THREE.Color('#ff5c9e'),
  new THREE.Color('#ffb14d'),
  new THREE.Color('#e0ff4d'),
  new THREE.Color('#4db8ff'),
  new THREE.Color('#b06cff'),
  new THREE.Color('#ff6bb5'),
  new THREE.Color('#9fb2c8'),
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
  evolve: false,
  density: 100000,
  colour: 'phase' as 'phase' | 'shell' | 'density',
  units: 'a0' as 'a0' | 'pm' | 'ang',
  plane: 'xz' as 'xz' | 'xy' | 'yz',
  autoRotate: true,
  fitView: true,
  measure: false,
  trueScale: false,
  nodes: false,
  excited: false,
};

const POINT_SCALE = 0.008;
const pointUniforms = {
  uSize: { value: 0.1 }, // world-space point size
  uScale: { value: 800 }, // viewport scaling for size attenuation
  uDist: { value: 16 }, // camera distance, for depth fade
  uCos: { value: 1 }, // cos(ΔE·t) for time evolution
  uTimeEvo: { value: 0 }, // 1 = colour by instantaneous |ψ(t)|²
  uDensMax: { value: 1 },
};
const material = new THREE.ShaderMaterial({
  uniforms: pointUniforms,
  vertexShader: `
    attribute vec3 aColor;
    attribute vec2 aPsi;
    uniform float uSize;
    uniform float uScale;
    uniform float uDist;
    varying vec3 vColor;
    varying float vFade;
    varying vec2 vPsi;
    void main() {
      vColor = aColor;
      vPsi = aPsi;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * uScale / max(-mv.z, 0.0001);
      vFade = clamp(1.6 - (-mv.z) / max(uDist, 0.0001), 0.22, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uCos;
    uniform float uTimeEvo;
    uniform float uDensMax;
    varying vec3 vColor;
    varying float vFade;
    varying vec2 vPsi;
    vec3 densityColor(float t) {
      vec3 dark = vec3(0.10, 0.03, 0.12);
      vec3 pos = vec3(1.0, 0.30, 0.62);
      vec3 c = mix(dark, pos, clamp(t * 1.4, 0.0, 1.0));
      return mix(c, vec3(1.0), clamp((t - 0.6) / 0.4, 0.0, 1.0));
    }
    void main() {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5) discard;
      vec3 col = vColor;
      if (uTimeEvo > 0.5) {
        // |ψ(t)|² = ½(|a|²+|b|²) + ab·cos(ΔE t)
        float d = 0.5 * (vPsi.x * vPsi.x + vPsi.y * vPsi.y) + vPsi.x * vPsi.y * uCos;
        col = densityColor(sqrt(max(d, 0.0) / uDensMax));
      }
      float a = smoothstep(0.5, 0.0, r) * vFade;
      gl_FragColor = vec4(col * a, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.4, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let points: THREE.Points | null = null;
let lastCount = 0;
let lastRadius = 1;
let lastDensity: ((x: number, y: number, z: number) => number) | null = null;
// Last worker result, so visual-only changes (colour, nodes, evolve, true scale)
// recolour/update in place instead of resampling the cloud.
let lastSample: SampleResult | null = null;
let lastShellN = 1;

const Z_of = (symbol: string) => SYMBOLS.indexOf(symbol) + 1;

// Physical nucleus radius as a fraction of the cloud radius (a0 = 52.9177 pm):
// r_nuc = 1.2 fm * A^(1/3), A ~ 2Z. ~3e-5, so at true scale it vanishes.
const nuclearRatio = (Z: number) => (1.2e-15 * Math.cbrt(2 * Z)) / 52.9177e-12;

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
  colors[3 * i] = c.r;
  colors[3 * i + 1] = c.g;
  colors[3 * i + 2] = c.b;
};

// --- current-state helpers ---
function currentZ(): number {
  return Z_of(params.element);
}
function curA(): Orbital {
  return atomOrbitals[params.orbital];
}
function curB(): Orbital | null {
  return params.superpose ? atomOrbitals[params.orbital2] : null;
}
function curZeff(): number {
  return zeff(currentZ(), curA().n, curA().l);
}

function currentPsi(x: number, y: number, z: number): number {
  const A = curA(),
    B = curB();
  let v = psiAt(A.n, A.l, A.m, curZeff(), x, y, z);
  if (B) v += psiAt(B.n, B.l, B.m, zeff(currentZ(), B.n, B.l), x, y, z);
  return v;
}
function atomDensity(Z: number, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z);
  let d = 0;
  for (const s of electronConfig(Z)) {
    const v = radial(s.n, s.l, zeff(Z, s.n, s.l) * r);
    d += v * v;
  }
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

  lastSample = res;
  lastShellN = curA().n;
  const { positions, dens, signs, shells, count } = res;
  const colors = colorFor(count, dens, signs, shells, lastShellN);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
  }
  points = new THREE.Points(geo, material);
  scene.add(points);
  applyEvolution(res);

  lastCount = count;
  lastRadius = percentileRadius(positions, count, 0.98);
  lastDensity = currentDensity;

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
function applyEvolution(res: SampleResult | null): void {
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
function recolour(): void {
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
function update(reFrame: boolean): void {
  $('log').textContent = '> sampling…';
  rebuild().then(() => {
    if (reFrame && (params.fitView || firstBuild)) frameCloud();
    firstBuild = false;
    $('log').textContent = `> ${lastCount.toLocaleString()} points drawn`;
  });
}

function frameCloud(): void {
  camera.position
    .set(0.7, 0.45, 0.9)
    .normalize()
    .multiplyScalar(Math.max(3 * lastRadius, 2));
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

// Length units for the readouts (all stored internally in a₀ = bohr).
const LEN_UNITS = {
  a0: { f: 1, label: 'a₀', d: 3 },
  pm: { f: 52.9177, label: 'pm', d: 1 },
  ang: { f: 0.529177, label: 'Å', d: 2 },
};
function fmtLen(a0: number, d?: number): string {
  const u = LEN_UNITS[params.units];
  return `${(a0 * u.f).toFixed(d ?? u.d)} ${u.label}`;
}

function addProp(key: string, value: string, tag?: string): void {
  const row = document.createElement('div');
  row.className = 'prop';
  row.innerHTML =
    `<span class="k">${key}</span><span class="v">${value}</span>` +
    (tag ? `<span class="tagcell"><span class="pill tag">${tag}</span></span>` : '');
  $('props').appendChild(row);
}

function drawRPlot(n: number, l: number, Z: number): void {
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
let measCtxArgs: [number, number, number] = [1, 0, 1];
function drawMeas(): void {
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

// E_n in hartree for the current effective charge.
const energyHa = (n: number, Ze: number) => -(Ze * Ze) / (2 * n * n);

// Level spacing is even by n (real levels crowd toward E=0, which is unreadable).
// Shared so the canvas hit-test and the drawing agree.
const LADDER_NMAX = 6;
const ladderY = (n: number, h: number) => 8 + (1 - (n - 1) / (LADDER_NMAX - 1)) * (h - 26);

// Emission spectrum is drawn on a log wavelength axis; shared with its hit-test.
const SPEC_LO = 80,
  SPEC_HI = 1600; // nm
const specX = (nm: number, w: number) =>
  ((Math.log(nm) - Math.log(SPEC_LO)) / (Math.log(SPEC_HI) - Math.log(SPEC_LO))) * w;

function drawEnergyLadder(focusN: number, Ze: number): void {
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

function drawSpectrum(focusN: number, Ze: number): void {
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

function drawCrossSection(): void {
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

function drawMini(cv: HTMLCanvasElement, orb: Orbital, Z: number): void {
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

function nucleusNote(): string {
  // At true scale the marker is sub-pixel; the number is the point.
  if (!params.trueScale) return 'nucleus marker not to scale';
  const ratio = nuclearRatio(currentZ());
  const cm = 1 / ratio / 100; // cloud width in metres if the nucleus were 1 cm
  return `nucleus at true scale (1:${Math.round(1 / ratio).toLocaleString()}) · if the nucleus were 1 cm, this cloud would span ~${Math.round(cm)} m`;
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
    $('statename').textContent = superpose
      ? `${params.orbital} + ${params.orbital2}`
      : `${params.orbital} (m = ${A.m})`;
    $('qn').textContent = `n=${A.n}  ℓ=${lEff}  m=${A.m}   Z_eff=${Ze.toFixed(2)}${superpose ? '  (mixed)' : ''}`;
    $('statedesc').textContent = superpose
      ? params.evolve
        ? 'Time-evolving superposition: |ψ(t)|² oscillates at the beat frequency (slowed to a visible rate).'
        : 'Superposition of two states: |ψ_a + ψ_b|² shows where they reinforce and cancel.'
      : exact
        ? 'Ordinary hydrogen: electron + proton. Shapes are exact.'
        : `${elementName(Z)}: screened hydrogenic orbital (Slater approximation).`;
    const E = energyHa(A.n, Ze);
    addProp('Energy', `${E.toFixed(4)} Ha · ${(E * 27.2114).toFixed(3)} eV`, exact ? 'EXACT' : 'SCREENED');
    const rmean = (3 * A.n * A.n - lEff * (lEff + 1)) / (2 * Ze);
    addProp('⟨r⟩', fmtLen(rmean), exact ? 'EXACT' : 'SCREENED');
    addProp('|L|', `${Math.sqrt(lEff * (lEff + 1)).toFixed(3)} ℏ`, 'EXACT');
    addProp('⟨1/r⟩', `${(Ze / (A.n * A.n)).toFixed(3)} a₀⁻¹`, exact ? 'EXACT' : 'SCREENED');
    const rmp = mostProbableRadius(A.n, lEff, Ze);
    addProp('most probable r', fmtLen(rmp), 'NUMERICAL');
    const nodes = nodeRadii(A.n, lEff, Ze);
    addProp('nodes', `${A.n - lEff - 1} radial · ${lEff} angular`, 'EXACT');
    if (nodes.length) addProp('node radii', nodes.map((r) => fmtLen(r, 2)).join(', '), 'NUMERICAL');
    addProp('Sampled points', lastCount.toLocaleString(), 'MONTE-CARLO');
    $('histpill').textContent = exact ? 'EXACT' : 'SCREENED';
    $('energypill').textContent = exact ? 'EXACT' : 'SCREENED';
    drawRPlot(A.n, lEff, Ze);
    drawEnergyLadder(A.n, Ze);
    drawSpectrum(A.n, Ze);
    measCtxArgs = [A.n, lEff, Ze];
    $('annot').textContent = `axes ±${fmtLen(lastRadius * 1.15, 1)} · z is the quantization axis · ${nucleusNote()}`;
    if (params.nodes)
      $('annot').textContent += ` · nodal surfaces: ${A.n - lEff - 1} radial sphere(s), ${lEff} angular`;
  } else {
    const cfg = electronConfig(Z);
    const outer = cfg.reduce((a, b) => (b.n > a.n ? b : a), cfg[0]);
    $('statename').textContent = elementName(Z);
    $('qn').textContent = `Z=${Z}  ·  ${cfg.length} occupied subshell${cfg.length > 1 ? 's' : ''}`;
    $('statedesc').textContent =
      "Neutral atom: screened hydrogenic orbitals (Slater). Open shells show unpaired lobes (Hund's rule); filled shells are spherical.";
    addProp('Electrons', String(Z), exact ? 'EXACT' : 'APPROX');
    addProp('Configuration', cfg.map((s) => `${s.n}${'spdf'[s.l]}${sup(s.e)}`).join(' '), exact ? 'EXACT' : 'APPROX');
    addProp('Category', categoryOf(Z), 'DATA');
    addProp('Period · group', `${periodOf(Z)} · ${groupOf(Z)}`, 'DATA');
    addProp('Block', `${blockOf(Z)}-block`, 'DATA');
    addProp('Atomic mass', `${ATOMIC_MASS[Z - 1]} u`, 'DATA');
    const Ze = zeff(Z, outer.n, outer.l);
    addProp('valence Z_eff', Ze.toFixed(2), 'SCREENED');
    addProp('Sampled points', lastCount.toLocaleString(), 'MONTE-CARLO');
    $('histpill').textContent = exact ? 'EXACT' : 'SCREENED';
    $('energypill').textContent = exact ? 'EXACT' : 'SCREENED';
    drawRPlot(outer.n, outer.l, Ze);
    drawEnergyLadder(outer.n, Ze);
    drawSpectrum(outer.n, Ze);
    measCtxArgs = [outer.n, outer.l, Ze];
    $('annot').textContent = `axes ±${fmtLen(lastRadius * 1.15, 1)} · colour = shell (n) · ${nucleusNote()}`;
  }
  drawCrossSection();
  drawMeas();
}

// ---------- viewport overlays ----------
const axisDefs: Array<[string, [number, number, number], string]> = [
  ['X', [1, 0, 0], '#ff6b6b'],
  ['Y', [0, 1, 0], '#6bd88a'],
  ['Z', [0, 0, 1], '#6ba8ff'],
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
  axisDefs.forEach(([, dir], i) => {
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
  $('scalebar').innerHTML = `<i style="width:${nice / wpp}px"></i>${fmtLen(nice, nice < 1 ? 1 : 0)}`;
}

// ---------- measurement ----------
const measurements: number[] = [];
const MEAS_MAX = 20000; // cap memory; histogram is stable well before this

function takeMeasurement(): [number, number, number] {
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

function recordMeasurement(r: number): void {
  measurements.push(r);
  if (measurements.length > MEAS_MAX) measurements.shift();
}

// Only a change of distribution (element/view/orbital/superpose/excited)
// invalidates the tally; visual toggles must not wipe it.
function resetTally(): void {
  measurements.length = 0;
}

renderer.domElement.addEventListener('click', () => {
  if (!params.measure) return;
  const p = takeMeasurement();
  recordMeasurement(Math.hypot(p[0], p[1], p[2]));
  marker.position.set(p[0], p[1], p[2]);
  marker.visible = true;
  drawMeas();
  $('log').textContent = `> measured (${p.map((v) => v.toFixed(2)).join(', ')}) a₀`;
});

// ---------- UI wiring ----------
function applyHash(): void {
  const h = new URLSearchParams(location.hash.slice(1));
  const el = h.get('el');
  if (el && SYMBOLS.includes(el)) params.element = el;
  const view = h.get('view');
  if (view === 'atom' || view === 'orbital') params.view = view;
  const orb = h.get('orb');
  if (orb) params.orbital = orb;
  const orb2 = h.get('orb2');
  if (orb2) params.orbital2 = orb2;
  const pts = Number(h.get('pts'));
  if (pts) params.density = Math.max(10000, Math.min(200000, pts));
  const col = h.get('col');
  if (col === 'phase' || col === 'shell' || col === 'density') params.colour = col;
  const un = h.get('units');
  if (un === 'a0' || un === 'pm' || un === 'ang') params.units = un;
  const pl = h.get('plane');
  if (pl === 'xz' || pl === 'xy' || pl === 'yz') params.plane = pl;
  params.superpose = h.get('sup') === '1';
  params.excited = h.get('exc') === '1';
  params.evolve = h.get('evo') === '1';
  params.autoRotate = h.get('rot') !== '0';
  params.fitView = h.get('fit') !== '0';
  params.trueScale = h.get('ts') === '1';
  params.nodes = h.get('nod') === '1';
}

function syncHash(): void {
  const h = new URLSearchParams({
    el: params.element,
    view: params.view,
    orb: params.orbital,
    orb2: params.orbital2,
    pts: String(params.density),
    col: params.colour,
    units: params.units,
    plane: params.plane,
    sup: params.superpose ? '1' : '0',
    exc: params.excited ? '1' : '0',
    evo: params.evolve ? '1' : '0',
    rot: params.autoRotate ? '1' : '0',
    fit: params.fitView ? '1' : '0',
    ts: params.trueScale ? '1' : '0',
    nod: params.nodes ? '1' : '0',
  });
  history.replaceState(null, '', '#' + h.toString());
}

function fillSelect(sel: HTMLSelectElement, values: string[], current: string): void {
  sel.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  }
  if (values.includes(current)) sel.value = current;
  refreshSelect(sel);
}

// ---------- themed dropdown (progressively enhances every native <select>) ----------
interface SelectCtrl {
  wrap: HTMLElement;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
  search: HTMLInputElement;
  options: HTMLElement;
  hint: HTMLElement;
}
const selectCtrls = new Map<HTMLSelectElement, SelectCtrl>();
let openSelect: HTMLSelectElement | null = null;
let activeIndex = 0;

function enhanceSelect(sel: HTMLSelectElement): void {
  if (selectCtrls.has(sel)) return;
  sel.classList.add('native-hidden');
  const wrap = document.createElement('div');
  wrap.className = 'select';
  sel.parentNode!.insertBefore(wrap, sel);
  wrap.appendChild(sel);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const valueEl = document.createElement('span');
  valueEl.className = 'select-value';
  trigger.appendChild(valueEl);

  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  const search = document.createElement('input');
  search.className = 'select-search';
  search.type = 'text';
  search.placeholder = 'filter…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const options = document.createElement('div');
  options.className = 'select-options';
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'select-hint';
  hint.tabIndex = -1;
  hint.setAttribute('aria-label', 'scroll down one');
  menu.append(search, options, hint);
  wrap.append(trigger, menu);

  selectCtrls.set(sel, { wrap, trigger, menu, search, options, hint });
  hint.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the search
  hint.addEventListener('click', () => {
    const row = visibleOptions(sel)[0];
    options.scrollBy({ top: row ? row.offsetHeight : 28, behavior: 'smooth' });
  });
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    if (openSelect === sel) closeSelect();
    else openSelectMenu(sel);
  });
  search.addEventListener('input', () => filterOptions(sel));
  options.addEventListener('click', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('.select-option');
    if (opt) chooseOption(sel, opt.dataset.value!);
  });
  menu.addEventListener('keydown', (e) => onMenuKey(sel, e));
  refreshSelect(sel);
}

function refreshSelect(sel: HTMLSelectElement): void {
  if (!selectCtrls.has(sel)) {
    enhanceSelect(sel);
    return;
  }
  const ctrl = selectCtrls.get(sel)!;
  ctrl.options.innerHTML = '';
  for (const o of Array.from(sel.options)) {
    const el = document.createElement('div');
    el.className = 'select-option';
    el.setAttribute('role', 'option');
    el.dataset.value = o.value;
    el.textContent = o.textContent ?? o.value;
    el.setAttribute('aria-selected', String(o.value === sel.value));
    ctrl.options.appendChild(el);
  }
  const cur = sel.options[sel.selectedIndex];
  ctrl.trigger.querySelector('.select-value')!.textContent = cur ? (cur.textContent ?? '') : '';
  ctrl.search.hidden = sel.options.length <= 6; // no filter needed for a short list
  ctrl.search.value = '';
  setTriggerLabel(sel);
}

// Keep the trigger label in sync when the select's value changes in code
// (keyboard stepping, gallery clicks), not just via the dropdown.
function setTriggerLabel(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel);
  if (!ctrl) return;
  const cur = sel.options[sel.selectedIndex];
  ctrl.trigger.querySelector('.select-value')!.textContent = cur ? (cur.textContent ?? '') : '';
  for (const o of Array.from(ctrl.options.children) as HTMLElement[])
    o.setAttribute('aria-selected', String(o.dataset.value === sel.value));
}

function visibleOptions(sel: HTMLSelectElement): HTMLElement[] {
  const ctrl = selectCtrls.get(sel)!;
  return (Array.from(ctrl.options.children) as HTMLElement[]).filter((c) => !c.hidden);
}
function markActive(sel: HTMLSelectElement, idx: number): void {
  const vis = visibleOptions(sel);
  if (!vis.length) return;
  activeIndex = Math.max(0, Math.min(vis.length - 1, idx));
  vis.forEach((o, i) => o.classList.toggle('active', i === activeIndex));
  vis[activeIndex].scrollIntoView({ block: 'nearest' });
  updateScrollHint(sel);
}
// Show the scroll footer only while the list overflows (checked on open/filter,
// so it never toggles mid-scroll and changes the list height under the cursor).
function updateScrollHint(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel)!;
  const o = ctrl.options;
  ctrl.hint.classList.toggle('show', o.scrollHeight > o.clientHeight + 2);
}
function filterOptions(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel)!;
  const q = ctrl.search.value.trim().toLowerCase();
  for (const c of Array.from(ctrl.options.children) as HTMLElement[])
    c.hidden = q !== '' && !(c.textContent ?? '').toLowerCase().includes(q);
  markActive(sel, 0);
}
function chooseOption(sel: HTMLSelectElement, value: string): void {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const ctrl = selectCtrls.get(sel)!;
  setTriggerLabel(sel);
  closeSelect();
  ctrl.trigger.focus();
}
function onMenuKey(sel: HTMLSelectElement, e: KeyboardEvent): void {
  const vis = visibleOptions(sel);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    markActive(sel, activeIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    markActive(sel, activeIndex - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (vis[activeIndex]) chooseOption(sel, vis[activeIndex].dataset.value!);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSelect();
    selectCtrls.get(sel)!.trigger.focus();
  }
}
function openSelectMenu(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel)!;
  if (openSelect) closeSelect();
  openSelect = sel;
  ctrl.menu.hidden = false;
  ctrl.trigger.classList.add('open');
  ctrl.trigger.setAttribute('aria-expanded', 'true');
  const r = ctrl.trigger.getBoundingClientRect();
  const w = Math.max(r.width, 190);
  ctrl.menu.style.width = `${w}px`;
  ctrl.menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  // flip above the trigger if there isn't room below
  if (innerHeight - r.bottom - 8 < ctrl.menu.offsetHeight && r.top > innerHeight - r.bottom) {
    ctrl.menu.style.top = 'auto';
    ctrl.menu.style.bottom = `${innerHeight - r.top + 4}px`;
  } else {
    ctrl.menu.style.top = `${r.bottom + 4}px`;
    ctrl.menu.style.bottom = 'auto';
  }
  const selIdx = Array.from(sel.options).findIndex((o) => o.value === sel.value);
  markActive(sel, Math.max(0, selIdx));
  updateScrollHint(sel);
  if (ctrl.search.hidden) ctrl.trigger.focus();
  else ctrl.search.focus();
}
function closeSelect(): void {
  if (!openSelect) return;
  const ctrl = selectCtrls.get(openSelect)!;
  ctrl.menu.hidden = true;
  ctrl.trigger.classList.remove('open');
  ctrl.trigger.setAttribute('aria-expanded', 'false');
  openSelect = null;
}

document.addEventListener('click', (e) => {
  if (!openSelect) return;
  const ctrl = selectCtrls.get(openSelect)!;
  const t = e.target as Node;
  if (!ctrl.wrap.contains(t) && !ctrl.menu.contains(t)) closeSelect();
});
addEventListener('resize', closeSelect);
// a fixed menu can't follow its trigger while a panel scrolls, so close on scroll
addEventListener(
  'scroll',
  (e) => {
    if (openSelect && !selectCtrls.get(openSelect)!.menu.contains(e.target as Node)) closeSelect();
  },
  true,
);

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
  $('evolveRow').classList.toggle('hidden', !(params.view === 'orbital' && params.superpose));
}

for (const s of document.querySelectorAll<HTMLSelectElement>('select')) enhanceSelect(s);
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
const evolveInput = $<HTMLInputElement>('evolve');
const trueScaleInput = $<HTMLInputElement>('truescale');
const nodesInput = $<HTMLInputElement>('nodes');
const measure100 = $<HTMLButtonElement>('measure100');
const unitsSel = $<HTMLSelectElement>('units');
const planeSel = $<HTMLSelectElement>('plane');

// --- actions (shared by controls and keyboard) ---
function setElement(sym: string): void {
  params.element = sym;
  elementSel.value = sym;
  setTriggerLabel(elementSel);
  updateOrbitals();
  resetTally();
  update(true);
}
function stepElement(d: number): void {
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
function setView(v: 'atom' | 'orbital'): void {
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
function setExcited(v: boolean): void {
  params.excited = v;
  excitedInput.checked = v;
  updateOrbitals();
  resetTally();
  update(true);
}
function setColour(mode: typeof params.colour): void {
  params.colour = mode;
  colourSel.value = mode;
  setTriggerLabel(colourSel);
  recolour();
}
function cycleColour(): void {
  const m: Array<typeof params.colour> = ['phase', 'shell', 'density'];
  setColour(m[(m.indexOf(params.colour) + 1) % m.length]);
}
function setRotate(v: boolean): void {
  params.autoRotate = v;
  rotInput.checked = v;
  controls.autoRotate = v;
}
function setFit(v: boolean): void {
  params.fitView = v;
  fitInput.checked = v;
  if (v) frameCloud();
  else updatePointSize();
}
function setMeasure(v: boolean): void {
  params.measure = v;
  measureInput.checked = v;
  if (!v) marker.visible = false;
  viewport.classList.toggle('measuring', v);
}
function setEvolve(v: boolean): void {
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
function savePng(): void {
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
function toast(msg: string): void {
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

// --- listeners ---
elementSel.addEventListener('change', () => setElement(elementSel.value));
excitedInput.addEventListener('change', () => setExcited(excitedInput.checked));
for (const b of document.querySelectorAll<HTMLButtonElement>('#view button'))
  b.addEventListener('click', () => setView(b.dataset.v as 'atom' | 'orbital'));
orbitalSel.addEventListener('change', () => setOrbital(orbitalSel.value));
superposeInput.addEventListener('change', () => setSuperpose(superposeInput.checked));
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

// --- keys & tips modal ---
const helpModal = $('help');
const openHelp = (): void => {
  helpModal.hidden = false;
  $('helpclose').focus();
};
const closeHelp = (): void => {
  helpModal.hidden = true;
};
$('keys').addEventListener('click', openHelp);
$('helpclose').addEventListener('click', closeHelp);
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) closeHelp();
});

// --- keyboard shortcuts ---
addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'SELECT' || tag === 'INPUT') return;
  if (!helpModal.hidden) {
    if (e.key === 'Escape') closeHelp();
    return;
  }
  switch (e.key) {
    case 'v':
      setView(params.view === 'atom' ? 'orbital' : 'atom');
      break;
    case 'r':
      setRotate(!params.autoRotate);
      break;
    case 'f':
      setFit(!params.fitView);
      break;
    case 'c':
      cycleColour();
      break;
    case 'e':
      setExcited(!params.excited);
      break;
    case 'm':
      setMeasure(!params.measure);
      break;
    case 't':
      setEvolve(!params.evolve);
      break;
    case 's':
      savePng();
      break;
    case '[':
      stepElement(-1);
      break;
    case ']':
      stepElement(1);
      break;
    case '?':
      openHelp();
      break;
    case 'Escape':
      marker.visible = false;
      break;
  }
});

addEventListener('resize', () => {
  const w = viewport.clientWidth,
    h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  updatePointSize();
  updateScaleBar();
  drawCrossSection();
  drawMeas();
});

renderer.setSize(viewport.clientWidth, viewport.clientHeight);
composer.setSize(viewport.clientWidth, viewport.clientHeight);
camera.aspect = viewport.clientWidth / viewport.clientHeight;
camera.updateProjectionMatrix();

update(true);

let frames = 0,
  t0 = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  pointUniforms.uDist.value = camera.position.distanceTo(controls.target) || CAM_DIST;
  if (pointUniforms.uTimeEvo.value > 0.5) {
    // visual period 3 s (real atomic beat frequencies are ~10^15 Hz — slowed here)
    pointUniforms.uCos.value = Math.cos(((performance.now() / 1000) * Math.PI * 2) / 3);
  }
  composer.render();
  updateAxisLabels();
  frames++;
  const now = performance.now();
  if (now - t0 >= 500) {
    $('fps').textContent = `${Math.round((frames * 1000) / (now - t0))} FPS`;
    frames = 0;
    t0 = now;
  }
});

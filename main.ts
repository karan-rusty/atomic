// main.ts — three.js point-cloud renderer + lil-gui controls.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { sampleCloud, sampleShell } from './hydrogen.ts';
import { SYMBOLS, electronConfig, zeff, orbitalsForAtom } from './atoms.ts';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 5000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping; // keep the dense core from blowing out
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;

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

const POS = new THREE.Color('#ff5a00'); // +psi
const NEG = new THREE.Color('#00a6ff'); // -psi
const NEUTRAL = new THREE.Color('#9bd4ff');
// Full-atom view colors by principal shell number n.
const SHELL_COLORS = [
  new THREE.Color('#ffffff'), // 0 = unused
  new THREE.Color('#ff5a00'), // n=1
  new THREE.Color('#ffd24d'), // n=2
  new THREE.Color('#38e0a0'), // n=3
  new THREE.Color('#4db8ff'), // n=4
  new THREE.Color('#b06cff'), // n=5
  new THREE.Color('#ff6bb5'), // n=6
  new THREE.Color('#9fb2c8'), // n=7
];

const params = {
  element: 'C',
  view: 'atom', // 'atom' | 'orbital'
  orbital: '2p_z',
  density: 100000,
  pointSize: 0.06,
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

const Z_of = (symbol: string) => SYMBOLS.indexOf(symbol) + 1;

// Orbitals available for the selected atom (only those it actually has).
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

  if (reframe) {
    // Diagonal view so lobes (e.g. 2p_z along z) aren't seen end-on.
    const d = 3 * percentileRadius(positions, count, 0.98);
    camera.position.set(0.7, 0.45, 0.9).normalize().multiplyScalar(Math.max(d, 2));
    controls.target.set(0, 0, 0);
  }
}

const gui = new GUI();
gui.add(params, 'element', SYMBOLS).onChange(() => {
  updateOrbitals();
  rebuild(true);
});
gui.add(params, 'view', ['atom', 'orbital']).name('view').onChange(syncView);
const orbCtrl = gui.add(params, 'orbital', Object.keys(atomOrbitals)).onChange(() => rebuild(true));

// Refresh the orbital list when the element changes, keeping a valid selection.
function updateOrbitals(): void {
  atomOrbitals = orbitalsForAtom(Z_of(params.element));
  const names = Object.keys(atomOrbitals);
  if (!names.includes(params.orbital)) params.orbital = names[0];
  orbCtrl.options(names);
  orbCtrl.setValue(params.orbital);
}
gui.add(params, 'density', 10000, 1000000, 10000).name('points').onFinishChange(() => rebuild(false));
gui.add(params, 'pointSize', 0.02, 0.5, 0.01).onChange((v: number) => (material.size = v));
const phaseCtrl = gui.add(params, 'phaseColor').onChange(() => rebuild(false));
gui.add(params, 'autoRotate').onChange((v: boolean) => (controls.autoRotate = v));

function syncView(): void {
  if (params.view === 'orbital') {
    orbCtrl.show();
    phaseCtrl.show();
  } else {
    orbCtrl.hide();
    phaseCtrl.hide();
  }
  rebuild(true);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

updateOrbitals();
syncView();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

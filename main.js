// main.js — three.js point-cloud renderer + lil-gui controls.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { ORBITALS, sampleCloud } from './hydrogen.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 5000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
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
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

const POS = new THREE.Color('#ff5a00');
const NEG = new THREE.Color('#00a6ff');
const NEUTRAL = new THREE.Color('#9bd4ff');

const params = {
  orbital: '2p_z',
  density: 100000,
  pointSize: 0.15,
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

let points = null;

function rebuild(reframe) {
  const { n, l, m } = ORBITALS[params.orbital];
  const { positions, signs } = sampleCloud(n, l, m, params.density);

  const colors = new Float32Array(signs.length * 3);
  const c = new THREE.Color();
  for (let i = 0; i < signs.length; i++) {
    c.copy(params.phaseColor ? (signs[i] > 0 ? POS : NEG) : NEUTRAL);
    colors[3 * i] = c.r;
    colors[3 * i + 1] = c.g;
    colors[3 * i + 2] = c.b;
  }

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
    // Orbital radius scales as ~n^2 a0; pull the camera back to match.
    // View from a diagonal so lobes (e.g. 2p_z along z) aren't seen end-on.
    const d = 14 * n * n;
    camera.position.set(0.7, 0.45, 0.9).normalize().multiplyScalar(d);
    controls.target.set(0, 0, 0);
  }
}

const gui = new GUI();
gui.add(params, 'orbital', Object.keys(ORBITALS)).onChange(() => rebuild(true));
gui.add(params, 'density', 10000, 1000000, 10000).onFinishChange(() => rebuild(false));
gui.add(params, 'pointSize', 0.02, 0.5, 0.01).onChange((v) => (material.size = v));
gui.add(params, 'phaseColor').onChange(() => rebuild(false));
gui.add(params, 'autoRotate').onChange((v) => (controls.autoRotate = v));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

rebuild(true);
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

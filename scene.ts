import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { angularNodeCones, angularNodePlanes, nodeRadii } from './hydrogen.ts';
import { fmtLen, params } from './state.ts';
import type { SampleResult } from './sampler.ts';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const viewport = $('viewport');
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', '3D electron probability cloud');

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.2;

export const CAM_DIST = 16; // fallback / initial camera distance
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
export const axes = makeAxes();
scene.add(axes);
export const nucleus = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff0f6 }),
);
scene.add(nucleus);
export const marker = new THREE.Mesh(
  new THREE.SphereGeometry(1, 12, 12),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
);
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
export function buildNodals(n: number, l: number, m: number, Z: number): void {
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

export const POS = new THREE.Color('#ff5c9e');
export const NEG = new THREE.Color('#4db8ff');
const DARK = new THREE.Color('#2a1030');
const WHITE = new THREE.Color('#ffffff');
export const SHELL_COLORS = [
  new THREE.Color('#ffffff'),
  new THREE.Color('#ff5c9e'),
  new THREE.Color('#ffb14d'),
  new THREE.Color('#e0ff4d'),
  new THREE.Color('#4db8ff'),
  new THREE.Color('#b06cff'),
  new THREE.Color('#ff6bb5'),
  new THREE.Color('#9fb2c8'),
];

export function densityColor(t: number, out: THREE.Color): THREE.Color {
  out.copy(DARK).lerp(POS, Math.min(1, t * 1.4));
  if (t > 0.6) out.lerp(WHITE, (t - 0.6) / 0.4);
  return out;
}

const POINT_SCALE = 0.008;
export const pointUniforms = {
  uSize: { value: 0.1 }, // world-space point size
  uScale: { value: 800 }, // viewport scaling for size attenuation
  uDist: { value: 16 }, // camera distance, for depth fade
  uCos: { value: 1 }, // cos(ΔE·t) for time evolution
  uTimeEvo: { value: 0 }, // 1 = colour by instantaneous |ψ(t)|²
  uDensMax: { value: 1 },
};
export const material = new THREE.ShaderMaterial({
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

export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.4, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

export let points: THREE.Points | null = null;
export let lastCount = 0;
export let lastRadius = 1;
export let lastDensity: ((x: number, y: number, z: number) => number) | null = null;
// Last worker result, so visual-only changes (colour, nodes, evolve, true scale)
// recolour/update in place instead of resampling the cloud.
export let lastSample: SampleResult | null = null;
export let lastShellN = 1;

// rebuild() (sampler) owns the writes; a binding imported from another module is
// read-only, so the render state is updated through these.
export function setPoints(p: THREE.Points | null): void {
  points = p;
}
export function setLastCount(v: number): void {
  lastCount = v;
}
export function setLastRadius(v: number): void {
  lastRadius = v;
}
export function setLastDensity(f: ((x: number, y: number, z: number) => number) | null): void {
  lastDensity = f;
}
export function setLastSample(s: SampleResult | null): void {
  lastSample = s;
}
export function setLastShellN(v: number): void {
  lastShellN = v;
}

export const writeColor = (colors: Float32Array, i: number, c: THREE.Color) => {
  colors[3 * i] = c.r;
  colors[3 * i + 1] = c.g;
  colors[3 * i + 2] = c.b;
};

export function updatePointSize(): void {
  const dist = camera.position.distanceTo(controls.target) || CAM_DIST;
  const wpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewport.clientHeight;
  const size = Math.min(8 * wpp, Math.max(1.5 * wpp, lastRadius * POINT_SCALE));
  pointUniforms.uSize.value = size;
  pointUniforms.uScale.value =
    (viewport.clientHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
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
export function updateAxisLabels(): void {
  const L = lastRadius * 1.15;
  axisDefs.forEach(([, dir], i) => {
    tmpV.set(dir[0], dir[1], dir[2]).multiplyScalar(L).project(camera);
    axisEls[i].style.left = `${(tmpV.x * 0.5 + 0.5) * viewport.clientWidth}px`;
    axisEls[i].style.top = `${(-tmpV.y * 0.5 + 0.5) * viewport.clientHeight}px`;
    axisEls[i].style.display = tmpV.z < 1 ? 'block' : 'none';
  });
}

export function updateScaleBar(): void {
  const dist = camera.position.distanceTo(controls.target) || CAM_DIST;
  const wpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewport.clientHeight;
  const target = 80 * wpp;
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find((v) => v >= target) ?? 100;
  $('scalebar').innerHTML = `<i style="width:${nice / wpp}px"></i>${fmtLen(nice, nice < 1 ? 1 : 0)}`;
}

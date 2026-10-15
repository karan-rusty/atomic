import assert from 'node:assert';
import { angularNodeCones, angularNodePlanes, mostProbableRadius, nodeRadii, radial, realY, sampleCloud, sampleSuperposition } from './hydrogen.ts';

assert.ok(Math.abs(radial(1, 0, 0) - 2) < 1e-9, 'R_10(0) must be 2');

let nodes = 0;
let prev = radial(2, 0, 1e-4) > 0;
for (let r = 0.01; r < 30; r += 0.01) {
  const cur = radial(2, 0, r) > 0;
  if (cur !== prev) nodes++;
  prev = cur;
}
assert.strictEqual(nodes, 1, '2s must have exactly one radial node');

const y0 = realY(1, 0, 1.0, 0) ** 2;
assert.ok(Math.abs(y0 - realY(1, 0, 1.0, 1.3) ** 2) < 1e-9, 'Y_10 phi-dependence');
assert.ok(Math.abs(y0 - realY(1, 0, 1.0, 2.9) ** 2) < 1e-9, 'Y_10 phi-dependence');

const N = 200000;
const { positions } = sampleCloud(1, 0, 0, N);
let sum = 0;
for (let i = 0; i < N; i++) {
  const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
  sum += Math.hypot(x, y, z);
}
const mean = sum / N;
assert.ok(Math.abs(mean - 1.5) < 0.03, `1s <r> = ${mean.toFixed(3)}, expected ~1.5`);

const pz = sampleCloud(2, 1, 0, 200000).positions;
let nearEquator = 0;
for (let i = 0; i < 200000; i++) {
  const z = pz[3 * i + 2];
  const r = Math.hypot(pz[3 * i], pz[3 * i + 1], z);
  if (Math.abs(z / r) < 0.15) nearEquator++;
}
const frac = nearEquator / 200000;
assert.ok(frac < 0.05, `2p_z equator fraction = ${frac.toFixed(3)}, expected << 1`);

// Derived quantities: 1s most-probable radius is a0; node counts match n-l-1.
assert.ok(Math.abs(mostProbableRadius(1, 0, 1) - 1) < 0.02, '1s most probable radius ~ 1 a0');
assert.strictEqual(nodeRadii(2, 0, 1).length, 1, '2s has 1 radial node');
assert.strictEqual(nodeRadii(3, 0, 1).length, 2, '3s has 2 radial nodes');

// Angular nodes of real spherical harmonics.
assert.deepStrictEqual(angularNodePlanes(1, 0), [], 'p_z has no azimuthal node plane');
assert.strictEqual(angularNodePlanes(1, 1).length, 1, 'p_x has one node plane');
assert.strictEqual(angularNodePlanes(2, -2).length, 2, 'd_xy has two node planes');
assert.strictEqual(angularNodeCones(1, 0).length, 1, 'p_z has the equatorial node cone');
assert.ok(Math.abs(angularNodeCones(1, 0)[0] - Math.PI / 2) < 1e-9, 'p_z node is snapped to theta = pi/2');
assert.strictEqual(angularNodeCones(2, 0).length, 2, 'd_z2 has two node cones');
assert.ok(Math.abs(angularNodeCones(2, 0)[0] + angularNodeCones(2, 0)[1] - Math.PI) < 0.01, 'cone zeros are symmetric about pi/2 (within a grid step)');
assert.strictEqual(angularNodeCones(2, -2).length, 0, 'd_xy has no polar node cone');

// Superposition must use each orbital's own effective charge: contracting the
// 2s component (Z_eff 4 instead of 1) pulls the mean radius inward.
const mixZ1 = sampleSuperposition({ n: 1, l: 0, m: 0 }, { n: 2, l: 0, m: 0 }, 200000, 1, 1).positions;
const mixZ4 = sampleSuperposition({ n: 1, l: 0, m: 0 }, { n: 2, l: 0, m: 0 }, 200000, 1, 4).positions;
const meanR = (p: Float32Array) => {
  let s = 0;
  for (let i = 0; i < p.length; i += 3) s += Math.hypot(p[i], p[i + 1], p[i + 2]);
  return s / (p.length / 3);
};
const m1 = meanR(mixZ1), m4 = meanR(mixZ4);
assert.ok(m4 < m1, `per-orbital Z_eff: mean r should shrink, got ${m1.toFixed(3)} -> ${m4.toFixed(3)}`);

console.log(`hydrogen.ts OK — 1s <r> = ${mean.toFixed(4)} a0 (expected 1.5); 2p_z equator frac = ${frac.toFixed(4)}`);

// node hydrogen.test.mjs — sanity-check the physics.
import assert from 'node:assert';
import { radial, realY, sampleCloud } from './hydrogen.js';

// R_10(0) = 2 exactly.
assert.ok(Math.abs(radial(1, 0, 0) - 2) < 1e-9, 'R_10(0) must be 2');

// 2s has exactly one radial node (sign flip of R).
let nodes = 0;
let prev = radial(2, 0, 1e-4) > 0;
for (let r = 0.01; r < 30; r += 0.01) {
  const cur = radial(2, 0, r) > 0;
  if (cur !== prev) nodes++;
  prev = cur;
}
assert.strictEqual(nodes, 1, '2s must have exactly one radial node');

// Y_10 is phi-independent.
const y0 = realY(1, 0, 1.0, 0) ** 2;
assert.ok(Math.abs(y0 - realY(1, 0, 1.0, 1.3) ** 2) < 1e-9, 'Y_10 phi-dependence');
assert.ok(Math.abs(y0 - realY(1, 0, 1.0, 2.9) ** 2) < 1e-9, 'Y_10 phi-dependence');

// 1s mean radius = 1.5 a0 (Monte Carlo).
const N = 200000;
const { positions } = sampleCloud(1, 0, 0, N);
let sum = 0;
for (let i = 0; i < N; i++) {
  const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
  sum += Math.hypot(x, y, z);
}
const mean = sum / N;
assert.ok(Math.abs(mean - 1.5) < 0.03, `1s <r> = ${mean.toFixed(3)}, expected ~1.5`);

console.log(`hydrogen.js OK — 1s <r> = ${mean.toFixed(4)} a0 (expected 1.5)`);

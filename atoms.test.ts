// node atoms.test.ts — check electron config + Slater effective charges.
import assert from 'node:assert';
import { electronConfig, zeff, SYMBOLS } from './atoms.ts';

// Config fills exactly Z electrons.
for (const Z of [1, 6, 11, 18, 26, 36]) {
  const total = electronConfig(Z).reduce((s, x) => s + x.e, 0);
  assert.strictEqual(total, Z, `config of Z=${Z} must sum to ${Z}`);
}

// Carbon: 1s2 2s2 2p2.
assert.deepStrictEqual(
  electronConfig(6).map((s) => `${s.n}${'spdf'[s.l]}${s.e}`),
  ['1s2', '2s2', '2p2'],
);

// Known Slater values.
assert.ok(Math.abs(zeff(6, 2, 1) - 3.25) < 1e-9, `C 2p Zeff = ${zeff(6, 2, 1)}, want 3.25`);
assert.ok(Math.abs(zeff(6, 1, 0) - 5.7) < 1e-9, `C 1s Zeff = ${zeff(6, 1, 0)}, want 5.7`);
assert.ok(Math.abs(zeff(11, 3, 0) - 2.2) < 1e-9, `Na 3s Zeff = ${zeff(11, 3, 0)}, want 2.2`);
assert.ok(Math.abs(zeff(21, 3, 2) - 3.0) < 1e-9, `Sc 3d Zeff = ${zeff(21, 3, 2)}, want 3.0`);

// Hydrogen is bare.
assert.strictEqual(zeff(1, 1, 0), 1);
assert.strictEqual(SYMBOLS.length, 36);

console.log('atoms.ts OK — config + Slater Zeff values verified');

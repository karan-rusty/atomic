// node atoms.test.ts — check electron config + Slater effective charges.
import assert from 'node:assert';
import { atomUnits, electronConfig, zeff, SYMBOLS, orbitalsForAtom } from './atoms.ts';

// Config fills exactly Z electrons.
for (const Z of [1, 6, 11, 18, 26, 36, 54, 86, 118]) {
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
assert.strictEqual(SYMBOLS.length, 118);

// Only orbitals that exist in the atom's configuration are offered.
assert.deepStrictEqual(Object.keys(orbitalsForAtom(1)), ['1s'], 'H has only 1s');
const cOrb = Object.keys(orbitalsForAtom(6));
assert.ok(cOrb.includes('2p_x'), `C should have 2p_x, got ${cOrb.join(',')}`);
assert.ok(!cOrb.includes('3d_xy'), `C must not have 3d_xy, got ${cOrb.join(',')}`);

// Hund's rule: open shells show singly-occupied orbitals; half-filled is spherical.
const c2p = atomUnits(6).filter((u) => u.n === 2 && u.l === 1);
assert.strictEqual(c2p.length, 2, 'C 2p2 -> two directional orbitals');
assert.ok(c2p.every((u) => u.m !== null), 'C 2p orbitals are directional');
const n2p = atomUnits(7).filter((u) => u.n === 2 && u.l === 1);
assert.strictEqual(n2p.length, 1, 'N 2p3 -> spherical (half-filled)');
assert.strictEqual(n2p[0].m, null, 'N 2p is spherical');
const sc3d = atomUnits(21).filter((u) => u.n === 3 && u.l === 2);
assert.strictEqual(sc3d.length, 1, 'Sc 3d1 -> one orbital');
assert.ok(sc3d[0].m !== null, 'Sc 3d orbital is directional');

console.log('atoms.ts OK — config + Slater Zeff values verified');

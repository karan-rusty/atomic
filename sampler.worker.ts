// sampler.worker.ts — runs |ψ|² sampling off the main thread.
import { psiAt, radial, sampleCloud, sampleShell, sampleSuperposition, type Orbital } from './hydrogen.ts';

type WorkerScope = {
  postMessage: (m: unknown, t?: Transferable[]) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};
const ctx = self as unknown as WorkerScope;

interface AtomUnitMsg { n: number; l: number; m: number | null; ze: number; per: number; }
interface Req {
  id: number;
  mode: 'atom' | 'orbital' | 'super';
  count: number;
  Z: number;
  Zb?: number;
  a?: Orbital;
  b?: Orbital;
  units?: AtomUnitMsg[];
}

// dens is normalised to [0,1]: per unit for atom mode, globally for orbital modes.
// psi (2*count) holds [ψ_a, ψ_b] per point for time evolution (superposition).
function post(id: number, positions: Float32Array, dens: Float32Array, signs: Int8Array | null, shells: Uint8Array | null, psi: Float32Array | null) {
  const transfer: Transferable[] = [positions.buffer, dens.buffer];
  if (signs) transfer.push(signs.buffer);
  if (shells) transfer.push(shells.buffer);
  if (psi) transfer.push(psi.buffer);
  ctx.postMessage({ id, positions, dens, signs, shells, psi, count: positions.length / 3 }, transfer);
}

ctx.onmessage = (e: MessageEvent<Req>) => {
  const m = e.data;

  if (m.mode === 'atom' && m.units) {
    const total = m.units.reduce((s, u) => s + u.per, 0);
    const positions = new Float32Array(total * 3);
    const dens = new Float32Array(total);
    const shells = new Uint8Array(total);
    let off = 0;
    for (const u of m.units) {
      const chunk = u.m === null ? sampleShell(u.n, u.l, u.ze, u.per) : sampleCloud(u.n, u.l, u.m, u.per, u.ze).positions;
      positions.set(chunk, off * 3);
      shells.fill(u.n, off, off + u.per);
      let max = 1e-30;
      for (let i = 0; i < u.per; i++) {
        const x = chunk[3 * i], y = chunk[3 * i + 1], z = chunk[3 * i + 2];
        const v = u.m === null ? radial(u.n, u.l, u.ze * Math.hypot(x, y, z)) ** 2 * (x * x + y * y + z * z) : psiAt(u.n, u.l, u.m, u.ze, x, y, z) ** 2;
        dens[off + i] = v;
        if (v > max) max = v;
      }
      for (let i = 0; i < u.per; i++) dens[off + i] = Math.sqrt(dens[off + i] / max);
      off += u.per;
    }
    post(m.id, positions, dens, null, shells, null);
    return;
  }

  const A = m.a!;
  let positions: Float32Array;
  let signs: Int8Array;
  if (m.mode === 'super' && m.b) {
    ({ positions, signs } = sampleSuperposition(A, m.b, m.count, m.Z, m.Zb ?? m.Z));
  } else {
    ({ positions, signs } = sampleCloud(A.n, A.l, A.m, m.count, m.Z));
  }
  const dens = new Float32Array(m.count);
  const psi = new Float32Array(m.count * 2);
  let max = 1e-30;
  for (let i = 0; i < m.count; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    const za = m.Z;
    const zb = m.Zb ?? m.Z;
    const pa = psiAt(A.n, A.l, A.m, za, x, y, z);
    const pb = m.mode === 'super' && m.b ? psiAt(m.b.n, m.b.l, m.b.m, zb, x, y, z) : 0;
    psi[2 * i] = pa;
    psi[2 * i + 1] = pb;
    const d = (pa + pb) * (pa + pb);
    dens[i] = d;
    if (d > max) max = d;
  }
  for (let i = 0; i < m.count; i++) dens[i] = Math.sqrt(dens[i] / max);
  post(m.id, positions, dens, signs, null, psi);
};

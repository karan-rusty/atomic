import { SYMBOLS } from './atoms.ts';
import { params } from './state.ts';

export function applyHash(): void {
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

export function syncHash(): void {
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

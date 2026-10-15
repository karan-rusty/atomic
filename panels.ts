import { ATOMIC_MASS, blockOf, categoryOf, electronConfig, elementName, groupOf, periodOf, zeff } from './atoms.ts';
import { mostProbableRadius, nodeRadii } from './hydrogen.ts';
import { $, lastCount, lastRadius } from './scene.ts';
import { curA, curZeff, currentZ, fmtLen, nuclearRatio, params, sup } from './state.ts';
import { drawCrossSection, drawEnergyLadder, drawRPlot, drawSpectrum, energyHa, setMeasCtx } from './plots.ts';
import { drawMeas } from './measure.ts';

function addProp(key: string, value: string, tag?: string): void {
  const row = document.createElement('div');
  row.className = 'prop';
  row.innerHTML =
    `<span class="k">${key}</span><span class="v">${value}</span>` +
    (tag ? `<span class="tagcell"><span class="pill tag">${tag}</span></span>` : '');
  $('props').appendChild(row);
}

function nucleusNote(): string {
  // At true scale the marker is sub-pixel; the number is the point.
  if (!params.trueScale) return 'nucleus marker not to scale';
  const ratio = nuclearRatio(currentZ());
  const cm = 1 / ratio / 100; // cloud width in metres if the nucleus were 1 cm
  return `nucleus at true scale (1:${Math.round(1 / ratio).toLocaleString()}) · if the nucleus were 1 cm, this cloud would span ~${Math.round(cm)} m`;
}

export function updateInfo(): void {
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
    setMeasCtx([A.n, lEff, Ze]);
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
    setMeasCtx([outer.n, outer.l, Ze]);
    $('annot').textContent = `axes ±${fmtLen(lastRadius * 1.15, 1)} · colour = shell (n) · ${nucleusNote()}`;
  }
  drawCrossSection();
  drawMeas();
}

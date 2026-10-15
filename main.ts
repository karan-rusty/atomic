// main.ts — three.js point-cloud renderer wired to the custom AtomSim UI.
import './style.css';
import { SYMBOLS } from './atoms.ts';
import {
  $,
  CAM_DIST,
  camera,
  composer,
  controls,
  pointUniforms,
  renderer,
  updateAxisLabels,
  viewport,
} from './scene.ts';
import { params } from './state.ts';
import { applyHash } from './hash.ts';
import { enhanceSelect, fillSelect } from './selectMenu.ts';
import { initControlValues } from './controls.ts';
import { syncView, updateOrbitals } from './gallery.ts';
import './keys.ts';
import { update } from './sampler.ts';

for (const s of document.querySelectorAll<HTMLSelectElement>('select')) enhanceSelect(s);
applyHash();
fillSelect($<HTMLSelectElement>('element'), SYMBOLS, params.element);
updateOrbitals();
syncView();
initControlValues();

renderer.setSize(viewport.clientWidth, viewport.clientHeight);
composer.setSize(viewport.clientWidth, viewport.clientHeight);
camera.aspect = viewport.clientWidth / viewport.clientHeight;
camera.updateProjectionMatrix();

update(true);

let frames = 0,
  t0 = performance.now();
renderer.setAnimationLoop(() => {
  controls.update();
  pointUniforms.uDist.value = camera.position.distanceTo(controls.target) || CAM_DIST;
  if (pointUniforms.uTimeEvo.value > 0.5) {
    // visual period 3 s (real atomic beat frequencies are ~10^15 Hz — slowed here)
    pointUniforms.uCos.value = Math.cos(((performance.now() / 1000) * Math.PI * 2) / 3);
  }
  composer.render();
  updateAxisLabels();
  frames++;
  const now = performance.now();
  if (now - t0 >= 500) {
    $('fps').textContent = `${Math.round((frames * 1000) / (now - t0))} FPS`;
    frames = 0;
    t0 = now;
  }
});

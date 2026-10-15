import { $, camera, composer, marker, renderer, updatePointSize, updateScaleBar, viewport } from './scene.ts';
import { params } from './state.ts';
import { drawCrossSection } from './plots.ts';
import { drawMeas } from './measure.ts';
import { cycleColour, savePng, setEvolve, setFit, setMeasure, setRotate } from './controls.ts';
import { setExcited, setView, stepElement } from './gallery.ts';

// --- keys & tips modal ---
const helpModal = $('help');
const openHelp = (): void => {
  helpModal.hidden = false;
  $('helpclose').focus();
};
const closeHelp = (): void => {
  helpModal.hidden = true;
};
$('keys').addEventListener('click', openHelp);
$('helpclose').addEventListener('click', closeHelp);
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) closeHelp();
});

// --- keyboard shortcuts ---
addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'SELECT' || tag === 'INPUT') return;
  if (!helpModal.hidden) {
    if (e.key === 'Escape') closeHelp();
    return;
  }
  switch (e.key) {
    case 'v':
      setView(params.view === 'atom' ? 'orbital' : 'atom');
      break;
    case 'r':
      setRotate(!params.autoRotate);
      break;
    case 'f':
      setFit(!params.fitView);
      break;
    case 'c':
      cycleColour();
      break;
    case 'e':
      setExcited(!params.excited);
      break;
    case 'm':
      setMeasure(!params.measure);
      break;
    case 't':
      setEvolve(!params.evolve);
      break;
    case 's':
      savePng();
      break;
    case '[':
      stepElement(-1);
      break;
    case ']':
      stepElement(1);
      break;
    case '?':
      openHelp();
      break;
    case 'Escape':
      marker.visible = false;
      break;
  }
});

addEventListener('resize', () => {
  const w = viewport.clientWidth,
    h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  updatePointSize();
  updateScaleBar();
  drawCrossSection();
  drawMeas();
});

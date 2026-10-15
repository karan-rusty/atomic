export function fillSelect(sel: HTMLSelectElement, values: string[], current: string): void {
  sel.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  }
  if (values.includes(current)) sel.value = current;
  refreshSelect(sel);
}

// ---------- themed dropdown (progressively enhances every native <select>) ----------
interface SelectCtrl {
  wrap: HTMLElement;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
  search: HTMLInputElement;
  options: HTMLElement;
  hint: HTMLElement;
}
const selectCtrls = new Map<HTMLSelectElement, SelectCtrl>();
let openSelect: HTMLSelectElement | null = null;
let activeIndex = 0;

export function enhanceSelect(sel: HTMLSelectElement): void {
  if (selectCtrls.has(sel)) return;
  sel.classList.add('native-hidden');
  const wrap = document.createElement('div');
  wrap.className = 'select';
  sel.parentNode!.insertBefore(wrap, sel);
  wrap.appendChild(sel);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const valueEl = document.createElement('span');
  valueEl.className = 'select-value';
  trigger.appendChild(valueEl);

  const menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  const search = document.createElement('input');
  search.className = 'select-search';
  search.type = 'text';
  search.placeholder = 'filter…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const options = document.createElement('div');
  options.className = 'select-options';
  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'select-hint';
  hint.tabIndex = -1;
  hint.setAttribute('aria-label', 'scroll down one');
  menu.append(search, options, hint);
  wrap.append(trigger, menu);

  selectCtrls.set(sel, { wrap, trigger, menu, search, options, hint });
  hint.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the search
  hint.addEventListener('click', () => {
    const row = visibleOptions(sel)[0];
    options.scrollBy({ top: row ? row.offsetHeight : 28, behavior: 'smooth' });
  });
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    if (openSelect === sel) closeSelect();
    else openSelectMenu(sel);
  });
  search.addEventListener('input', () => filterOptions(sel));
  options.addEventListener('click', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('.select-option');
    if (opt) chooseOption(sel, opt.dataset.value!);
  });
  menu.addEventListener('keydown', (e) => onMenuKey(sel, e));
  refreshSelect(sel);
}

function refreshSelect(sel: HTMLSelectElement): void {
  if (!selectCtrls.has(sel)) {
    enhanceSelect(sel);
    return;
  }
  const ctrl = selectCtrls.get(sel)!;
  ctrl.options.innerHTML = '';
  for (const o of Array.from(sel.options)) {
    const el = document.createElement('div');
    el.className = 'select-option';
    el.setAttribute('role', 'option');
    el.dataset.value = o.value;
    el.textContent = o.textContent ?? o.value;
    el.setAttribute('aria-selected', String(o.value === sel.value));
    ctrl.options.appendChild(el);
  }
  const cur = sel.options[sel.selectedIndex];
  ctrl.trigger.querySelector('.select-value')!.textContent = cur ? (cur.textContent ?? '') : '';
  ctrl.search.hidden = sel.options.length <= 6; // no filter needed for a short list
  ctrl.search.value = '';
  setTriggerLabel(sel);
}

// Keep the trigger label in sync when the select's value changes in code
// (keyboard stepping, gallery clicks), not just via the dropdown.
export function setTriggerLabel(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel);
  if (!ctrl) return;
  const cur = sel.options[sel.selectedIndex];
  ctrl.trigger.querySelector('.select-value')!.textContent = cur ? (cur.textContent ?? '') : '';
  for (const o of Array.from(ctrl.options.children) as HTMLElement[])
    o.setAttribute('aria-selected', String(o.dataset.value === sel.value));
}

function visibleOptions(sel: HTMLSelectElement): HTMLElement[] {
  const ctrl = selectCtrls.get(sel)!;
  return (Array.from(ctrl.options.children) as HTMLElement[]).filter((c) => !c.hidden);
}
function markActive(sel: HTMLSelectElement, idx: number): void {
  const vis = visibleOptions(sel);
  if (!vis.length) return;
  activeIndex = Math.max(0, Math.min(vis.length - 1, idx));
  vis.forEach((o, i) => o.classList.toggle('active', i === activeIndex));
  vis[activeIndex].scrollIntoView({ block: 'nearest' });
  updateScrollHint(sel);
}
// Show the scroll footer only while the list overflows (checked on open/filter,
// so it never toggles mid-scroll and changes the list height under the cursor).
function updateScrollHint(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel)!;
  const o = ctrl.options;
  ctrl.hint.classList.toggle('show', o.scrollHeight > o.clientHeight + 2);
}
function filterOptions(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel)!;
  const q = ctrl.search.value.trim().toLowerCase();
  for (const c of Array.from(ctrl.options.children) as HTMLElement[])
    c.hidden = q !== '' && !(c.textContent ?? '').toLowerCase().includes(q);
  markActive(sel, 0);
}
function chooseOption(sel: HTMLSelectElement, value: string): void {
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const ctrl = selectCtrls.get(sel)!;
  setTriggerLabel(sel);
  closeSelect();
  ctrl.trigger.focus();
}
function onMenuKey(sel: HTMLSelectElement, e: KeyboardEvent): void {
  const vis = visibleOptions(sel);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    markActive(sel, activeIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    markActive(sel, activeIndex - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (vis[activeIndex]) chooseOption(sel, vis[activeIndex].dataset.value!);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSelect();
    selectCtrls.get(sel)!.trigger.focus();
  }
}
function openSelectMenu(sel: HTMLSelectElement): void {
  const ctrl = selectCtrls.get(sel)!;
  if (openSelect) closeSelect();
  openSelect = sel;
  ctrl.menu.hidden = false;
  ctrl.trigger.classList.add('open');
  ctrl.trigger.setAttribute('aria-expanded', 'true');
  const r = ctrl.trigger.getBoundingClientRect();
  const w = Math.max(r.width, 190);
  ctrl.menu.style.width = `${w}px`;
  ctrl.menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  // flip above the trigger if there isn't room below
  if (innerHeight - r.bottom - 8 < ctrl.menu.offsetHeight && r.top > innerHeight - r.bottom) {
    ctrl.menu.style.top = 'auto';
    ctrl.menu.style.bottom = `${innerHeight - r.top + 4}px`;
  } else {
    ctrl.menu.style.top = `${r.bottom + 4}px`;
    ctrl.menu.style.bottom = 'auto';
  }
  const selIdx = Array.from(sel.options).findIndex((o) => o.value === sel.value);
  markActive(sel, Math.max(0, selIdx));
  updateScrollHint(sel);
  if (ctrl.search.hidden) ctrl.trigger.focus();
  else ctrl.search.focus();
}
function closeSelect(): void {
  if (!openSelect) return;
  const ctrl = selectCtrls.get(openSelect)!;
  ctrl.menu.hidden = true;
  ctrl.trigger.classList.remove('open');
  ctrl.trigger.setAttribute('aria-expanded', 'false');
  openSelect = null;
}

document.addEventListener('click', (e) => {
  if (!openSelect) return;
  const ctrl = selectCtrls.get(openSelect)!;
  const t = e.target as Node;
  if (!ctrl.wrap.contains(t) && !ctrl.menu.contains(t)) closeSelect();
});
addEventListener('resize', closeSelect);
// a fixed menu can't follow its trigger while a panel scrolls, so close on scroll
addEventListener(
  'scroll',
  (e) => {
    if (openSelect && !selectCtrls.get(openSelect)!.menu.contains(e.target as Node)) closeSelect();
  },
  true,
);

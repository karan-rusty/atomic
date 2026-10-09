# UI

An "instrument readout": dark, monospace, thin borders, one pink accent.

## Layout

`style.css` — `body` is a CSS grid:

```
grid-template-columns: 300px   1fr      316px;
grid-template-rows:    46px    1fr;
#topbar spans all columns (row 1)
#left        #viewport       #right        (row 2)
```

`#viewport` holds the three.js canvas and absolutely-positioned overlays.

## DOM-id map

Everything is declared in `index.html`; `main.ts` looks elements up by id.

### Top bar
| id | meaning |
|---|---|
| `crumb` | breadcrumb: `element · state · |ψ|² Monte-Carlo` |
| `fps` | live frame rate |
| `exactpill` | `EXACT` (Z=1) or `SCREENED` |
| `drawcount` | number of sampled points |

### Left panel (`#left`)
| id | meaning |
|---|---|
| `stateatom` | `ELEMENT Z=n` header |
| `statename` | big state label (e.g. `2p_z (m = 0)`) |
| `qn` | quantum numbers + `Z_eff` |
| `statedesc` | one-line description |
| `props` | property rows, filled by `addProp()` |
| `rplot` | canvas: `R(r)` line + `P(r)` filled |
| `histpill` | tag for the R/P plot |
| `eladder` | canvas: energy-level ladder |
| `energypill` | tag for the ladder |
| `spectrum` | canvas: emission spectrum |
| `gallery` | grid of clickable orbital thumbnails |

### Viewport (`#viewport`)
| id / class | meaning |
|---|---|
| `drawlabel` | top-left `|ψ|² Monte-Carlo · N draws` |
| `xsec` | canvas: 2D cross-section heatmap (XZ) |
| `axislabels` | container; `main.ts` injects `.axis-label` divs (X/Y/Z) |
| `annot` | bottom annotation line |
| `scalebar` | bottom-right scale ruler |
| `.overlay.bl .pill.vis` | `VISUAL LIBERTY` / `MONTE-CARLO` tags |

### Right panel (`#right`)
| id | control |
|---|---|
| `element` | `<select>` element (H–Kr) |
| `excited` | checkbox — unlock non-ground orbitals |
| `view` | buttons `data-v="atom"` / `"orbital"` |
| `orbital` | `<select>` current state |
| `superpose` | checkbox — mix a second state |
| `orbital2` | `<select>` second state (row `orb2Row`) |
| `orbSection` | the ORBITAL section (hidden in atom view) |
| `points` | range — sample count (10k–200k) |
| `colour` | `<select>` phase / shell / density |
| `rot` | checkbox — auto-rotate |
| `fit` | checkbox — fit camera to cloud |
| `measure` | checkbox — click to collapse to one point |
| `log` | status line |
| `.physics` | `<details>` "Show the physics" |

## Theming

CSS variables in `:root` (`style.css`):

```
--bg --panel --panel-hi --border --border-hi
--text --dim --dim2
--accent: #ff5c9e   --accent-soft   --accent-line
--mono: <monospace stack>
```

Change the accent in one place to re-skin. `.pill`, `.pill.tag`, `.pill.vis`
are the tag styles used throughout.

## Colour modes (`main.ts`)

| mode | meaning |
|---|---|
| `phase` | sign of ψ: `+ψ` pink `#ff5c9e`, `−ψ` blue `#4db8ff` (orbital view). Falls back to shell colouring in atom view. |
| `shell` | by principal shell `n` (`SHELL_COLORS`). |
| `density` | `|ψ|²` through `densityColor()` (dark → pink → white). |

Other palettes live near the top of `main.ts`: `POS`, `NEG`, `DARK`, `WHITE`,
`SHELL_COLORS`. Axis colours are in the `axisDefs` array.

## Keyboard shortcuts

Ignored while typing in a `<select>`/`<input>`.

| key | action |
|---|---|
| `v` | toggle view (atom / orbital) |
| `r` | toggle auto-rotate |
| `f` | toggle fit view |
| `c` | cycle colour mode |
| `e` | toggle excited states |
| `m` | toggle measure mode |
| `s` | save PNG |
| `[` / `]` | previous / next element |
| `t` | toggle time evolution (superposition) |
| `Esc` | clear the measurement marker |

## Responsive

`style.css` media queries: < 1100 px narrows the side panels; < 820 px stacks
the viewport above the panels in a single scrolling column.

## Style rules

- Keep the aesthetic: monospace, uppercase micro-labels (`RADIAL P(R)`), `◦`
  section bullets, thin borders, one accent.
- New controls go in `#right` as a `.row` (`<label class="row"><span>name</span>…`).
- New readouts go in `#left` (property rows via `addProp`, or a `.plot-wrap`
  canvas).

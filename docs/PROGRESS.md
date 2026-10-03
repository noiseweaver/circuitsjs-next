# Progress

## 2026-10-02: Phase 5 (editor)

### Done

- Editing model ported from upstream `MouseManager` (`packages/app/src/editor/Editor.ts`): add,
  select, drag selected, drag post, drag row and column (alt+shift, alt+meta), pan (alt or middle
  drag, touch on empty space), grid snap, upstream's picking (`POSTGRABSQ`, `MINPOSTGRABSIZE`),
  post stretching, wire splitting where a wire or post ends on a wire and where a new wire crosses
  a junction (`wireDraggingDone`), rotate (upstream's flip pair about the snapped centre), mirror,
  swap terminals, duplicate, split wire, and switch toggling (`doSwitch`). The geometry methods
  (`drag`, `move`, `movePoint`, `flipX/Y/XY`, `flipPosts`, `creationFailed`, `dragPlace`,
  `getHandleGrabbedClose`, `noDiagonal` ...) moved onto `CircuitElm` and the tier-1 subclasses.
- Undo and redo (`History.ts`) are commands that, like upstream's `UndoManager`, restore whole-circuit
  XML snapshots; one step per drag, edit, paste or command, capped at 200.
- Copy, cut, paste and duplicate use upstream's clipboard text (`copyOfSelectedElms`, elements in
  reverse) in localStorage under upstream's `circuitClipboard` key; paste reads it with RC_RETAIN
  semantics (`Circuit.readRetain`) and offsets it clear of the original.
- Property panel generated from upstream's `EditInfo` schemas, ported for every tier-1 element
  (`packages/elements/src/edit`): numbers with upstream unit parsing and E12 steppers, text,
  checkboxes and choices, including the fields that rebuild the panel (`newDialog`). Edits apply
  while the circuit runs and undo like any other edit.
- UI: a searchable palette grouped like upstream's Draw menu with live previews (click to arm,
  then drag on the canvas, or drag straight onto it), the property panel with rotate, mirror,
  swap, duplicate and delete, a right-click menu, Edit menu, undo and redo buttons, and Save,
  Export link, Export text and Import text dialogs. Narrow screens get the panels as overlays.
- Keyboard: upstream's element keys (`w r g c L s b v V z l n p N P a t d`), Ctrl/⌘ Z, Y, X, C,
  V, D, A, S, O, Delete and Backspace, arrows to nudge, Escape, space to run and stop, Enter to edit
  the selection, `?` for the list.
- Save writes upstream's XML to a `.txt` file (upstream's default name). Export link gives a `ctz=`
  link for this app and the same one for falstad.com.
- Acceptance: `packages/app/e2e/editor.spec.ts` covers select and drag, building a running circuit
  from the palette and keys, editing a value while running, copy, paste, delete, rotate,
  rubber-band selection, undo, redo, save and export links. `packages/app/e2e/compat.spec.ts`
  runs against the reference build: a circuit built here with the mouse opens in upstream from the
  exported link and upstream saves it byte for byte the same; a circuit loaded and extended with
  the mouse in upstream opens here and saves identically; all 23 golden circuits save the same in
  both apps and upstream reads our saves back unchanged. The compat tests skip when
  `.reference-site/` is missing (CI does not build it). Unit tests cover the editor in
  `packages/app/src/editor/editor.test.ts`.

### Next

- Phase 6: scopes and measurement (scopes, hover info).

### Open issues

- `cct=` links are read but not written: upstream saves XML, and its `cct=` reader splits the
  query on `=` and does not decode `%3D`, so an XML circuit cannot travel in `cct=`. Export uses
  `ctz=`, which upstream reads.
- UI choices that differ from upstream on purpose (listed in the `Editor.ts` header): a click
  selects the element under the mouse and shift-click toggles; dragging an unselected element
  moves just it; keyboard commands act on the selection, falling back to the hovered element; the
  switch hit area includes its bottom and right edges so a click on the line a closed switch
  lies on toggles it.
- Not ported yet: model editing (the diode, transistor and MOSFET "Edit Model" buttons) and lead
  splitting (`splitLeadsAt`).
- Upstream names a `v` element read from a file `VoltageElm`; this app names it `DCVoltageElm`
  (the palette's class). The saved file is the same.
- The production bundle is 653 KB of JS (197 KB gzipped); still one chunk.

## 2026-10-02: Material restyle, Dark default, bundled fonts (between Phases 4 and 5)

### Done

- The owner asked for a Material Design look, Dark as the default theme and a better font.
- UI chrome restyled on Material 3 lines while keeping React + Radix + Zustand (no component
  library, so PLAN.md section 3 is unchanged): a top app bar with the circuit title and the File,
  Circuits and Options menus; the canvas in a rounded surface; a bottom bar with a filled run
  button, icon buttons for reset and fit (with tooltips), Material sliders, the time readouts and
  error and warning chips. Shapes, elevation, state layers and the type scale are CSS tokens in
  `packages/app/src/styles.css`, all mixed from the theme's `ui` colors (no literals). Icons are
  inline Material Icons paths (Apache 2.0) in `Icon.tsx`.
- Fonts: Roboto (variable) for UI text and canvas labels, JetBrains Mono (variable) for component
  values on the canvas (the `value` text style now draws in the theme's `monoFont`; labeled-node
  names moved to the `units` style) and the time readouts. Both are bundled with
  `@fontsource-variable`, so themes still name families only (PLAN.md section 6).
- New built-in Classic Dots (`classic-dots`): Classic colors with a dot grid.
- Dark is the default (`DEFAULT_THEME_ID = 'dark'`, also the base for themes that name none), and
  its UI colors are now a Material 3 dark scheme from a blue seed. Settings moved to the
  `circuitjs-next.settings.v2` key: version 1 always stored Classic, so its theme is dropped and its
  other settings carry over. An e2e test covers both.

### Next

- Phase 5: editor (palette, placement, wires, selection, undo, property panel, save and links).

### Open issues

- 250 of the 367 bundled examples skip at least one element: they use tier 2 and 3 elements
  (logic inputs and outputs, gates, flip-flops, 555, transformers, controlled sources,
  subcircuits ...), which PLAN.md schedules for Phase 8. The most common are logic input `L`
  (66 examples), logic output `M` (64), inverter `I` (23), variable rail `172` and sweep `170`
  (20 and 17) and logic gates (`150`, `151`, `152` ...).
- The production bundle is 578 KB of JS plus about 330 KB of font subsets (only the subsets a
  page uses are downloaded).

## 2026-10-02: Phase 4 (renderer and viewer)

### Done

- Decisions (PLAN.md section 3): the owner confirmed React with Radix headless components and
  Zustand, and chose to keep the engine on the main thread for now (revisit in Phase 9).
- `packages/theme`: theme schema (`Theme`, deep-partial `ThemeInput`) validated with zod (color
  syntax, text and font limits, 16 KB cap), color helpers that truncate like upstream's `Color`
  mixing, the Classic (upstream colors) and Dark ("Night Bench") built-ins, `resolveTheme`,
  `parseThemeJson` (never throws) and CSS variables for the UI.
- `packages/elements/src/view`: the `Painter` interface with semantic inks (role, voltage,
  voltage gradient, data color) and views for every tier-1 element plus output and text. Geometry,
  value text and labels follow upstream's `draw` methods (`interpPoint` rounding, `calcLeads`,
  `drawValues`, `drawLabeledNode`); values use GWT's number formatting.
- `packages/render`: Canvas 2D painter (HiDPI, theme stroke width and dot size), the 201-step
  voltage palette (`getVoltageColor`), current dots (`updateDotCount`, `currentMult`), grid,
  posts and bad-connection marks, pan and zoom with upstream's `centerCircuit` fit, and hit
  testing.
- `packages/format`: upstream URL handling (`cct`, `ctz`, `startCircuit`, `startLabel`,
  `startCircuitLink`, `running`, with `QueryParameters` decoding) and `Circuit.reset()`.
- `packages/app`: React + Radix + Zustand viewer. File menu (open file, open link), the upstream
  example list from `setuplist.txt` (served from the reference submodule in dev, copied into the
  build), run/stop, reset, fit, speed and current-speed sliders, display options (dots, voltage
  colors, values, small grid, IEC resistors, ohm sign, conventional current) and the theme picker.
  Clicking a switch toggles it. Convergence failures stop the run and show upstream's message.
- Checked against the reference build with screenshots side by side: the default LRC example,
  two galleries of every tier-1 element in all orientations, and several golden circuits look the
  same (positions, labels, values, colors, dot speed).
- Acceptance: `packages/app/e2e/viewer.spec.ts` loads the default example, `cct=`, `ctz=` and
  `startCircuit=` links and checks they animate; switches Classic, Dark and back at runtime and
  checks the canvas background and UI variables change with no reload; checks run/stop, reset,
  switch clicks, the open-link dialog and a convergence failure. The no-color-literal lint passes.
  CI now checks out the submodule so the examples are available to the e2e tests.

### Next

- Phase 5: editor (palette, placement, wires, selection, undo, property panel, save and links).

### Open issues

- Not drawn yet: power display mode (option flag 8), probe meter modes other than voltage (they
  need the probe statistics), and upstream's `whiteBackground` (waits for a Light theme, Phase 7).
- Small display differences from upstream: potentiometer values appear while paused (we analyze
  on load), and the probe circle takes the hover color when highlighted.
- Hover info and scopes come in Phase 6; scope and slider records are still kept but not shown.
- The production bundle is one 570 KB chunk; split it when the editor lands.

## 2026-10-02: Phase 3 (nonlinear elements and convergence)

### Done

- `packages/elements`: diode (`DiodeElm` plus the embeddable `Diode` junction used by the MOSFET
  body diodes), LED, zener, bipolar transistor (`TransistorElm`, `NTransistorElm`,
  `PTransistorElm`; Gummel-Poon with junction capacitance), MOSFET (`MosfetElm`, `NMosfetElm`,
  `PMosfetElm`; gate capacitance, body diodes, legacy flags), ideal op-amp (with the seeded
  `getrand` on its convergence path), rail (`R`), push switch, and text (`x`, load and save only;
  tier 2, but upstream examples use it). Ported from `master`, with the `dev-ts` node-voltage
  model; drawing geometry is limited to post positions.
- Device models: `DiodeModel`, `TransistorModel`, `MosfetModel` with upstream's built-ins, text
  records `34` and `32`, XML `<dm>`, `<tm>`, `<mm>`, legacy parameter models (`fwdrop=0.6`,
  `old-mosfet`), and save before the first element that uses them, as upstream does. They live in
  a `ModelLibrary` per `Simulation` (`modelsFor(sim)`), see docs/DEVIATIONS.md.
- Element types now get the simulation they join (`create(x, y, sim)`, `load(..., st, sim)`,
  `createCe(..., sim)`, `constructElement(name, x, y, sim)`), since model lookups happen while
  loading. Voltages read from a file (transistor junctions, op-amp inputs) are held on placeholder
  nodes and carried onto the real nodes by `setNode`, the dev-ts mechanism, so the first iteration
  starts where master's per-element copy would.
- Iteration, convergence checks and adaptive timestep were ported with the engine in Phase 2; no
  engine change was needed. Three new golden circuits exercise them:
  `mosfet-halving` (a 1 kV step on an off MOSFET needs about 1000 subiterations because the MOSFET
  limits each iteration to 0.5 V, so the adaptive timestep halves ten times to 4.9 ns and doubles
  back; closes the Phase 1 open issue), `convergence-fail` and `convergence-fail-adaptive`
  (a 100 kV step on a beta-2 MOSFET; both stop with `Convergence failed!` at step 1001, the
  adaptive one after halving below the minimum timestep). Recorded locally with the pinned
  Chromium 141; `pnpm golden:check` reproduces all 35 fixtures.
- Acceptance: `pnpm golden:compare --engine next tag:nonlinear` passes all 19 nonlinear circuits
  (the 16 from Phase 1 and the 3 above), most bit for bit, worst 2.7e-5 of tolerance. All 35
  golden circuits pass, their saved XML matches upstream's export (scopes and sliders aside), and
  XML load then save is byte-identical. `tools/golden/src/next.test.ts` checks all of it in
  `pnpm check`. Non-convergence ends in upstream's stop state and message at the same step.
- docs/ELEMENTS.md port status filled in for tier 1.

### Next

- Phase 4: renderer and viewer. PLAN.md section 3 says to confirm the UI framework (React with
  headless components) with the owner before starting.

### Open issues

- Loaded element voltages share nodes: if two elements on one node load different voltages (say
  two transistors with saved junction voltages on a shared node), master starts each from its own
  copy while here the last one loaded wins. No example circuit seen does this; add a golden
  circuit if one turns up.
- Not ported yet (unchanged from Phase 2): rail variants (AC, square, variable, clock), bus-width
  detection, probe statistics, custom logic and subcircuit models. Relay models (`<rlm>`) are
  skipped with a warning.
- The model edit dialogs, `getModelList` and `pickName` wait for the editor (Phase 5).

## 2026-10-02: Phase 2 (engine core and linear elements)

### Done

- Phase 1 follow-up: the reference-build job on `main` failed because CI's Chromium (153) re-recorded
  12 fixtures with last-bit differences from the local one (141). Recording is now pinned to Chromium
  141.0.7390.37 (`REFERENCE_BROWSER`, installed in CI with Playwright 1.56.1) and refuses any other
  version unless `GOLDEN_ANY_BROWSER=1`. Fixtures were re-recorded with two new fields:
  `reference.browser` and `export` (upstream's own XML save of the circuit after loading). The
  reference-build job passed with the pin on the Phase 2 pull request.
- `packages/engine`: `Simulation` (wire closure, node numbering, ground and unconnected nodes,
  closures into independent matrices, validation with repair passes, stamping, subiterations,
  adaptive timestep, wire currents), `SimElement`, `FindPathInfo`, dense LU, the EJML-derived
  sparse LU (used from 150 rows), and an exact `java.util.Random`. Ported from `dev-ts` 7ec858d
  (now pinned in docs/UPSTREAM.md) and checked against `master`; where they differ the port follows
  `master` (capacitors skip the current update on node-voltage changes, ground-node voltage reset).
- `packages/elements`: wire, ground, resistor, capacitor, inductor, voltage source (all waveforms;
  `VoltageElm`, `DCVoltageElm`, `ACVoltageElm`), current source, switch, labeled node, probe,
  output, potentiometer. Text and XML load and XML save ported from `master`. Registry mirrors
  upstream's `register`/`createCe`/`constructElement`, including `v` loading as `VoltageElm` from
  text and `DCVoltageElm` from XML.
- `packages/format`: DOM-free XML parser and upstream's `prettyPrint`; `Circuit` reads text and XML
  (`$`, `h`, elements; `o`, `38`, `<o>`, `<adj>` kept for later) and saves XML byte for byte as
  upstream; `runCircuit(text, { seed, stepsPerSample, samples })` returns the golden fixture shape.
  It steps by count, like the harness, instead of the `tEnd, sampleTimes` signature PLAN.md sketched.
- Golden engine `next` (`pnpm golden:compare --engine next`). Acceptance:
  - all 16 `linear` circuits pass (most bit for bit; worst difference 1e-9 of tolerance);
  - saving each loaded linear circuit reproduces upstream's export, scopes and sliders aside
    (docs/DEVIATIONS.md), and XML load then save is byte-identical for all 16.
    Both run in `pnpm check` (`tools/golden/src/next.test.ts`).
- `noise-rc` passes, so GWT's `java.util.Random` does match the JDK sequence (Phase 1 open issue).
- Nonlinear circuits run without hanging and fail the comparison cleanly (unknown elements are
  skipped with a warning).

### Next

- Phase 3: diode, LED, zener, BJT, MOSFET, op-amp, push switch; iteration and convergence; the
  diode and transistor model records (`34`, `32`, `<dm>`, `<tm>`, `<mm>`). Potentiometer is done.
- Add a golden circuit that exercises timestep halving (Phase 1 open issue, still open).

### Open issues

- Not ported yet: rails (`RailElm` and variants), text, bus-width detection (`detectBusWidths`, for
  digital buses), probe measurement statistics (RMS, min/max, frequency; display only), custom logic
  and subcircuit model records. The loader warns and skips them.
- Element voltages live on the nodes (dev-ts model) instead of a per-element copy as in `master`.
  `master`'s `InductorElm.reset()` also zeroes that copy, which can only matter when validation
  resets an inductor after a topology change. No golden circuit covers that yet; add one with a
  switch event when the harness supports switch events.

## 2026-10-02: Phase 1 (golden test harness)

### Done

- Reference patch `tools/reference-patch/harness.patch` (two files, about 130 lines), applied by the
  Docker build. Adds `CircuitJS1.harness`: `setSeed`, exact `step(n)` independent of wall-clock time,
  and a dump of every node voltage and every element's voltages and currents. Image tag and
  `.reference-site/reference-build.json` now carry the patch SHA. Gradle dependencies are cached in a
  BuildKit cache mount (Maven Central returned 429 on repeated builds).
- `tools/golden/`: recorder (`pnpm golden:record`, `pnpm golden:check`), comparator
  (`pnpm golden:compare`, per-value absolute and relative tolerance, first divergence, worst value,
  structural checks), stub engine, engine interface for Phase 2.
- 32 golden circuits in `tools/golden/manifest.json`: 20 written for the harness covering every
  tier-1 element (RC, RL, RLC, divider, AC and square sources, current source, switches, labeled
  nodes and probe, noise, rectifiers, LED and zener, NPN and PNP bias, N and P MOSFET switches,
  three op-amp circuits), 10 upstream examples and 2 upstream XML auto-tests. Tagged `linear`
  (Phase 2) and `nonlinear` (Phase 3). Fixtures in `fixtures/golden/` (2.3 MB).
- Acceptance: two fresh recordings matched the committed fixtures byte for byte (`pnpm golden:check`,
  run twice). `pnpm golden:compare` against the stub fails all 32 circuits with a clean report and
  exit code 1. Loading through `cct=` and through `importCircuit` gave identical traces.
- Unit tests for the comparator, fixture JSON and manifest, plus fixture consistency tests (one
  fixture per manifest entry, recorded from the current circuit text, pinned upstream SHA and current
  patch SHA; each fixture passes against itself and fails against the stub).
- The reference-build workflow now also runs on pull requests touching the patch, the harness or the
  fixtures, and runs `pnpm golden:check` after the build.

### Next

- Phase 2: port the engine core and linear elements from upstream `dev-ts`, add a headless runner
  and register it as a golden engine in `tools/golden/src/engines/index.ts`. Target: every circuit
  tagged `linear` passes `pnpm golden:compare --engine <name> tag:linear`.

### Open issues

- Fixtures come from GWT's emulation of `java.util.Random`. It is meant to reproduce the JDK
  sequence, but this was not checked. `noise-rc` will show it when the TS `java.util.Random` lands.
- `rectifier-adaptive` sets the adaptive timestep flag but converges, so no golden circuit yet
  exercises timestep halving. Add one in Phase 3 (a circuit that fails to converge at the full step).

## 2026-10-02: Phase 0 (setup and reconnaissance)

### Done

- Monorepo: pnpm workspaces with six empty packages, strict TypeScript 6.0, ESLint 10 with
  dependency-boundary and no-color-literal rules (the rule has its own tests), Prettier, Vitest,
  Playwright smoke test, GitHub Actions CI (`.github/workflows/ci.yml`).
- Upstream pinned as a submodule at `5a707168` (docs/UPSTREAM.md).
- Reference app builds in a digest-pinned Docker image (Gradle 8.7, JDK 8, GWT 2.8.2) and runs in
  Chromium: `pnpm reference:build`, `pnpm reference:serve`, `tools/reference-build/smoke.mjs`.
- docs/ELEMENTS.md: 154 element classes with dump types, XML tags, linearity, hooks, tiers.
  Generated by `tools/recon/`.
- docs/ENGINE-NOTES.md: walkthrough of analysis, stamping, LU, iteration, timestep, currents.
- PLAN.md section 4 checked item by item. CLAUDE.md created.

### Next

- Phase 1: golden test harness. Seed upstream's `java.util.Random` in the reference patch, step
  deterministically via the `ontimestep` hook, record traces.

### Open issues

- Decided 2026-10-02: the engine is ported from upstream's `dev-ts` TypeScript branch, not the Java
  code (PLAN.md section 3). Phase 2 should pin a `dev-ts` commit alongside the `master` pin.
- Upstream now saves circuits as XML. The `format` package must read both formats; whether it
  also writes the legacy text format is open.
- The reference-build workflow passed on GitHub on 2026-10-02 (manual run). It triggers on pushes that touch `reference/` or `tools/reference-build/`, or by hand.
- The offline-distribution fallback for the reference build is documented but untested.

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
// Frame pacing follows CircuitJS1 SimulationManager.runCircuit and UIManager.updateCircuit
// (src/com/lushprojects/circuitjs1/client/, master) at 5a707168778216bb6ed01bfdd62e8bbf7ae0a032:
// 160 * iterCount steps per second, at most about 50 ms of simulation per frame.

import {
  SwitchElm,
  VoltageElm,
  switchRect,
  viewFor,
  type CircuitElm,
  type EditInfo,
  type Rect,
} from '@circuitjs-next/elements';
import { Circuit, OptionFlag } from '@circuitjs-next/format';
import { CircuitRenderer, currentMultiplier, type FrameState } from '@circuitjs-next/render';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, type Theme } from '@circuitjs-next/theme';
import {
  Editor,
  MouseMode,
  NO_MODIFIERS,
  type EditorHost,
  type Modifiers,
} from './editor/Editor.ts';
import { useApp, type AppState, type EditorState } from './store.ts';

/** Simulation time per frame before the frame is cut short (upstream `frameTimeLimit`). */
const FRAME_BUDGET_MS = 50;
/** Steps per sim.step() call; small enough to check the clock often. */
const MAX_CHUNK = 500;
const STATUS_INTERVAL_MS = 100;

export function themeById(id: string): Theme {
  return BUILTIN_THEMES[id] ?? (BUILTIN_THEMES[DEFAULT_THEME_ID] as Theme);
}

/**
 * Owns the loaded circuit, the renderer and the animation loop. React components drive it through
 * the store and these methods; the per-frame work never goes through React.
 */
export class SimController {
  readonly circuit = new Circuit();
  readonly editor: Editor;
  private renderer: CircuitRenderer | null = null;
  /** The circuit changed since it was loaded or saved. */
  unsavedChanges = false;
  /** File name of the last save, offered again (upstream ExportAsLocalFileDialog). */
  lastFileName: string | null = null;
  private raf = 0;
  private lastFrame = 0;
  private stepsOwed = 0;
  private lastStatus = 0;
  private needsFit = true;
  private unsubscribe: (() => void) | null = null;
  private detachInput: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** For tests and debugging: frames rendered and steps run. */
  frames = 0;
  steps = 0;

  constructor() {
    this.circuit.read('');
    this.editor = new Editor(this.circuit, this.makeHost());
    this.editor.history.onChange = () => this.publishEditor();
    const stored = readClipboard();
    if (stored !== null) this.editor.setClipboard(stored);
    // upstream asks before shortening the timestep for a fast source
    if (typeof window !== 'undefined') VoltageElm.confirmAdjustTimestep = (m) => window.confirm(m);
  }

  // ---- loading -----------------------------------------------------------------------------

  /**
   * Load circuit text (either upstream format) and show it. Returns false on a parse error.
   * `undoable` records it as an edit, as upstream does for files and examples opened from menus.
   */
  load(text: string, title: string, running = true, undoable = false): boolean {
    const history = this.editor.history;
    if (undoable) history.begin('Open');
    else history.cancel();
    try {
      this.circuit.read(text);
    } catch (e) {
      this.circuit.read('');
      useApp.setState({
        error: `Could not read the circuit: ${e instanceof Error ? e.message : String(e)}`,
      });
      this.afterLoad(title, false);
      if (undoable) history.touch();
      history.commit();
      return false;
    }
    useApp.setState({ error: null });
    this.afterLoad(title, running);
    if (undoable) {
      history.touch();
      history.commit();
    }
    this.unsavedChanges = false;
    return true;
  }

  private afterLoad(title: string, running: boolean, fit = true): void {
    const o = this.circuit.options;
    useApp.setState({
      title,
      running,
      speed: o.speed,
      currentSpeed: o.currentBar,
      warnings: [...this.circuit.warnings],
      display: {
        showDots: (o.flags & OptionFlag.DOTS) !== 0,
        voltageColors: (o.flags & OptionFlag.HIDE_VOLTAGE_COLORS) === 0,
        showValues: (o.flags & OptionFlag.HIDE_VALUES) === 0,
        smallGrid: (o.flags & OptionFlag.SMALL_GRID) !== 0,
      },
    });
    this.stepsOwed = 0;
    this.lastFrame = 0;
    this.renderer?.setElements(this.circuit.elements);
    this.editor.circuitReplaced();
    if (fit) this.needsFit = true;
    this.resize();
    this.publishEditor(true);
    this.publishStatus(true);
  }

  /** Upstream reset button: restart the simulation from t = 0. */
  reset(): void {
    this.circuit.reset();
    this.stepsOwed = 0;
    if (this.renderer) this.renderer.stopElm = null;
    // upstream resumes a stopped simulation when reset at t = 0
    useApp.setState({ running: true });
    this.publishStatus(true);
  }

  setRunning(running: boolean): void {
    // a stopped simulation (convergence failure etc.) only restarts through reset
    if (running && this.circuit.sim.stopMessage !== null) return;
    this.lastFrame = 0;
    useApp.setState({ running });
  }

  fit(): void {
    this.renderer?.fit();
  }

  // ---- canvas --------------------------------------------------------------------------------

  attach(canvas: HTMLCanvasElement): void {
    this.detach();
    const state = useApp.getState();
    const renderer = new CircuitRenderer(canvas, themeById(state.settings.themeId));
    this.renderer = renderer;
    renderer.setElements(this.circuit.elements);
    this.needsFit = true;
    this.unsubscribe = useApp.subscribe((s, prev) => this.onStore(s, prev));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.detachInput = this.attachInput(canvas);
    const loop = (now: number): void => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.unsubscribe?.();
    this.detachInput?.();
    this.resizeObserver?.disconnect();
    this.unsubscribe = this.detachInput = this.resizeObserver = null;
    this.renderer = null;
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const rect = r.canvas.getBoundingClientRect();
    r.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    if (this.needsFit && rect.width > 0) {
      r.fit();
      this.needsFit = false;
    }
  }

  private onStore(s: AppState, prev: AppState): void {
    if (s.settings.themeId !== prev.settings.themeId)
      this.renderer?.setTheme(themeById(s.settings.themeId));
    const o = this.circuit.options;
    // only changes made through the UI; a load sets the store from the circuit, not the reverse
    if (s.speed !== prev.speed) o.speed = s.speed;
    if (s.currentSpeed !== prev.currentSpeed) o.currentBar = s.currentSpeed;
    if (s.display !== prev.display) {
      let f =
        o.flags &
        ~(
          OptionFlag.DOTS |
          OptionFlag.HIDE_VOLTAGE_COLORS |
          OptionFlag.HIDE_VALUES |
          OptionFlag.SMALL_GRID
        );
      if (s.display.showDots) f |= OptionFlag.DOTS;
      if (!s.display.voltageColors) f |= OptionFlag.HIDE_VOLTAGE_COLORS;
      if (!s.display.showValues) f |= OptionFlag.HIDE_VALUES;
      if (s.display.smallGrid) f |= OptionFlag.SMALL_GRID;
      o.flags = f;
      this.circuit.sim.gridSize = s.display.smallGrid ? 8 : 16;
    }
  }

  // ---- frame loop ----------------------------------------------------------------------------

  /** One animation frame: run the simulation for the elapsed time, then draw. */
  frame(now: number): void {
    const state = useApp.getState();
    const elapsed = this.lastFrame === 0 ? 0 : Math.min(now - this.lastFrame, 1000);
    this.lastFrame = now;
    const sim = this.circuit.sim;
    let running = state.running;

    if (running) {
      const steprate = 160 * this.circuit.getIterCount();
      this.stepsOwed += (steprate * elapsed) / 1000;
      // after loading, resetting or a switch flip, run at least one step so the drawing is current
      if (sim.analyzeFlag && this.stepsOwed < 1) this.stepsOwed = 1;
      const start = performance.now();
      while (this.stepsOwed >= 1) {
        const k = Math.min(Math.floor(this.stepsOwed), MAX_CHUNK);
        const done = sim.step(k);
        this.steps += done;
        this.stepsOwed -= k;
        if (sim.stopMessage !== null) break;
        if (performance.now() - start > FRAME_BUDGET_MS) {
          // the circuit is too slow for this speed: drop the backlog rather than spiral
          this.stepsOwed = 0;
          break;
        }
      }
      if (sim.stopMessage !== null) {
        running = false;
        useApp.setState({ running: false });
        if (this.renderer) this.renderer.stopElm = (sim.stopElm as CircuitElm | null) ?? null;
      }
    } else if (sim.analyzeFlag) {
      // analyze while paused too, so a newly loaded circuit shows its node structure
      sim.step(0);
    }

    const r = this.renderer;
    if (r) {
      const o = this.circuit.options;
      const frame: FrameState = {
        running,
        currentMult: currentMultiplier(
          elapsed,
          state.currentSpeed,
          state.settings.conventionalCurrent,
        ),
        showDots: state.display.showDots,
        voltageColors: state.display.voltageColors,
        showValues: state.display.showValues,
        voltageRange: o.voltageRange,
        euroResistors: state.settings.euroResistors,
        showOhm: state.settings.showOhm,
        gridSize: sim.gridSize,
      };
      r.render(frame);
      this.frames++;
    }
    this.publishStatus(false);
  }

  private publishStatus(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastStatus < STATUS_INTERVAL_MS) return;
    this.lastStatus = now;
    const sim = this.circuit.sim;
    useApp.setState({
      status: {
        t: sim.t,
        timeStep: sim.timeStep,
        stopMessage: sim.stopMessage,
        badConnections: this.renderer?.badConnectionCount ?? 0,
      },
    });
  }

  // ---- editor host ---------------------------------------------------------------------------

  private makeHost(): EditorHost {
    return {
      bbox: (e) => viewFor(e)?.bbox(e) ?? null,
      circuitChanged: () => this.circuitChanged(),
      selectionChanged: () => this.publishEditor(),
      restore: (xml) => this.restore(xml),
      visibleArea: () => {
        const r = this.renderer;
        if (!r) return { x1: 0, y1: 0, x2: 800, y2: 600 };
        const rect = r.canvas.getBoundingClientRect();
        const a = r.viewport.toCircuit(0, 0);
        const b = r.viewport.toCircuit(rect.width, rect.height);
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      },
    };
  }

  /** The element list or an element changed: analyze again (upstream `needAnalyze`). */
  circuitChanged(): void {
    this.circuit.sim.setElements(this.circuit.elements);
    if (this.renderer) {
      this.renderer.elementsChanged(this.circuit.elements);
      this.renderer.stopElm = null;
    }
    this.unsavedChanges = true;
    this.publishEditor();
    this.publishStatus(true);
  }

  /** Undo and redo: load a saved copy, keeping the title and the view. */
  private restore(xml: string): void {
    const title = useApp.getState().title;
    const running = useApp.getState().running;
    try {
      this.circuit.read(xml);
    } catch {
      return;
    }
    this.afterLoad(title, running, false);
  }

  /** Push editor state the UI shows into the store. */
  publishEditor(propertiesChanged = false): void {
    const ed = this.editor;
    const sel = ed.selectedElements();
    const prev = useApp.getState().editor;
    const r = this.renderer;
    if (r) {
      r.hovered = ed.mouseElm;
      r.pending = ed.dragElm;
      r.selectionRect = ed.selectedArea;
    }
    const next: EditorState = {
      addClass: ed.mouseMode === MouseMode.ADD_ELM ? ed.addClass : null,
      selectionCount: sel.length,
      selected: sel.length === 1 ? (sel[0] ?? null) : null,
      canUndo: ed.history.canUndo,
      canRedo: ed.history.canRedo,
      canPaste: ed.hasClipboard,
      revision: prev.revision + (propertiesChanged ? 1 : 0),
    };
    if (
      next.addClass !== prev.addClass ||
      next.selectionCount !== prev.selectionCount ||
      next.selected !== prev.selected ||
      next.canUndo !== prev.canUndo ||
      next.canRedo !== prev.canRedo ||
      next.canPaste !== prev.canPaste ||
      next.revision !== prev.revision
    )
      useApp.setState({ editor: next });
  }

  // ---- commands ------------------------------------------------------------------------------

  undo(): void {
    this.editor.history.undo();
  }

  redo(): void {
    this.editor.history.redo();
  }

  copy(menuElm: CircuitElm | null = this.editor.keyTarget()): void {
    const s = this.editor.copySelected(menuElm);
    if (s !== null) writeClipboard(s);
    this.publishEditor();
  }

  cut(menuElm: CircuitElm | null = this.editor.keyTarget()): void {
    const s = this.editor.cut(menuElm);
    if (s !== null) writeClipboard(s);
    this.publishEditor();
  }

  paste(): void {
    // another tab may have copied something since (upstream reads its storage on mouse down)
    const stored = readClipboard();
    if (stored !== null) this.editor.setClipboard(stored);
    this.editor.paste();
  }

  /** Apply a property panel change to an element (upstream EditDialog apply). */
  applyEdit(e: CircuitElm, n: number, ei: EditInfo): void {
    this.editor.history.record('Edit', () => e.setEditValue(n, ei));
    this.circuitChanged();
  }

  /** The circuit as upstream saves it. */
  saveText(): string {
    return this.circuit.dumpXml();
  }

  /** Start a new blank circuit (upstream "New Blank Circuit" loads blank.txt). */
  newCircuit(): void {
    this.load('$ 1 5.0E-6 10 50 5.0\n', 'Untitled', true, true);
    this.lastFileName = null;
  }

  // ---- input: editing, pan, zoom ------------------------------------------------------------

  private attachInput(canvas: HTMLCanvasElement): () => void {
    const ed = this.editor;
    let pan: { x: number; y: number; id: number } | null = null;
    let gestureId: number | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; mx: number; my: number } | null = null;
    // touch long press: opens the context menu, as a right click does with a mouse
    let press: { timer: number; id: number; x: number; y: number; cx: number; cy: number } | null =
      null;
    const cancelPress = (): void => {
      if (press !== null) window.clearTimeout(press.timer);
      press = null;
    };
    /** End the gesture in progress without it editing anything more. */
    const abandonGesture = (id: number): void => {
      if (gestureId !== id) return;
      gestureId = null;
      pan = null;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      ed.pointerUp(NO_MODIFIERS);
      this.publishEditor();
    };

    const local = (e: MouseEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const grid = (p: { x: number; y: number }): { x: number; y: number } => {
      const r = this.renderer;
      const c = r ? r.viewport.toCircuit(p.x, p.y) : p;
      // upstream inverseTransform truncates to int
      return { x: Math.trunc(c.x), y: Math.trunc(c.y) };
    };
    const mods = (e: MouseEvent | KeyboardEvent): Modifiers => ({
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
    const updateCursor = (gx: number, gy: number): void => {
      let cursor = 'default';
      const m = ed.mouseElm;
      if (pan !== null) cursor = 'grabbing';
      else if (ed.mouseMode === MouseMode.ADD_ELM) cursor = 'crosshair';
      else if (m instanceof SwitchElm && inRect(switchRect(m), gx, gy)) cursor = 'pointer';
      else if (m !== null) cursor = ed.mousePost >= 0 ? 'crosshair' : 'move';
      canvas.style.cursor = cursor;
    };
    const pinchState = (): { dist: number; mx: number; my: number } | null => {
      const pts = [...touches.values()];
      if (pts.length < 2) return null;
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    const down = (e: PointerEvent): void => {
      if (e.button === 2) return; // the context menu handles it
      canvas.focus({ preventScroll: true });
      const p = local(e);
      if (e.pointerType === 'touch') {
        // a primary touch starts a new gesture: no other finger is down, so forget any touch
        // whose end never reached the canvas (it would turn this drag into a pinch zoom)
        if (e.isPrimary) {
          touches.clear();
          pinch = null;
        }
        touches.set(e.pointerId, p);
        if (touches.size === 2) {
          // second finger: pinch zoom and two-finger pan instead of editing
          cancelPress();
          if (ed.isDragging) ed.leave();
          pan = null;
          gestureId = null;
          pinch = pinchState();
          return;
        }
        if (touches.size > 2) return;
      }
      if (e.button !== 0 && e.button !== 1) return;
      if (this.renderer) this.renderer.stopElm = null;
      const g = grid(p);
      const touchPan =
        e.pointerType === 'touch' &&
        ed.mouseMode === MouseMode.SELECT &&
        ed.pick(g.x, g.y).elm === null;
      const res = ed.pointerDown(g.x, g.y, mods(e), e.button === 1 || touchPan);
      if (res === 'pan') pan = { x: p.x, y: p.y, id: e.pointerId };
      gestureId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch' && ed.mouseMode === MouseMode.SELECT) {
        cancelPress();
        const id = e.pointerId;
        press = {
          id,
          x: p.x,
          y: p.y,
          cx: e.clientX,
          cy: e.clientY,
          timer: window.setTimeout(() => {
            const at = press;
            press = null;
            if (at === null) return;
            abandonGesture(id);
            canvas.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: at.cx,
                clientY: at.cy,
                button: 2,
              }),
            );
          }, LONG_PRESS_MS),
        };
      }
      this.publishEditor();
      updateCursor(g.x, g.y);
      e.preventDefault();
    };
    const move = (e: PointerEvent): void => {
      const r = this.renderer;
      if (!r) return;
      const p = local(e);
      if (
        press !== null &&
        press.id === e.pointerId &&
        Math.hypot(p.x - press.x, p.y - press.y) > LONG_PRESS_SLOP
      )
        cancelPress();
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, p);
        if (pinch !== null) {
          const now = pinchState();
          if (now !== null) {
            r.viewport.zoomAt(now.dist / pinch.dist, now.mx, now.my);
            r.viewport.pan(now.mx - pinch.mx, now.my - pinch.my);
            pinch = now;
          }
          return;
        }
      }
      if (pan !== null && pan.id === e.pointerId) {
        r.viewport.pan(p.x - pan.x, p.y - pan.y);
        pan.x = p.x;
        pan.y = p.y;
        return;
      }
      const g = grid(p);
      if (ed.isDragging && gestureId === e.pointerId) ed.pointerDrag(g.x, g.y, mods(e));
      else if (!ed.isDragging) ed.hover(g.x, g.y);
      this.publishEditor();
      updateCursor(g.x, g.y);
    };
    const up = (e: PointerEvent): void => {
      if (press !== null && press.id === e.pointerId) cancelPress();
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (gestureId !== e.pointerId) return;
      gestureId = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (pan !== null) {
        pan = null;
        ed.pointerUp(mods(e));
      } else ed.pointerUp(mods(e));
      this.publishEditor();
      const g = grid(local(e));
      updateCursor(g.x, g.y);
    };
    const leave = (e: PointerEvent): void => {
      if (gestureId !== null) return; // captured: the gesture continues
      if (e.pointerType !== 'mouse') return;
      ed.leave();
      this.publishEditor();
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const p = local(e);
      this.renderer?.viewport.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    const contextMenu = (e: MouseEvent): void => {
      // the browser's own long-press menu event: same as ours, so the timer is not needed
      if (press !== null) {
        const id = press.id;
        cancelPress();
        abandonGesture(id);
      }
      // pick what is under the mouse now (a touch long-press has no hover before it)
      const g = grid(local(e));
      ed.hover(g.x, g.y);
      this.menuElm = ed.mouseElm;
      this.menuPos = g;
      this.publishEditor();
    };
    const dblclick = (e: MouseEvent): void => {
      const g = grid(local(e));
      const elm = ed.pick(g.x, g.y).elm;
      if (elm === null || elm instanceof SwitchElm) return;
      ed.select(elm);
      useApp.setState({ inspectorFocus: useApp.getState().inspectorFocus + 1 });
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', contextMenu);
    canvas.addEventListener('dblclick', dblclick);
    return () => {
      cancelPress();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', contextMenu);
      canvas.removeEventListener('dblclick', dblclick);
    };
  }

  /** Element the context menu was opened on, and where (circuit coordinates). */
  menuElm: CircuitElm | null = null;
  menuPos: { x: number; y: number } = { x: 0, y: 0 };

  /** Flip a switch and have the circuit analyzed again (upstream `doSwitch`). */
  toggleSwitch(s: SwitchElm): void {
    this.editor.toggleSwitch(s);
  }

  /** Elements under a canvas point, for tests. */
  elementAt(x: number, y: number): CircuitElm | null {
    return this.renderer?.elementAt(x, y) ?? null;
  }

  /** Screen position (CSS px, canvas relative) of an element's box centre, for tests. */
  elementCenter(e: CircuitElm): { x: number; y: number } | null {
    const r = this.renderer;
    const v = viewFor(e);
    if (!r || !v) return null;
    const b = v.bbox(e);
    return r.viewport.toScreen((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
  }

  /** Circuit coordinates of a page point, or null when it is not over the canvas. */
  clientToCircuit(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.renderer;
    if (!r) return null;
    const rect = r.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const c = r.viewport.toCircuit(x, y);
    return { x: Math.trunc(c.x), y: Math.trunc(c.y) };
  }

  /** Current theme, for palette previews. */
  get theme(): Theme {
    return themeById(useApp.getState().settings.themeId);
  }

  /** Screen position (CSS px, canvas relative) of a circuit point, for tests. */
  toScreen(x: number, y: number): { x: number; y: number } | null {
    return this.renderer?.viewport.toScreen(x, y) ?? null;
  }
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
}

/** How long a touch must stay still to open the context menu, and how far it may wander (px). */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 8;

/** Upstream keeps the clipboard in local storage so it survives reloads and other tabs. */
const CLIPBOARD_KEY = 'circuitClipboard';

function writeClipboard(s: string): void {
  try {
    localStorage.setItem(CLIPBOARD_KEY, s);
  } catch {
    // storage disabled: the clipboard lasts for this page
  }
}

function readClipboard(): string | null {
  try {
    return localStorage.getItem(CLIPBOARD_KEY);
  } catch {
    return null;
  }
}

export const controller = new SimController();

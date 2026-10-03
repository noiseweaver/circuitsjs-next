// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
// Mouse editing follows CircuitJS1 MouseManager.java, and the edit commands CommandManager.java
// (src/com/lushprojects/circuitjs1/client/, master) at 5a707168778216bb6ed01bfdd62e8bbf7ae0a032.
// Differences in the UI on purpose: a click selects the element under the mouse (shift-click
// adds or removes it), and dragging an unselected element selects it. Upstream only selects with
// a rubber band and acts on the hovered element. Keyboard commands act on the selection, falling
// back to the hovered element, and a switch toggles on the edges of its hit area too.

import {
  CircuitElm,
  SwitchElm,
  TextElm,
  WireElm,
  constructElement,
  distanceSq,
  switchRect,
  type Rect,
} from '@circuitjs-next/elements';
import type { Circuit } from '@circuitjs-next/format';
import { History } from './History.ts';

export const MouseMode = {
  ADD_ELM: 0,
  DRAG_ALL: 1,
  DRAG_ROW: 2,
  DRAG_COLUMN: 3,
  DRAG_SELECTED: 4,
  DRAG_POST: 5,
  SELECT: 6,
} as const;
export type MouseMode = (typeof MouseMode)[keyof typeof MouseMode];

const POSTGRABSQ = 25;
const MINPOSTGRABSIZE = 256;

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

export const NO_MODIFIERS: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };

/** What the editor needs from the app around it. */
export interface EditorHost {
  /** Hit box of an element (its view's bounding box), or null if it has no view. */
  bbox(e: CircuitElm): Rect | null;
  /** Elements were added, removed, moved or changed: analyze again and refresh posts. */
  circuitChanged(): void;
  /** Selection or hover changed. */
  selectionChanged(): void;
  /** Replace the circuit with a saved copy (undo and redo), keeping the view. */
  restore(xml: string): void;
  /** The part of the circuit on screen, in circuit coordinates. */
  visibleArea(): Rect;
}

/** Placement, selection, dragging and the edit commands, in circuit coordinates. DOM free. */
export class Editor {
  readonly history: History;
  /** Persistent mouse mode: SELECT, or ADD_ELM with `addClass`. */
  mouseMode: MouseMode = MouseMode.SELECT;
  /** Class placed in ADD_ELM mode (upstream `mouseModeStr`). */
  addClass = 'WireElm';
  /** Mode of the current gesture (upstream `tempMouseMode`). */
  tempMouseMode: MouseMode = MouseMode.SELECT;

  mouseElm: CircuitElm | null = null;
  mousePost = -1;
  /** Element being dragged out (not in the circuit yet). */
  dragElm: CircuitElm | null = null;
  /** Rubber band, in circuit coordinates. */
  selectedArea: Rect | null = null;
  /** Last mouse position in circuit coordinates, or null when outside the canvas. */
  mousePos: { x: number; y: number } | null = null;

  private draggingPost = -1;
  private dragGridX = 0;
  private dragGridY = 0;
  private initDragGridX = 0;
  private initDragGridY = 0;
  private mouseDragging = false;
  private moved = false;
  private heldSwitchElm: SwitchElm | null = null;
  private dragRowColElms: { e: CircuitElm; post: number }[] = [];
  private clipboard = '';
  private paletteDragClass = '';

  constructor(
    readonly circuit: Circuit,
    private readonly host: EditorHost,
  ) {
    this.history = new History({
      save: () => circuit.dumpXml(),
      restore: (xml) => {
        this.forgetElements();
        host.restore(xml);
      },
    });
  }

  get elements(): CircuitElm[] {
    return this.circuit.elements;
  }

  /** The mouse is in a gesture (button held). */
  get isDragging(): boolean {
    return this.mouseDragging;
  }

  /** The current gesture pans the view (the app does the panning). */
  get isPanning(): boolean {
    return this.mouseDragging && this.tempMouseMode === MouseMode.DRAG_ALL;
  }

  snapGrid(x: number): number {
    const g = this.circuit.sim.gridSize;
    return (x + (g / 2 - 1)) & ~(g - 1);
  }

  // ---- modes -------------------------------------------------------------------------------

  /** Place elements of this class on the next drags (upstream draw menu). */
  setAddMode(className: string): void {
    this.mouseMode = this.tempMouseMode = MouseMode.ADD_ELM;
    this.addClass = className;
    this.host.selectionChanged();
  }

  setSelectMode(): void {
    this.mouseMode = this.tempMouseMode = MouseMode.SELECT;
    this.host.selectionChanged();
  }

  // ---- palette drag and drop (upstream toolbarDragMove, toolbarDragEnd) ----------------------

  /**
   * An element dragged from the palette is over the canvas at (gx, gy): place it there with its
   * default length, horizontal or (shift) vertical. Null position: it left the canvas.
   */
  paletteDragMove(className: string, pos: { x: number; y: number } | null, vertical: boolean) {
    if (pos === null) {
      if (this.dragElm !== null) {
        this.dragElm = null;
        this.host.selectionChanged();
      }
      return;
    }
    const ax = this.snapGrid(pos.x);
    const ay = this.snapGrid(pos.y);
    if (this.dragElm === null || this.paletteDragClass !== className) {
      this.dragElm = constructElement(className, ax, ay, this.circuit.sim);
      this.dragElm?.allocNodes();
      this.paletteDragClass = className;
    }
    this.dragElm?.dragPlace(ax, ay, vertical);
    this.mouseElm = null;
    this.host.selectionChanged();
  }

  /** The palette drag ended; drop the element if it is over the canvas. */
  paletteDragEnd(): CircuitElm | null {
    const de = this.dragElm;
    this.dragElm = null;
    if (de === null || de.creationFailed()) {
      this.host.selectionChanged();
      return null;
    }
    this.history.record('Add', () => {
      this.splitWireAt(de.x, de.y);
      this.splitWireAt(de.x2, de.y2);
      this.elements.push(de);
      for (const e of this.elements) e.selected = e === de;
    });
    this.host.circuitChanged();
    this.host.selectionChanged();
    return de;
  }

  // ---- selection ---------------------------------------------------------------------------

  selectedElements(): CircuitElm[] {
    return this.elements.filter((e) => e.selected);
  }

  countSelected(): number {
    let n = 0;
    for (const e of this.elements) if (e.selected) n++;
    return n;
  }

  clearSelection(): void {
    for (const e of this.elements) e.selected = false;
    this.host.selectionChanged();
  }

  selectAll(): void {
    for (const e of this.elements) e.selected = true;
    this.host.selectionChanged();
  }

  select(e: CircuitElm, add = false): void {
    if (!add) for (const ce of this.elements) ce.selected = false;
    e.selected = true;
    this.host.selectionChanged();
  }

  private anySelectedButMouse(): boolean {
    for (const ce of this.elements) if (ce !== this.mouseElm && ce.selected) return true;
    return false;
  }

  /** Forget references to elements that a reload replaces. */
  private forgetElements(): void {
    this.mouseElm = null;
    this.mousePost = -1;
    this.dragElm = null;
    this.heldSwitchElm = null;
    this.mouseDragging = false;
    this.selectedArea = null;
  }

  /** Called after the app loads a different circuit. */
  circuitReplaced(): void {
    this.forgetElements();
    this.tempMouseMode = this.mouseMode;
  }

  // ---- hit testing (upstream mouseSelect) ----------------------------------------------------

  /** Element and post under the point, as upstream's hover picks them. */
  pick(gx: number, gy: number): { elm: CircuitElm | null; post: number } {
    let elm: CircuitElm | null = null;
    let post = -1;
    if (
      this.mouseElm !== null &&
      this.elements.includes(this.mouseElm) &&
      this.mouseElm.getHandleGrabbedClose(gx, gy, POSTGRABSQ, MINPOSTGRABSIZE) >= 0
    ) {
      elm = this.mouseElm;
    } else {
      let bestDist = 100000000;
      for (const ce of this.elements) {
        const b = this.host.bbox(ce);
        if (b === null || !inBox(b, gx, gy)) continue;
        const dist = ce.getMouseDistance(gx, gy);
        if (dist >= 0 && dist < bestDist) {
          bestDist = dist;
          elm = ce;
        }
      }
    }
    if (elm === null) {
      // not in any box, but maybe close to a post
      for (const ce of this.elements) {
        if (
          this.mouseMode === MouseMode.DRAG_POST &&
          ce.getHandleGrabbedClose(gx, gy, POSTGRABSQ, 0) > 0
        ) {
          elm = ce;
          break;
        }
        for (let j = 0; j !== ce.getPostCount(); j++) {
          const pt = ce.getPost(j);
          if (distanceSq(pt.x, pt.y, gx, gy) < 26) {
            elm = ce;
            post = j;
            break;
          }
        }
      }
    } else {
      for (let i = 0; i !== elm.getPostCount(); i++) {
        const pt = elm.getPost(i);
        if (distanceSq(pt.x, pt.y, gx, gy) < 26) post = i;
      }
    }
    return { elm, post };
  }

  private mouseSelect(gx: number, gy: number): void {
    this.dragGridX = this.snapGrid(gx);
    this.dragGridY = this.snapGrid(gy);
    this.draggingPost = -1;
    const { elm, post } = this.pick(gx, gy);
    this.mousePost = post;
    if (elm !== this.mouseElm) {
      this.mouseElm = elm;
      this.host.selectionChanged();
    }
  }

  // ---- mouse -------------------------------------------------------------------------------

  /** Pointer moved with no button down (hover). */
  hover(gx: number, gy: number): void {
    this.mousePos = { x: gx, y: gy };
    if (!this.mouseDragging) this.mouseSelect(gx, gy);
  }

  /** The pointer left the canvas. */
  leave(): void {
    this.mousePos = null;
    if (this.mouseDragging) this.endDrag();
    if (this.mouseElm !== null) {
      this.mouseElm = null;
      this.host.selectionChanged();
    }
  }

  /**
   * Button pressed at (gx, gy). `pan` asks for a view drag whatever the mode (middle button,
   * touch on empty space). Returns what the press did.
   */
  pointerDown(
    gx: number,
    gy: number,
    mods: Modifiers,
    pan = false,
  ): 'switch' | 'pan' | 'edit' | 'none' {
    this.mousePos = { x: gx, y: gy };
    this.mouseSelect(gx, gy);
    this.mouseDragging = true;
    this.moved = false;

    let mode: MouseMode = this.mouseMode;
    if (pan) mode = MouseMode.DRAG_ALL;
    else if (mods.alt && mods.meta) mode = MouseMode.DRAG_COLUMN;
    else if (mods.alt && mods.shift) mode = MouseMode.DRAG_ROW;
    else if (mods.shift) mode = MouseMode.SELECT;
    else if (mods.alt) mode = MouseMode.DRAG_ALL;
    else if (mods.ctrl || mods.meta) mode = MouseMode.DRAG_POST;
    this.tempMouseMode = mode;
    if (mode === MouseMode.DRAG_ALL) return 'pan';

    if (this.doSwitch(gx, gy)) {
      this.mouseDragging = this.heldSwitchElm !== null;
      return 'switch';
    }

    // grab a resize handle in select mode when it is far enough from the other end
    if (
      mode === MouseMode.SELECT &&
      this.mouseElm !== null &&
      this.mouseElm.getHandleGrabbedClose(gx, gy, POSTGRABSQ, MINPOSTGRABSIZE) >= 0 &&
      !this.anySelectedButMouse()
    )
      this.tempMouseMode = MouseMode.DRAG_POST;

    if (this.tempMouseMode !== MouseMode.SELECT && this.tempMouseMode !== MouseMode.DRAG_SELECTED)
      this.clearSelection();

    this.history.begin(this.tempMouseMode === MouseMode.ADD_ELM ? 'Add' : 'Move');
    this.initDragGridX = gx;
    this.initDragGridY = gy;

    if (this.tempMouseMode === MouseMode.DRAG_ROW || this.tempMouseMode === MouseMode.DRAG_COLUMN) {
      // capture the elements now so the sweep doesn't pick up others
      this.dragRowColElms = [];
      const sgx = this.snapGrid(gx);
      const sgy = this.snapGrid(gy);
      const row = this.tempMouseMode === MouseMode.DRAG_ROW;
      for (const ce of this.elements) {
        if (row ? ce.y === sgy : ce.x === sgx) this.dragRowColElms.push({ e: ce, post: 0 });
        if (row ? ce.y2 === sgy : ce.x2 === sgx) this.dragRowColElms.push({ e: ce, post: 1 });
      }
    }

    if (this.tempMouseMode !== MouseMode.ADD_ELM) return 'none';
    this.dragElm = constructElement(
      this.addClass,
      this.snapGrid(gx),
      this.snapGrid(gy),
      this.circuit.sim,
    );
    // not analyzed until it is added: unconnected nodes at 0 V so it can be drawn
    this.dragElm?.allocNodes();
    this.host.selectionChanged();
    return 'edit';
  }

  /** Toggle a switch under the mouse (upstream doSwitch). */
  private doSwitch(gx: number, gy: number): boolean {
    const se = this.mouseElm;
    if (!(se instanceof SwitchElm)) return false;
    // upstream's rectangle excludes its bottom and right edges, which misses a click on the line
    // a closed switch lies on; include them
    const r = switchRect(se);
    if (!(gx >= r.x1 && gx <= r.x2 && gy >= r.y1 && gy <= r.y2)) return false;
    this.toggleSwitch(se);
    if (se.momentary) this.heldSwitchElm = se;
    return true;
  }

  toggleSwitch(se: SwitchElm): void {
    se.toggle();
    this.host.circuitChanged();
  }

  /** Pointer moved with the button down (upstream mouseDragged). */
  pointerDrag(gx: number, gy: number, mods: Modifiers): void {
    this.mousePos = { x: gx, y: gy };
    if (!this.mouseDragging) {
      this.hover(gx, gy);
      return;
    }
    if (this.heldSwitchElm !== null) return;
    if (this.dragElm !== null) {
      this.dragElm.drag(gx, gy);
      this.mouseElm = null;
    }
    let success = true;
    let changed = false;
    switch (this.tempMouseMode) {
      case MouseMode.DRAG_ALL:
        return;
      case MouseMode.DRAG_ROW:
        changed = this.dragRowCol(0, this.snapGrid(gy) - this.dragGridY);
        break;
      case MouseMode.DRAG_COLUMN:
        changed = this.dragRowCol(this.snapGrid(gx) - this.dragGridX, 0);
        break;
      case MouseMode.DRAG_POST:
        if (this.mouseElm !== null)
          changed = this.dragPost(this.snapGrid(gx), this.snapGrid(gy), mods.shift);
        break;
      case MouseMode.SELECT:
        if (this.mouseElm === null) this.selectArea(gx, gy, mods.shift);
        else {
          if (!this.mouseElm.selected) this.select(this.mouseElm, mods.shift);
          this.tempMouseMode = MouseMode.DRAG_SELECTED;
          changed = success = this.dragSelected(gx, gy);
        }
        break;
      case MouseMode.DRAG_SELECTED:
        changed = success = this.dragSelected(gx, gy);
        break;
    }
    if (this.dragElm !== null) changed = true;
    if (changed) {
      this.moved = true;
      this.history.touch();
    }
    if (success) {
      this.dragGridX = gx;
      this.dragGridY = gy;
      if (!(this.tempMouseMode === MouseMode.DRAG_SELECTED && this.onlyGraphicsElmsSelected())) {
        this.dragGridX = this.snapGrid(gx);
        this.dragGridY = this.snapGrid(gy);
      }
    }
    if (this.selectedArea !== null) this.moved = true;
  }

  /** Button released (upstream onMouseUp and endDrag). */
  pointerUp(mods: Modifiers): void {
    if (!this.mouseDragging) return;
    // a click (no drag) in select mode selects what is under the mouse
    if (
      this.tempMouseMode === MouseMode.SELECT &&
      this.selectedArea === null &&
      !this.moved &&
      this.heldSwitchElm === null
    ) {
      if (this.mouseElm === null) {
        if (!mods.shift) this.clearSelection();
      } else if (mods.shift) {
        this.mouseElm.selected = !this.mouseElm.selected;
        this.host.selectionChanged();
      } else this.select(this.mouseElm);
    }
    // ctrl-click on a wire splits it
    if (this.tempMouseMode === MouseMode.DRAG_POST && this.draggingPost === -1 && !this.moved) {
      const m = this.mousePos;
      if (m !== null && this.mouseElm instanceof WireElm) {
        if (this.splitWireAt(this.snapGrid(m.x), this.snapGrid(m.y))) {
          this.history.touch();
          this.host.circuitChanged();
        }
      }
    }
    this.endDrag();
  }

  private endDrag(): void {
    this.mouseDragging = false;
    this.tempMouseMode = this.mouseMode;
    this.selectedArea = null;
    let circuitChanged = false;
    // dropping a post on a wire's middle splits the wire there
    if (this.draggingPost >= 0 && this.mouseElm !== null) {
      const p = this.mouseElm.getPost(this.draggingPost);
      if (this.splitWireAt(p.x, p.y)) circuitChanged = true;
    }
    if (this.heldSwitchElm !== null) {
      // a push switch springs back
      this.heldSwitchElm.toggle();
      this.heldSwitchElm = null;
      this.host.circuitChanged();
    }
    const de = this.dragElm;
    this.dragElm = null;
    if (de !== null) {
      if (de.creationFailed()) {
        this.history.cancel();
      } else {
        this.splitWireAt(de.x, de.y);
        this.splitWireAt(de.x2, de.y2);
        this.elements.push(de);
        if (de instanceof WireElm) this.wireDraggingDone(de);
        circuitChanged = true;
      }
    }
    if (circuitChanged) {
      this.history.touch();
      this.host.circuitChanged();
    } else if (this.moved) this.host.circuitChanged();
    this.history.commit();
    this.host.selectionChanged();
  }

  // ---- dragging (upstream dragSelected, dragPost, dragRow, dragColumn, selectArea) -----------

  private onlyGraphicsElmsSelected(): boolean {
    if (this.mouseElm !== null && !(this.mouseElm instanceof TextElm)) return false;
    for (const ce of this.elements) if (ce.selected && !(ce instanceof TextElm)) return false;
    return true;
  }

  private dragSelected(x: number, y: number): boolean {
    let me = false;
    const mouseElm = this.mouseElm;
    if (mouseElm !== null && !mouseElm.selected) mouseElm.selected = me = true;
    if (!this.onlyGraphicsElmsSelected()) {
      x = this.snapGrid(x);
      y = this.snapGrid(y);
    }
    const dx = x - this.dragGridX;
    const dy = y - this.dragGridY;
    if (dx === 0 && dy === 0) {
      if (me && mouseElm) mouseElm.selected = false;
      return false;
    }
    let allowed = true;
    for (const ce of this.elements) {
      if (ce.selected && !ce.allowMove(dx, dy, this.elements)) {
        allowed = false;
        break;
      }
    }
    if (allowed) {
      for (const ce of this.elements) if (ce.selected) ce.move(dx, dy);
      this.host.circuitChanged();
    }
    if (me && mouseElm) mouseElm.selected = false;
    return allowed;
  }

  private dragPost(x: number, y: number, all: boolean): boolean {
    const m = this.mouseElm;
    if (m === null) return false;
    if (this.draggingPost === -1) {
      this.draggingPost = distanceSq(m.x, m.y, x, y) > distanceSq(m.x2, m.y2, x, y) ? 1 : 0;
    }
    const dx = x - this.dragGridX;
    const dy = y - this.dragGridY;
    if (dx === 0 && dy === 0) return false;
    if (all) {
      // move every element end at the grabbed point
      for (const e of this.elements) {
        let p: number;
        if (e.x === this.dragGridX && e.y === this.dragGridY) p = 0;
        else if (e.x2 === this.dragGridX && e.y2 === this.dragGridY) p = 1;
        else continue;
        e.movePoint(p, dx, dy);
      }
    } else m.movePoint(this.draggingPost, dx, dy);
    this.host.circuitChanged();
    return true;
  }

  private dragRowCol(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false;
    for (const { e, post } of this.dragRowColElms) e.movePoint(post, dx, dy);
    this.removeZeroLengthElements();
    return true;
  }

  private removeZeroLengthElements(): void {
    const els = this.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      const ce = els[i];
      if (ce.x === ce.x2 && ce.y === ce.y2) els.splice(i, 1);
    }
    this.host.circuitChanged();
  }

  private selectArea(x: number, y: number, add: boolean): void {
    const x1 = Math.min(x, this.initDragGridX);
    const x2 = Math.max(x, this.initDragGridX);
    const y1 = Math.min(y, this.initDragGridY);
    const y2 = Math.max(y, this.initDragGridY);
    this.selectedArea = { x1, y1, x2, y2 };
    for (const ce of this.elements) {
      const b = this.host.bbox(ce);
      // upstream selectRect: intersecting boxes are selected
      if (b !== null && intersects(this.selectedArea, b)) ce.selected = true;
      else if (!add) ce.selected = false;
    }
    this.host.selectionChanged();
  }

  // ---- wire splitting (upstream splitWireAt, WireElm.split and draggingDone) ----------------

  /** Split every wire whose interior contains (px, py). */
  splitWireAt(px: number, py: number): boolean {
    let split = false;
    const els = this.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      const we = els[i];
      if (!(we instanceof WireElm)) continue;
      if (!pointOnSegmentInterior(we.x, we.y, we.x2, we.y2, px, py)) continue;
      const nw = constructElement('WireElm', px, py, this.circuit.sim);
      if (nw === null) continue;
      nw.flags = we.flags;
      nw.drag(we.x2, we.y2);
      we.drag(px, py);
      els.push(nw);
      split = true;
    }
    return split;
  }

  /**
   * After a wire is drawn, split it where it passes over a junction or a dead end, so it
   * connects there; skip pieces that would duplicate an existing two-post element.
   */
  private wireDraggingDone(w: WireElm): void {
    const others = this.elements.filter((e) => e !== w);
    const splitPoints = postDrawList(others).filter((p) =>
      pointOnSegmentInterior(w.x, w.y, w.x2, w.y2, p.x, p.y),
    );
    if (splitPoints.length === 0) return;
    const x0 = w.x;
    const y0 = w.y;
    const d = (p: { x: number; y: number }): number => (p.x - x0) ** 2 + (p.y - y0) ** 2;
    splitPoints.sort((a, b) => d(a) - d(b));
    const pts = [{ x: w.x, y: w.y }];
    for (const p of splitPoints) {
      const last = pts[pts.length - 1];
      if (p.x !== last.x || p.y !== last.y) pts.push(p);
    }
    const last = pts[pts.length - 1];
    if (last.x !== w.x2 || last.y !== w.y2) pts.push({ x: w.x2, y: w.y2 });

    let first = true;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (hasDirectConnection(others, a.x, a.y, b.x, b.y)) continue;
      if (first) {
        w.x = a.x;
        w.y = a.y;
        w.drag(b.x, b.y);
        first = false;
      } else {
        const seg = constructElement('WireElm', a.x, a.y, this.circuit.sim);
        if (seg === null) continue;
        seg.drag(b.x, b.y);
        this.elements.push(seg);
      }
    }
    if (first) this.elements.splice(this.elements.indexOf(w), 1);
  }

  // ---- commands (upstream CommandManager) ----------------------------------------------------

  /**
   * What a shortcut acts on when no element is given: the selection, else the element under the
   * mouse (upstream acts on the hovered element when a shortcut is pressed over one).
   */
  keyTarget(): CircuitElm | null {
    return this.countSelected() > 0 ? null : this.mouseElm;
  }

  /** The elements a command acts on: `menuElm` unless it is part of the selection. */
  private target(menuElm: CircuitElm | null): CircuitElm[] {
    const sel = this.selectedElements();
    if (menuElm !== null && !menuElm.selected) return [menuElm];
    return sel;
  }

  /** Delete the selection, or the element under the mouse. */
  deleteSelected(menuElm: CircuitElm | null = this.keyTarget()): void {
    const doomed = new Set(this.target(menuElm));
    if (doomed.size === 0) return;
    this.history.record('Delete', () => {
      this.circuit.elements = this.elements.filter((e) => !doomed.has(e));
      if (this.mouseElm !== null && doomed.has(this.mouseElm)) this.mouseElm = null;
    });
    this.host.circuitChanged();
    this.host.selectionChanged();
  }

  /** Upstream copyOfSelectedElms. */
  copySelected(menuElm: CircuitElm | null = this.keyTarget()): string | null {
    const els = this.target(menuElm);
    if (els.length === 0) return null;
    this.clipboard = this.circuit.dumpElementsXml(els);
    return this.clipboard;
  }

  cut(menuElm: CircuitElm | null = this.keyTarget()): string | null {
    const s = this.copySelected(menuElm);
    if (s !== null) this.deleteSelected(menuElm);
    return s;
  }

  get hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  setClipboard(text: string): void {
    this.clipboard = text;
  }

  duplicate(menuElm: CircuitElm | null = this.keyTarget()): void {
    const els = this.target(menuElm);
    if (els.length === 0) return;
    this.paste(this.circuit.dumpElementsXml(els));
  }

  /** Upstream doPaste: add the elements, selected, beside the circuit or at the mouse. */
  paste(dump: string = this.clipboard): boolean {
    if (dump.length === 0) return false;
    let ok = true;
    this.history.record('Paste', () => {
      for (const e of this.elements) e.selected = false;
      const oldbb = this.boundsOf(this.elements);
      let added: CircuitElm[];
      try {
        added = this.circuit.readRetain(dump);
      } catch {
        ok = false;
        return false;
      }
      if (added.length === 0) {
        ok = false;
        return false;
      }
      for (const e of added) e.selected = true;
      const newbb = this.boundsOf(added);
      if (oldbb !== null && newbb !== null) {
        let dx = 0;
        let dy = 0;
        const area = this.host.visibleArea();
        const ow = oldbb.x2 - oldbb.x1;
        const oh = oldbb.y2 - oldbb.y1;
        const nw = newbb.x2 - newbb.x1;
        const nh = newbb.y2 - newbb.y1;
        const spacew = area.x2 - area.x1 - ow - nw;
        const spaceh = area.y2 - area.y1 - oh - nh;
        if (!intersects(oldbb, newbb)) {
          dx = this.snapGrid(oldbb.x1 - newbb.x1);
          dy = this.snapGrid(oldbb.y1 - newbb.y1);
        }
        if (spacew > spaceh)
          dx = this.snapGrid(oldbb.x1 + ow - newbb.x1 + this.circuit.sim.gridSize);
        else dy = this.snapGrid(oldbb.y1 + oh - newbb.y1 + this.circuit.sim.gridSize);
        // near the mouse if it's on the canvas and nothing would land on top of something
        const m = this.mousePos;
        if (m !== null) {
          const mdx = this.snapGrid(m.x - (newbb.x1 + nw / 2));
          const mdy = this.snapGrid(m.y - (newbb.y1 + nh / 2));
          if (added.every((e) => e.allowMove(mdx, mdy, this.elements))) {
            dx = mdx;
            dy = mdy;
          }
        }
        for (const e of added) e.move(dx, dy);
      }
    });
    this.host.circuitChanged();
    this.host.selectionChanged();
    return ok;
  }

  private boundsOf(els: readonly CircuitElm[]): Rect | null {
    let r: Rect | null = null;
    for (const e of els) {
      const b = this.host.bbox(e) ?? {
        x1: Math.min(e.x, e.x2),
        y1: Math.min(e.y, e.y2),
        x2: Math.max(e.x, e.x2),
        y2: Math.max(e.y, e.y2),
      };
      r =
        r === null
          ? { ...b }
          : {
              x1: Math.min(r.x1, b.x1),
              y1: Math.min(r.y1, b.y1),
              x2: Math.max(r.x2, b.x2),
              y2: Math.max(r.y2, b.y2),
            };
    }
    return r;
  }

  /** Upstream prepareFlip: the elements to flip (all if none selected) and their centre. */
  private prepareFlip(menuElm: CircuitElm | null): { els: CircuitElm[]; cx: number; cy: number } {
    if (menuElm !== null && !menuElm.selected) {
      for (const e of this.elements) e.selected = false;
      menuElm.selected = true;
    }
    const count = this.countSelected();
    const els = this.elements.filter((e) => e.selected || count === 0);
    let minx = 30000;
    let maxx = -30000;
    let miny = 30000;
    let maxy = -30000;
    for (const ce of els) {
      minx = Math.min(ce.x, ce.x2, minx);
      maxx = Math.max(ce.x, ce.x2, maxx);
      miny = Math.min(ce.y, ce.y2, miny);
      maxy = Math.max(ce.y, ce.y2, maxy);
    }
    // Java int division
    return { els, cx: Math.trunc((minx + maxx) / 2), cy: Math.trunc((miny + maxy) / 2) };
  }

  private flipCommand(label: string, menuElm: CircuitElm | null, fn: (fi: FlipInfo) => void): void {
    this.history.record(label, () => {
      const fi = this.prepareFlip(menuElm);
      if (fi.els.length === 0) return false;
      fn({ ...fi, count: this.countSelected() });
    });
    this.host.circuitChanged();
    this.host.selectionChanged();
  }

  mirrorX(menuElm: CircuitElm | null = null): void {
    this.flipCommand('Mirror', menuElm, (fi) => {
      for (const ce of fi.els) ce.flipX(fi.cx * 2, fi.count);
    });
  }

  mirrorY(menuElm: CircuitElm | null = null): void {
    this.flipCommand('Mirror', menuElm, (fi) => {
      for (const ce of fi.els) ce.flipY(fi.cy * 2, fi.count);
    });
  }

  /** A diagonal flip then a vertical flip: a rotation 90 degrees counterclockwise. */
  rotateCCW(menuElm: CircuitElm | null = null): void {
    this.flipCommand('Rotate', menuElm, (fi) => {
      const xmy = this.snapGrid(fi.cx - fi.cy);
      for (const ce of fi.els) {
        ce.flipXY(xmy, fi.count);
        ce.flipY(fi.cy * 2, fi.count);
      }
    });
  }

  rotateCW(menuElm: CircuitElm | null = null): void {
    this.flipCommand('Rotate', menuElm, (fi) => {
      const xmy = this.snapGrid(fi.cx - fi.cy);
      for (const ce of fi.els) {
        ce.flipY(fi.cy * 2, fi.count);
        ce.flipXY(xmy, fi.count);
      }
    });
  }

  /** Swap an element's terminals (upstream "Swap Terminals", doFlip). */
  swapTerminals(e: CircuitElm): void {
    this.history.record('Swap terminals', () => e.flipPosts());
    this.host.circuitChanged();
  }

  /** Arrow keys: move the selection one grid step. */
  moveSelected(dx: number, dy: number): boolean {
    if (this.countSelected() === 0) return false;
    this.history.record('Move', () => {
      for (const ce of this.elements) if (ce.selected) ce.move(dx, dy);
    });
    this.host.circuitChanged();
    return true;
  }

  /** Split the wire under the mouse at the grid point nearest (gx, gy). */
  splitWire(gx: number, gy: number): void {
    this.history.record('Split wire', () => this.splitWireAt(this.snapGrid(gx), this.snapGrid(gy)));
    this.host.circuitChanged();
  }

  /** Can every element the flip commands would act on be flipped that way? */
  canFlip(menuElm: CircuitElm | null = null): { x: boolean; y: boolean; xy: boolean } {
    const count = this.countSelected();
    const els =
      menuElm !== null && !menuElm.selected
        ? [menuElm]
        : this.elements.filter((e) => e.selected || count === 0);
    let x = true;
    let y = true;
    let xy = true;
    for (const e of els) {
      if (!e.canFlipX()) x = false;
      if (!e.canFlipY()) y = false;
      if (!e.canFlipXY()) xy = false;
    }
    return { x, y, xy };
  }
}

interface FlipInfo {
  els: CircuitElm[];
  cx: number;
  cy: number;
  count: number;
}

function inBox(b: Rect, x: number, y: number): boolean {
  return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
}

/** Upstream CircuitElm.pointOnSegmentInterior: strictly inside an axis-aligned segment. */
export function pointOnSegmentInterior(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  if ((px === ax && py === ay) || (px === bx && py === by)) return false;
  if (ax === bx && px === ax) return py > Math.min(ay, by) && py < Math.max(ay, by);
  if (ay === by && py === ay) return px > Math.min(ax, bx) && px < Math.max(ax, bx);
  return false;
}

/** Points where upstream draws a post dot: dead ends and junctions (not two-way joints). */
export function postDrawList(els: readonly CircuitElm[]): { x: number; y: number }[] {
  const count = new Map<string, { x: number; y: number; n: number }>();
  for (const e of els) {
    for (let j = 0; j !== e.getPostCount(); j++) {
      const p = e.getPost(j);
      const k = `${p.x},${p.y}`;
      const c = count.get(k);
      if (c) c.n++;
      else count.set(k, { x: p.x, y: p.y, n: 1 });
    }
  }
  return [...count.values()].filter((p) => p.n !== 2);
}

/** Does a two-post element already join a and b directly? */
function hasDirectConnection(
  els: readonly CircuitElm[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  for (const ce of els) {
    if (ce.getPostCount() !== 2) continue;
    const p0 = ce.getPost(0);
    const p1 = ce.getPost(1);
    if (
      (p0.x === ax && p0.y === ay && p1.x === bx && p1.y === by) ||
      (p0.x === bx && p0.y === by && p1.x === ax && p1.y === ay)
    )
      return true;
  }
  return false;
}

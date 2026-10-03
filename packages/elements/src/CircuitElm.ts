// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/CircuitElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032: construction, positioning and XML dump. The
// simulation half is SimElement in @circuitjs-next/engine.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { CircuitNode, Point, SimElement, type Simulation } from '@circuitjs-next/engine';
import type { EditInfo } from './edit/EditInfo.ts';
import type { StringTokenizer } from './StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter, XmlDocWriter } from './xml.ts';

/**
 * Base of every element class. Upstream has two constructors per element: one for a new element
 * placed by the user, one that reads the text format. Here construction only sets the position;
 * `initNew()` and `undump()` hold what those two constructors do (see ElementType).
 */
export abstract class CircuitElm extends SimElement {
  /** Defaults of a newly placed element (upstream `CircuitElm(int xx, int yy)` constructors). */
  initNew(): void {}

  /** Read the rest of a text-format line (upstream `CircuitElm(xa, ya, xb, yb, f, st)`). */
  undump(_st: StringTokenizer): void {}

  getDefaultFlags(): number {
    return 0;
  }

  /** XML tag: the dump type letter, else the class name without "Elm". */
  getXmlDumpType(): string {
    const t = this.getDumpType();
    if (t > 64 && t < 127) return String.fromCharCode(t);
    return this.getClassName().replace('Elm', '');
  }

  dumpXml(w: XmlAttrWriter): void {
    w.dumpAttr('x', `${this.x} ${this.y} ${this.x2} ${this.y2}`);
    // always written: some elements set nonzero flags in their constructor
    w.dumpAttr('f', this.flags);
  }

  /** Simulation state saved after the settings (capacitor voltage, inductor current). */
  dumpXmlState(_w: XmlAttrWriter): void {}

  undumpXml(r: XmlAttrReader): void {
    this.flags = r.parseIntAttr('f', this.flags);
  }

  /**
   * Model and other records this element needs written before it (upstream elements append
   * them to the document from inside `dumpXml`, so they land just before the element).
   */
  dumpXmlModels(_doc: XmlDocWriter): void {}

  /**
   * Voltages read from a file (transistor junction voltages, op-amp inputs). Upstream keeps a
   * copy of the node voltages per element and the loader writes into it; here they wait on
   * placeholder nodes, and `setNode` carries them onto the real nodes during analysis (the
   * ground node excepted, which master also zeroes).
   */
  protected setLoadedVoltage(n: number, v: number): void {
    const nodes = [...this.nodes];
    for (let i = nodes.length; i < this.getNodeCount(); i++) nodes.push(placeholderNode(0));
    nodes[n] = placeholderNode(v);
    this.nodes = nodes;
  }

  /** Upstream `interpPoint2`: points fraction f from a to b, offset +g and -g across the line. */
  interpPoint2(a: Point, b: Point, f: number, g: number): [Point, Point] {
    const gx = b.y - a.y;
    const gy = a.x - b.x;
    g /= Math.sqrt(gx * gx + gy * gy);
    return [
      new Point(
        Math.floor(a.x * (1 - f) + b.x * f + g * gx + 0.48),
        Math.floor(a.y * (1 - f) + b.y * f + g * gy + 0.48),
      ),
      new Point(
        Math.floor(a.x * (1 - f) + b.x * f - g * gx + 0.48),
        Math.floor(a.y * (1 - f) + b.y * f - g * gy + 0.48),
      ),
    ];
  }

  setPosition(x: number, y: number, x2: number, y2: number): void {
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.setPoints();
  }

  // ---- editing (upstream CircuitElm placement, move and flip methods) ----------------------

  /** Selected in the editor. Upstream keeps selection on the element too. */
  selected = false;
  /** Posts stay on one horizontal or vertical line (transistors, MOSFETs, op-amps). */
  noDiagonal = false;
  /** Handle grabbed by the last `getHandleGrabbedClose` (-1: none). */
  lastHandleGrabbed = -1;

  /** Upstream `CirSim.snapGrid`, with this element's simulation grid. */
  snapGrid(x: number): number {
    const gridSize = this.sim.gridSize;
    return (x + (gridSize / 2 - 1)) & ~(gridSize - 1);
  }

  /** Drag the second point to (xx, yy) while the element is being placed. */
  drag(xx: number, yy: number): void {
    xx = this.snapGrid(xx);
    yy = this.snapGrid(yy);
    if (this.noDiagonal) {
      if (Math.abs(this.x - xx) < Math.abs(this.y - yy)) xx = this.x;
      else yy = this.y;
    }
    this.x2 = xx;
    this.y2 = yy;
    this.setPoints();
  }

  /** Length used when an element is dropped from the palette instead of dragged out. */
  getDragLength(): number {
    return 64;
  }

  getDragVertical(requestedVertical: boolean): boolean {
    return requestedVertical;
  }

  /** Place for palette drag-and-drop with (xa, ya) as the anchor that follows the mouse. */
  dragPlace(xa: number, ya: number, vertical: boolean): void {
    vertical = this.getDragVertical(vertical);
    const len = this.getDragLength();
    this.x = xa;
    this.y = ya;
    this.x2 = xa + (vertical ? 0 : len);
    this.y2 = ya + (vertical ? len : 0);
    this.setPoints();
  }

  swapDragEndpoints(): void {
    const tx = this.x;
    const ty = this.y;
    this.x = this.x2;
    this.y = this.y2;
    this.x2 = tx;
    this.y2 = ty;
    this.setPoints();
  }

  move(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.x2 += dx;
    this.y2 += dy;
    this.setPoints();
  }

  /** A newly dragged-out element of zero size is not created. */
  creationFailed(): boolean {
    return this.x === this.x2 && this.y === this.y2;
  }

  /** Would moving by (dx, dy) put this element exactly on top of another one? */
  allowMove(dx: number, dy: number, elements: readonly CircuitElm[]): boolean {
    const nx = this.x + dx;
    const ny = this.y + dy;
    const nx2 = this.x2 + dx;
    const ny2 = this.y2 + dy;
    for (const ce of elements) {
      if (ce.x === nx && ce.y === ny && ce.x2 === nx2 && ce.y2 === ny2) return false;
      if (ce.x === nx2 && ce.y === ny2 && ce.x2 === nx && ce.y2 === ny) return false;
    }
    return true;
  }

  /** Move one end; refuses to make the element zero length. */
  movePoint(n: number, dx: number, dy: number): void {
    const oldx = this.x;
    const oldy = this.y;
    const oldx2 = this.x2;
    const oldy2 = this.y2;
    if (this.noDiagonal) {
      if (this.x === this.x2) dx = 0;
      else dy = 0;
    }
    if (n === 0) {
      this.x += dx;
      this.y += dy;
    } else {
      this.x2 += dx;
      this.y2 += dy;
    }
    if (this.x === this.x2 && this.y === this.y2) {
      this.x = oldx;
      this.y = oldy;
      this.x2 = oldx2;
      this.y2 = oldy2;
    }
    this.setPoints();
  }

  /** Mirror left-right about x = center2 / 2. */
  flipX(center2: number, _count: number): void {
    this.x = center2 - this.x;
    this.x2 = center2 - this.x2;
    this.setPoints();
  }

  /** Mirror top-bottom about y = center2 / 2. */
  flipY(center2: number, _count: number): void {
    this.y = center2 - this.y;
    this.y2 = center2 - this.y2;
    this.setPoints();
  }

  /** Mirror about the diagonal x - y = xmy. */
  flipXY(xmy: number, _count: number): void {
    const nx = this.y + xmy;
    const ny = this.x - xmy;
    const nx2 = this.y2 + xmy;
    const ny2 = this.x2 - xmy;
    this.x = nx;
    this.y = ny;
    this.x2 = nx2;
    this.y2 = ny2;
    this.setPoints();
  }

  /** Swap the two ends (upstream "Swap Terminals"). */
  flipPosts(): void {
    const oldx = this.x;
    const oldy = this.y;
    this.x = this.x2;
    this.y = this.y2;
    this.x2 = oldx;
    this.y2 = oldy;
    this.setPoints();
  }

  canFlipX(): boolean {
    return true;
  }
  canFlipY(): boolean {
    return true;
  }
  canFlipXY(): boolean {
    return this.canFlipX() || this.canFlipY();
  }

  getNumHandles(): number {
    return this.getPostCount();
  }

  /** Which end handle is within sqrt(deltaSq) of the point, if the element is at least that long. */
  getHandleGrabbedClose(xtest: number, ytest: number, deltaSq: number, minSize: number): number {
    this.lastHandleGrabbed = -1;
    if (distanceSq(this.x, this.y, this.x2, this.y2) >= minSize) {
      if (distanceSq(this.x, this.y, xtest, ytest) <= deltaSq) this.lastHandleGrabbed = 0;
      else if (this.getNumHandles() > 1 && distanceSq(this.x2, this.y2, xtest, ytest) <= deltaSq)
        this.lastHandleGrabbed = 1;
    }
    return this.lastHandleGrabbed;
  }

  /** Squared distance from the mouse, to pick between overlapping boxes; -1 means not a hit. */
  getMouseDistance(gx: number, gy: number): number {
    if (this.getPostCount() === 0)
      return distanceSq(
        gx,
        gy,
        Math.trunc((this.x2 + this.x) / 2),
        Math.trunc((this.y2 + this.y) / 2),
      );
    return lineDistanceSq(this.x, this.y, this.x2, this.y2, gx, gy);
  }

  /** Called when the user finishes dragging out a new element. */
  draggingDone(): void {}

  /** Keyboard shortcut that selects this element for placing (a char code), or 0. */
  getShortcut(): number {
    return 0;
  }

  // ---- edit dialog (upstream Editable) ------------------------------------------------------

  /** Property n for the edit panel, or null past the last one. */
  getEditInfo(_n: number): EditInfo | null {
    return null;
  }

  setEditValue(_n: number, _ei: EditInfo): void {}

  /** Upstream `getInfo(arr)[0]`: the element's kind in lower case ("resistor"), or null. */
  getElmType(): string | null {
    return null;
  }

  getDialogTitle(): string {
    const name = this.getElmType();
    if (name === null) return 'Edit Component';
    return 'Edit ' + name.substring(0, 1).toUpperCase() + name.substring(1);
  }
}

export function distanceSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** Upstream `lineDistanceSq`: squared distance from (gx, gy) to the line through a and b. */
export function lineDistanceSq(
  xa: number,
  ya: number,
  xb: number,
  yb: number,
  gx: number,
  gy: number,
): number {
  const dtop = (yb - ya) * gx - (xb - xa) * gy + xb * ya - yb * xa;
  const dbot = (yb - ya) * (yb - ya) + (xb - xa) * (xb - xa);
  if (dbot === 0) return distanceSq(xa, ya, gx, gy);
  return Math.trunc((dtop * dtop) / dbot);
}

function placeholderNode(v: number): CircuitNode {
  const n = new CircuitNode();
  n.index = -1;
  n.v = v;
  return n;
}

/** How to build one element class, for the loaders. */
export interface ElementType {
  /** Upstream class name (`getClassName()`). */
  className: string;
  /**
   * A new element at (x, y), as the user would place it. `sim` is the simulation it will join;
   * elements with models look them up there (upstream's model maps are global).
   */
  create(x: number, y: number, sim: Simulation): CircuitElm;
  /** An element read from a text-format line; `st` is past the five common fields. */
  load(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    f: number,
    st: StringTokenizer,
    sim: Simulation,
  ): CircuitElm;
}

type ElmConstructor = new (x: number, y: number, x2: number, y2: number, f: number) => CircuitElm;

/** The usual ElementType for a class whose constructor only takes the position. */
export function elementType(className: string, ctor: ElmConstructor): ElementType {
  return {
    className,
    create(x, y, sim) {
      const e = new ctor(x, y, x, y, 0);
      e.sim = sim;
      e.flags = e.getDefaultFlags();
      e.initNew();
      return e;
    },
    load(x1, y1, x2, y2, f, st, sim) {
      const e = new ctor(x1, y1, x2, y2, f);
      e.sim = sim;
      e.undump(st);
      return e;
    },
  };
}

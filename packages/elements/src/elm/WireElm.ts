// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/WireElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/WireElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { Point } from '@circuitjs-next/engine';
import { CircuitElm, elementType, lineDistanceSq } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';

export class WireElm extends CircuitElm {
  static readonly FLAG_SHOWCURRENT = 1;
  static readonly FLAG_SHOWVOLTAGE = 2;
  static readonly FLAG_SHOW_BUS_VALUE = 4;
  static readonly FLAG_SHOW_BUS_VALUE_HEX = 8;

  /** Bits carried; set by bus-width detection (digital buses, not yet ported). */
  busWidth = 1;
  currents: number[] | null = null;

  override getClassName(): string {
    return 'WireElm';
  }
  override getDumpType(): number {
    return 'w'.charCodeAt(0);
  }

  override getPostCount(): number {
    return this.busWidth * 2;
  }
  override getBusWidth(): number {
    return this.busWidth;
  }

  override getPost(n: number): Point {
    if (this.busWidth === 1) return n === 0 ? this.point1 : this.point2;
    if (n < this.busWidth) return new Point(this.point1.x, this.point1.y, n);
    return new Point(this.point2.x, this.point2.y, n - this.busWidth);
  }

  override getConnection(n1: number, n2: number): boolean {
    if (this.busWidth === 1) return true;
    // only connect matching bits: post n1 connects to n1 +/- busWidth
    return Math.abs(n1 - n2) === this.busWidth;
  }

  override getConnectedPost(n: number): Point {
    if (this.busWidth === 1) return n === 0 ? this.point2 : this.point1;
    if (n < this.busWidth) return new Point(this.point2.x, this.point2.y, n);
    return new Point(this.point1.x, this.point1.y, n - this.busWidth);
  }

  override getVoltageDiff(): number {
    return this.nodes[0].v;
  }
  override isWireEquivalent(): boolean {
    return true;
  }
  override isRemovableWire(): boolean {
    return true;
  }

  override setWireCurrent(bit: number, c: number): void {
    if (this.currents !== null) this.currents[bit] = c;
    else this.current = c;
  }

  override getCurrentIntoNode(n: number): number {
    if (this.currents !== null) {
      if (n < this.busWidth) return -this.currents[n];
      return this.currents[n - this.busWidth];
    }
    if (n === 0) return -this.current;
    return this.current;
  }

  mustShowCurrent(): boolean {
    return (this.flags & WireElm.FLAG_SHOWCURRENT) !== 0;
  }
  mustShowVoltage(): boolean {
    return (this.flags & WireElm.FLAG_SHOWVOLTAGE) !== 0;
  }
  mustShowBusValue(): boolean {
    return (this.flags & WireElm.FLAG_SHOW_BUS_VALUE) !== 0;
  }
  mustShowBusValueHex(): boolean {
    return (this.flags & WireElm.FLAG_SHOW_BUS_VALUE_HEX) !== 0;
  }

  override getElmType(): string {
    return this.busWidth > 1 ? 'bus wire (' + this.busWidth + ')' : 'wire';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return EditInfo.createCheckbox('Show Current', this.mustShowCurrent());
    if (n === 1) return EditInfo.createCheckbox('Show Voltage', this.mustShowVoltage());
    if (n === 2) return EditInfo.createCheckbox('Show Bus Value', this.mustShowBusValue());
    if (n === 3) return EditInfo.createCheckbox('Show Bus Value (Hex)', this.mustShowBusValueHex());
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) {
      if (ei.checkbox?.state === true) this.flags |= WireElm.FLAG_SHOWCURRENT;
      else this.flags &= ~WireElm.FLAG_SHOWCURRENT;
    }
    if (n === 1) {
      if (ei.checkbox?.state === true) this.flags |= WireElm.FLAG_SHOWVOLTAGE;
      else this.flags &= ~WireElm.FLAG_SHOWVOLTAGE;
    }
    if (n === 2) this.flags = ei.changeFlag(this.flags, WireElm.FLAG_SHOW_BUS_VALUE);
    if (n === 3) this.flags = ei.changeFlag(this.flags, WireElm.FLAG_SHOW_BUS_VALUE_HEX);
  }

  override getShortcut(): number {
    return 'w'.charCodeAt(0);
  }

  // draggingDone() (splitting a new wire at posts it crosses) needs the element list; the
  // editor does it.

  /** Wires are only hit near the line itself. */
  override getMouseDistance(gx: number, gy: number): number {
    const thresh = 10;
    const d2 = lineDistanceSq(this.x, this.y, this.x2, this.y2, gx, gy);
    if (d2 <= thresh * thresh) return d2;
    return -1;
  }
}

export const WireElmType = elementType('WireElm', WireElm);

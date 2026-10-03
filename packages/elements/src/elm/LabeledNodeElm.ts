// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/LabeledNodeElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/LabeledNodeElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { Point, type CircuitNode, type WireSegment } from '@circuitjs-next/engine';
import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { unescapeToken } from '../escape.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

/** Named node: every label with the same text is one node. */
export class LabeledNodeElm extends CircuitElm {
  static readonly FLAG_ESCAPE = 4;
  static readonly FLAG_INTERNAL = 1;
  static readonly FLAG_ROTATE_TEXT = 8;

  text = 'label';
  /** Bits carried; set by bus-width detection (digital buses, not yet ported). */
  busWidth = 1;
  currents: number[] | null = null;

  override getClassName(): string {
    return 'LabeledNodeElm';
  }
  override getDumpType(): number {
    return 207;
  }
  override getXmlDumpType(): string {
    return 'ln';
  }

  override undump(st: StringTokenizer): void {
    this.text = st.nextToken();
    if ((this.flags & LabeledNodeElm.FLAG_ESCAPE) === 0) {
      // old-style dump before escape/unescape
      while (st.hasMoreTokens()) this.text += ' ' + st.nextToken();
    } else {
      // new-style dump
      this.text = unescapeToken(this.text);
    }
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('te', this.text);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.text = r.parseStringAttr('te', this.text);
  }

  isInternal(): boolean {
    return (this.flags & LabeledNodeElm.FLAG_INTERNAL) !== 0;
  }

  private labelKey(n: number): string {
    return this.busWidth > 1 ? `${this.text}:${n}` : this.text;
  }

  /**
   * The first time wire closure meets a label name, remember our post and return null; later
   * labels with that name return it, so all of them share one node.
   */
  override getConnectedPost(n: number): Point | null {
    const key = this.labelKey(n);
    const le = this.sim.labelList.get(key);
    if (le !== undefined) return le.point;
    this.sim.labelList.set(key, { point: this.getPost(n), node: null });
    return null;
  }

  override setNode(p: number, n: CircuitNode): void {
    super.setNode(p, n);
    // save node so the label can be looked up by name
    const le = this.sim.labelList.get(this.labelKey(p));
    if (le !== undefined) le.node = n;
  }

  override getPostCount(): number {
    return this.busWidth;
  }
  override getBusWidth(): number {
    return this.busWidth;
  }
  override getPost(n: number): Point {
    if (this.busWidth === 1) return this.point1;
    return new Point(this.point1.x, this.point1.y, n);
  }

  override getWireSegments(list: WireSegment[]): void {
    for (let b = 0; b < this.busWidth; b++) {
      const ep0 = this.getPost(b).key();
      const ep1 = this.busWidth > 1 ? `label:${this.text}:${b}` : `label:${this.text}`;
      list.push(this.sim.newWireSegment(this, b, ep0, ep1));
    }
  }

  // basically a wire, since it just connects two or more nodes together
  override isWireEquivalent(): boolean {
    return true;
  }
  override isRemovableWire(): boolean {
    return true;
  }
  override isLabeledNodeElm(): boolean {
    return true;
  }
  override getConnection(n1: number, n2: number): boolean {
    return n1 === n2;
  }

  override getCurrentIntoNode(n: number): number {
    if (this.currents !== null) return -this.currents[n];
    return -this.current;
  }

  override setWireCurrent(bit: number, c: number): void {
    if (this.currents !== null) this.currents[bit] = c;
    else this.current = c;
  }

  override getVoltageDiff(): number {
    return this.nodes[0].v;
  }

  isRotateText(): boolean {
    return (this.flags & LabeledNodeElm.FLAG_ROTATE_TEXT) !== 0;
  }

  override getShortcut(): number {
    return 'b'.charCodeAt(0);
  }

  override getElmType(): string {
    return 'Labeled Node';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) {
      const ei = new EditInfo('Text', 0, -1, -1);
      ei.text = this.text;
      return ei;
    }
    if (n === 1) return EditInfo.createCheckbox('Internal Node', this.isInternal());
    if (n === 2) return EditInfo.createCheckbox('Rotate Text When Vertical', this.isRotateText());
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) this.text = ei.text ?? '';
    if (n === 1) this.flags = ei.changeFlag(this.flags, LabeledNodeElm.FLAG_INTERNAL);
    if (n === 2) this.flags = ei.changeFlag(this.flags, LabeledNodeElm.FLAG_ROTATE_TEXT);
  }
}

export const LabeledNodeElmType = elementType('LabeledNodeElm', LabeledNodeElm);

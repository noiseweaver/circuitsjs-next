// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/ResistorElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/ResistorElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { parseJavaDouble } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

export class ResistorElm extends CircuitElm {
  resistance = 0;

  override getClassName(): string {
    return 'ResistorElm';
  }
  override getDumpType(): number {
    return 'r'.charCodeAt(0);
  }

  override initNew(): void {
    this.resistance = 1000;
  }

  override undump(st: StringTokenizer): void {
    this.resistance = parseJavaDouble(st.nextToken());
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('r', this.resistance);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.resistance = r.parseDoubleAttr('r', this.resistance);
  }

  override calculateCurrent(): void {
    this.current = (this.nodes[0].v - this.nodes[1].v) / this.resistance;
  }

  override stamp(): void {
    this.sim.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
  }

  override getElmType(): string {
    return 'resistor';
  }

  override getEditInfo(n: number): EditInfo | null {
    // ohmString doesn't work here on linux
    if (n === 0) return new EditInfo('Resistance (ohms)', this.resistance, 0, 0);
    return null;
  }

  override setEditValue(_n: number, ei: EditInfo): void {
    this.resistance = ei.value <= 0 ? 1e-9 : ei.value;
  }

  override getShortcut(): number {
    return 'r'.charCodeAt(0);
  }
}

export const ResistorElmType = elementType('ResistorElm', ResistorElm);

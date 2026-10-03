// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/OutputElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/OutputElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { SCALE_AUTO } from '../constants.ts';
import { parseJavaInt } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

/** One-post voltage readout. */
export class OutputElm extends CircuitElm {
  static readonly FLAG_VALUE = 1;
  static readonly FLAG_FIXED = 2;

  scale = 0;

  override getClassName(): string {
    return 'OutputElm';
  }
  override getDumpType(): number {
    return 'O'.charCodeAt(0);
  }

  override initNew(): void {
    this.scale = SCALE_AUTO;
  }

  override undump(st: StringTokenizer): void {
    this.scale = SCALE_AUTO;
    try {
      this.scale = parseJavaInt(st.nextToken());
    } catch {
      // older files stop early
    }
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('sc', this.scale);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.scale = r.parseIntAttr('sc', this.scale);
  }

  override getPostCount(): number {
    return 1;
  }

  override getVoltageDiff(): number {
    return this.nodes[0].v;
  }

  override getElmType(): string {
    return 'output';
  }

  isFixed(): boolean {
    return (this.flags & OutputElm.FLAG_FIXED) !== 0;
  }
  showVoltage(): boolean {
    return (this.flags & OutputElm.FLAG_VALUE) !== 0;
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return EditInfo.createCheckbox('Show Voltage', this.showVoltage());
    if (!this.showVoltage()) return null;
    if (n === 1) return EditInfo.createChoice('Scale', ['Auto', 'V', 'mV', 'μV'], this.scale);
    if (this.scale === SCALE_AUTO) return null;
    if (n === 2) return EditInfo.createCheckbox('Fixed Precision', this.isFixed());
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) {
      this.flags = ei.changeFlag(this.flags, OutputElm.FLAG_VALUE);
      ei.newDialog = true;
    }
    if (n === 1) {
      this.scale = ei.choice?.selected ?? 0;
      ei.newDialog = true;
    }
    if (n === 2) this.flags = ei.changeFlag(this.flags, OutputElm.FLAG_FIXED);
  }
}

export const OutputElmType = elementType('OutputElm', OutputElm);

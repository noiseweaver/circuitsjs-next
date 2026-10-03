// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/SwitchElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/SwitchElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { unescapeToken } from '../escape.ts';
import { parseJavaBoolean, parseJavaInt } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

/** SPST switch. Position 0 is closed, 1 is open. */
export class SwitchElm extends CircuitElm {
  static readonly COMPOSITE_CLOSED_R = 0.001;
  static readonly FLAG_IEC = 2;
  static readonly FLAG_LABEL = 4;

  momentary = false;
  position = 0;
  posCount = 0;
  resistance = 0;
  /** Switches with the same label toggle together. */
  label: string | null = null;
  keyShortcut: string | null = null;

  override getClassName(): string {
    return 'SwitchElm';
  }
  override getDumpType(): number {
    return 's'.charCodeAt(0);
  }

  override initNew(): void {
    this.momentary = false;
    this.position = 0;
    this.posCount = 2;
  }

  /** Text `true`/`false` positions are inverted for logic inputs (a subclass, not ported yet). */
  protected isLogicInput(): boolean {
    return false;
  }

  override undump(st: StringTokenizer): void {
    const str = st.nextToken();
    if (str === 'true') this.position = this.isLogicInput() ? 0 : 1;
    else if (str === 'false') this.position = this.isLogicInput() ? 1 : 0;
    else this.position = parseJavaInt(str);
    this.momentary = parseJavaBoolean(st.nextToken());
    this.posCount = 2;
    this.label = null;
    if ((this.flags & SwitchElm.FLAG_LABEL) !== 0) this.label = unescapeToken(st.nextToken());
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    if (this.position !== 0) w.dumpAttr('p', this.position);
    if (this.momentary) w.dumpAttr('mm', this.momentary);
    if (this.label !== null) w.dumpAttr('lab', this.label);
    if (this.keyShortcut !== null) w.dumpAttr('key', this.keyShortcut);
    if (this.resistance !== 0) w.dumpAttr('r', this.resistance);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.position = r.parseIntAttr('p', this.position);
    this.momentary = r.parseBooleanAttr('mm', this.momentary);
    this.label = r.parseStringAttr('lab', this.label);
    this.keyShortcut = r.parseStringAttr('key', this.keyShortcut);
    this.resistance = r.parseDoubleAttr('r', 0);
  }

  simpleToggle(): void {
    this.position++;
    if (this.position >= this.posCount) this.position = 0;
  }

  /**
   * Flip the switch, and every other switch with the same label. The caller must have the
   * circuit analyzed again (upstream `needAnalyze`).
   */
  toggle(): void {
    this.simpleToggle();
    if (this.label === null) return;
    for (const o of this.sim.elmList) {
      if (o instanceof SwitchElm && o !== this && this.label === o.label) o.simpleToggle();
    }
  }

  override calculateCurrent(): void {
    if (this.position === 1) this.current = 0;
    else if (this.resistance > 0)
      this.current = (this.nodes[0].v - this.nodes[1].v) / this.resistance;
    else if (this.parent !== null)
      this.current = (this.nodes[0].v - this.nodes[1].v) / SwitchElm.COMPOSITE_CLOSED_R;
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return this.position === 0;
  }
  override isWireEquivalent(): boolean {
    return this.position === 0 && this.parent === null && this.resistance === 0;
  }
  override isRemovableWire(): boolean {
    return this.position === 0 && this.parent === null && this.resistance === 0;
  }

  override stamp(): void {
    if (this.position === 0) {
      if (this.resistance > 0)
        this.sim.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
      else if (this.parent !== null)
        this.sim.stampResistor(this.nodes[0], this.nodes[1], SwitchElm.COMPOSITE_CLOSED_R);
    }
  }

  useIECSymbol(): boolean {
    return (this.flags & SwitchElm.FLAG_IEC) !== 0;
  }

  override getElmType(): string {
    return 'switch (SPST)';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return EditInfo.createCheckbox('Momentary Switch', this.momentary);
    if (n === 1) return EditInfo.createCheckbox('IEC Symbol', this.useIECSymbol());
    if (n === 2) return EditInfo.text('Label (for linking)', this.label ?? '');
    if (n === 3) return this.getKeyShortcutEditInfo();
    if (n === 4) {
      const ei = new EditInfo('On Resistance (ohms)', this.resistance);
      ei.setNonNegative();
      return ei;
    }
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) this.momentary = ei.checkbox?.state === true;
    if (n === 1) {
      this.flags = ei.changeFlag(this.flags, SwitchElm.FLAG_IEC);
      this.setPoints();
    }
    if (n === 2) {
      const label = ei.text ?? '';
      if (label.length === 0) {
        this.label = null;
        this.flags &= ~SwitchElm.FLAG_LABEL;
      } else {
        this.label = label;
        this.flags |= SwitchElm.FLAG_LABEL;
      }
    }
    if (n === 3) this.setKeyShortcutEditValue(ei);
    if (n === 4) this.resistance = ei.value;
  }

  // helper methods for keyboard shortcut edit field, usable by subclasses
  getKeyShortcutEditInfo(): EditInfo {
    return EditInfo.text('Keyboard Shortcut', this.keyShortcut ?? '');
  }

  setKeyShortcutEditValue(ei: EditInfo): void {
    const s = (ei.text ?? '').trim();
    if (s.length === 0) this.keyShortcut = null;
    else this.keyShortcut = s.substring(0, 1).toLowerCase();
  }

  override getShortcut(): number {
    return 's'.charCodeAt(0);
  }
}

export const SwitchElmType = elementType('SwitchElm', SwitchElm);

// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/GroundElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/GroundElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import type { Point } from '@circuitjs-next/engine';
import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { parseJavaInt } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

export class GroundElm extends CircuitElm {
  /** Needed for old subcircuits which have GroundElm dumped. */
  static readonly FLAG_OLD_STYLE = 1;

  /** Symbol of the last ground edited; new grounds start with it (upstream static). */
  static lastSymbolType = 0;

  /** 0 earth, 1 chassis, 2 signal, 3 common. */
  symbolType = 0;

  override getClassName(): string {
    return 'GroundElm';
  }
  override getDumpType(): number {
    return 'g'.charCodeAt(0);
  }

  override initNew(): void {
    this.symbolType = GroundElm.lastSymbolType;
  }

  override getDragVertical(_requestedVertical: boolean): boolean {
    return true;
  }

  override undump(st: StringTokenizer): void {
    if (st.hasMoreTokens()) {
      try {
        this.symbolType = parseJavaInt(st.nextToken());
      } catch {
        // keep the default
      }
    }
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    if (this.symbolType !== 0) w.dumpAttr('sy', this.symbolType);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.symbolType = r.parseIntAttr('sy', 0);
  }

  override getPostCount(): number {
    return 1;
  }

  isOldStyle(): boolean {
    return (this.flags & GroundElm.FLAG_OLD_STYLE) !== 0;
  }
  override getVoltageSourceCount(): number {
    return this.isOldStyle() ? 1 : 0;
  }
  override stamp(): void {
    if (this.isOldStyle())
      this.sim.stampVoltageSource(this.sim.ground, this.nodes[0], this.voltSource, 0);
  }
  override setCurrent(_vs: unknown, c: number): void {
    this.current = this.isOldStyle() ? -c : c;
  }

  override isWireEquivalent(): boolean {
    return true;
  }
  override isRemovableWire(): boolean {
    return true;
  }
  override isGroundElm(): boolean {
    return true;
  }

  /** All grounds connect to the first one seen during wire closure. */
  override getConnectedPost(_n: number): Point | null {
    if (this.sim.firstGround !== null) return this.sim.firstGround;
    this.sim.firstGround = this.point1;
    return null;
  }

  override getVoltageDiff(): number {
    return 0;
  }
  override hasGroundConnection(_n1: number): boolean {
    return true;
  }
  override getCurrentIntoNode(_n: number): number {
    return -this.current;
  }

  override getElmType(): string {
    return 'ground';
  }

  override getShortcut(): number {
    return 'g'.charCodeAt(0);
  }
  override getDragLength(): number {
    return 32;
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) {
      const ei = EditInfo.createChoice(
        'Symbol',
        ['Earth', 'Chassis', 'Signal', 'Common'],
        this.symbolType,
      );
      return ei;
    }
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) GroundElm.lastSymbolType = this.symbolType = ei.choice?.selected ?? 0;
  }
}

export const GroundElmType = elementType('GroundElm', GroundElm);

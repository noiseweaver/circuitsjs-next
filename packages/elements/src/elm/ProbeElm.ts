// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/ProbeElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/ProbeElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { SCALE_AUTO } from '../constants.ts';
import { parseJavaDouble, parseJavaInt } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

/**
 * Voltmeter between two posts, optionally with a finite input resistance. The measurement
 * statistics (RMS, min/max, frequency) are display only and come with scopes (Phase 6).
 */
export class ProbeElm extends CircuitElm {
  static readonly FLAG_SHOWVOLTAGE = 1;
  static readonly FLAG_CIRCLE = 2;
  static readonly TP_VOL = 0;
  static readonly TP_RMS = 1;
  static readonly TP_MAX = 2;
  static readonly TP_MIN = 3;
  static readonly TP_P2P = 4;
  static readonly TP_BIN = 5;
  static readonly TP_FRQ = 6;
  static readonly TP_PER = 7;
  static readonly TP_PWI = 8;
  /** Mark to space ratio. */
  static readonly TP_DUT = 9;
  static readonly TP_AVG = 10;

  meter = 0;
  scale = 0;
  resistance = 0;

  override getClassName(): string {
    return 'ProbeElm';
  }
  override getDumpType(): number {
    return 'p'.charCodeAt(0);
  }

  override initNew(): void {
    this.meter = ProbeElm.TP_VOL;
    // default for new elements
    this.flags = ProbeElm.FLAG_SHOWVOLTAGE | ProbeElm.FLAG_CIRCLE;
    this.scale = SCALE_AUTO;
    this.resistance = 1e7;
  }

  override undump(st: StringTokenizer): void {
    this.meter = ProbeElm.TP_VOL;
    this.scale = SCALE_AUTO;
    this.resistance = 0;
    try {
      this.meter = parseJavaInt(st.nextToken());
      this.scale = parseJavaInt(st.nextToken());
      this.resistance = parseJavaDouble(st.nextToken());
    } catch {
      // older files stop early
    }
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('me', this.meter);
    w.dumpAttr('sc', this.scale);
    w.dumpAttr('re', this.resistance);
  }

  override undumpXml(r: XmlAttrReader): void {
    this.flags = 0;
    super.undumpXml(r);
    this.meter = r.parseIntAttr('me', this.meter);
    this.scale = r.parseIntAttr('sc', this.scale);
    this.resistance = r.parseDoubleAttr('re', 0);
  }

  override calculateCurrent(): void {
    this.current =
      this.resistance === 0 ? 0 : (this.nodes[0].v - this.nodes[1].v) / this.resistance;
  }

  override stamp(): void {
    if (this.resistance !== 0)
      this.sim.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return this.resistance !== 0;
  }

  mustShowVoltage(): boolean {
    return (this.flags & ProbeElm.FLAG_SHOWVOLTAGE) !== 0;
  }
  drawAsCircle(): boolean {
    return (this.flags & ProbeElm.FLAG_CIRCLE) !== 0;
  }

  override getElmType(): string {
    return 'voltmeter';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return EditInfo.createCheckbox('Show Value', this.mustShowVoltage());
    if (n === 1) {
      // TP_AVG's value isn't contiguous with the other meter constants shown here (it was
      // appended after TP_DUT to avoid renumbering saved circuits), so map it explicitly.
      // Frequency, Period, Pulse Width and Duty Cycle are commented out upstream.
      return EditInfo.createChoice(
        'Value',
        [
          'Voltage',
          'RMS Voltage',
          'Average Voltage',
          'Max Voltage',
          'Min Voltage',
          'P2P Voltage',
          'Binary Value',
        ],
        this.meterChoiceIndex(this.meter),
      );
    }
    if (n === 2) return EditInfo.createChoice('Scale', ['Auto', 'V', 'mV', 'μV'], this.scale);
    if (n === 3) return EditInfo.createCheckbox('Use Circle Symbol', this.drawAsCircle());
    if (n === 4) return new EditInfo('Series Resistance (0 = infinite)', this.resistance);
    return null;
  }

  meterChoices(): number[] {
    return [
      ProbeElm.TP_VOL,
      ProbeElm.TP_RMS,
      ProbeElm.TP_AVG,
      ProbeElm.TP_MAX,
      ProbeElm.TP_MIN,
      ProbeElm.TP_P2P,
      ProbeElm.TP_BIN,
    ];
  }

  meterChoiceIndex(m: number): number {
    const choices = this.meterChoices();
    for (let i = 0; i !== choices.length; i++) if (choices[i] === m) return i;
    return 0;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) {
      // upstream assigns (not ORs) the flag here, clearing FLAG_CIRCLE
      if (ei.checkbox?.state === true) this.flags = ProbeElm.FLAG_SHOWVOLTAGE;
      else this.flags &= ~ProbeElm.FLAG_SHOWVOLTAGE;
    }
    if (n === 1) this.meter = this.meterChoices()[ei.choice?.selected ?? 0];
    if (n === 2) this.scale = ei.choice?.selected ?? 0;
    if (n === 3) this.flags = ei.changeFlag(this.flags, ProbeElm.FLAG_CIRCLE);
    if (n === 4) this.resistance = ei.value;
  }
}

export const ProbeElmType = elementType('ProbeElm', ProbeElm);

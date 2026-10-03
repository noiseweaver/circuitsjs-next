// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/CapacitorElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/CapacitorElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { FindPathInfo, PathType } from '@circuitjs-next/engine';
import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { parseJavaDouble } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

export class CapacitorElm extends CircuitElm {
  static readonly FLAG_BACK_EULER = 2;
  static readonly FLAG_RESISTANCE = 4;

  capacitance = 0;
  compResistance = 0;
  voltdiff = 0;
  seriesResistance = 0;
  initialVoltage = 0;
  capNode2 = 0;
  curSourceValue = 0;

  override getClassName(): string {
    return 'CapacitorElm';
  }
  override getDumpType(): number {
    return 'c'.charCodeAt(0);
  }

  override initNew(): void {
    this.capacitance = 1e-5;
    this.initialVoltage = 1e-3;
  }

  override undump(st: StringTokenizer): void {
    this.capacitance = parseJavaDouble(st.nextToken());
    this.voltdiff = parseJavaDouble(st.nextToken());
    this.initialVoltage = 1e-3;
    try {
      this.initialVoltage = parseJavaDouble(st.nextToken());
      if ((this.flags & CapacitorElm.FLAG_RESISTANCE) !== 0)
        this.seriesResistance = parseJavaDouble(st.nextToken());
    } catch {
      // older files stop early
    }
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('c', this.capacitance);
    w.dumpAttr('iv', this.initialVoltage);
    w.dumpAttr('sr', this.seriesResistance);
  }

  override dumpXmlState(w: XmlAttrWriter): void {
    w.dumpAttr('vd', this.voltdiff);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.capacitance = r.parseDoubleAttr('c', this.capacitance);
    this.initialVoltage = r.parseDoubleAttr('iv', this.initialVoltage);
    this.seriesResistance = r.parseDoubleAttr('sr', this.seriesResistance);
    this.voltdiff = r.parseDoubleAttr('vd', this.voltdiff);
  }

  isTrapezoidal(): boolean {
    return (this.flags & CapacitorElm.FLAG_BACK_EULER) === 0;
  }

  override reset(): void {
    super.reset();
    this.current = this.curSourceValue = 0;
    // put small charge on caps when reset to start oscillators
    this.voltdiff = this.initialVoltage;
  }

  shorted(): void {
    super.reset();
    this.voltdiff = this.current = this.curSourceValue = 0;
  }

  override stamp(): void {
    const sim = this.sim;
    if (this.doDcAnalysis()) {
      // when finding DC operating point, replace cap with a 100M resistor
      sim.stampResistor(this.nodes[0], this.nodes[1], 1e8);
      this.curSourceValue = 0;
      this.capNode2 = 1;
      return;
    }

    // The capacitor model is between nodes 0 and capNode2. For an ideal capacitor, capNode2 is
    // node 1. With series resistance, capNode2 is internal node 2 and a resistor joins 2 and 1.
    this.capNode2 = this.seriesResistance > 0 ? 2 : 1;

    // companion model (Norton equivalent): a current source in parallel with a resistor.
    // Trapezoidal is more accurate than backward Euler but can oscillate if RC is small
    // relative to the timestep.
    if (this.isTrapezoidal()) this.compResistance = sim.timeStep / (2 * this.capacitance);
    else this.compResistance = sim.timeStep / this.capacitance;
    sim.stampResistor(this.nodes[0], this.nodes[this.capNode2], this.compResistance);
    sim.stampRightSide(this.nodes[0]);
    sim.stampRightSide(this.nodes[this.capNode2]);
    if (this.seriesResistance > 0)
      sim.stampResistor(this.nodes[1], this.nodes[2], this.seriesResistance);
  }

  override startIteration(): void {
    if (this.isTrapezoidal())
      this.curSourceValue = -this.voltdiff / this.compResistance - this.current;
    else this.curSourceValue = -this.voltdiff / this.compResistance;
  }

  override stepFinished(): void {
    this.voltdiff = this.nodes[0].v - this.nodes[this.capNode2].v;
    this.calculateCurrent();
  }

  /**
   * Do not calculate current here; that only happens in stepFinished(). Otherwise
   * calculateCurrent() may run while stamping the circuit, which could discharge the cap (that
   * current feeds curSourceValue in startIteration).
   */
  override nodeVoltageChanged(_post: number): void {}

  override calculateCurrent(): void {
    const voltdiff = this.nodes[0].v - this.nodes[this.capNode2].v;
    if (this.doDcAnalysis()) {
      this.current = voltdiff / 1e8;
      return;
    }
    // compResistance is 0 before stamp() has run; avoid infinite current
    if (this.compResistance > 0)
      this.current = voltdiff / this.compResistance + this.curSourceValue;
  }

  override doStep(): void {
    if (this.doDcAnalysis()) return;
    this.sim.stampCurrentSource(this.nodes[0], this.nodes[this.capNode2], this.curSourceValue);
  }

  override getInternalNodeCount(): number {
    return !this.doDcAnalysis() && this.seriesResistance > 0 ? 1 : 0;
  }

  override isIdealCapacitor(): boolean {
    return this.seriesResistance === 0;
  }

  override validate(): boolean {
    if (this.isIdealCapacitor()) {
      let fpi = new FindPathInfo(PathType.SHORT, this, this.getNode(1), this.sim);
      if (fpi.findPath(this.getNode(0))) {
        this.shorted();
      } else {
        fpi = new FindPathInfo(PathType.CAP_V, this, this.getNode(1), this.sim);
        if (fpi.findPath(this.getNode(0))) {
          // loop of ideal capacitors; set a small series resistance to avoid oscillation in
          // case one of them has voltage on it
          this.seriesResistance = 0.1;
          return false;
        }
      }
    }
    return true;
  }

  override getElmType(): string {
    return 'capacitor';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return new EditInfo('Capacitance (F)', this.capacitance, 1e-6, 1e-3);
    if (n === 1) return EditInfo.createCheckbox('Trapezoidal Approximation', this.isTrapezoidal());
    if (n === 2) return new EditInfo('Initial Voltage (on Reset)', this.initialVoltage);
    if (n === 3) return new EditInfo('Series Resistance', this.seriesResistance);
    // if you add more things here, check PolarCapacitorElm
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) this.capacitance = ei.value > 0 ? ei.value : 1e-12;
    if (n === 1) {
      if (ei.checkbox?.state === true) this.flags &= ~CapacitorElm.FLAG_BACK_EULER;
      else this.flags |= CapacitorElm.FLAG_BACK_EULER;
    }
    if (n === 2) this.initialVoltage = ei.value;
    if (n === 3) {
      this.seriesResistance = ei.value;
      this.allocNodes();
    }
  }

  override getShortcut(): number {
    return 'c'.charCodeAt(0);
  }
}

export const CapacitorElmType = elementType('CapacitorElm', CapacitorElm);

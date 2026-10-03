// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/CurrentElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/CurrentElm.ts (dev-ts) at
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

export class CurrentElm extends CircuitElm {
  currentValue = 0;
  /** Compliance voltage. 0 = unlimited (ideal current source). */
  maxVoltage = 0;
  lastVoltDiff = 0;
  broken = false;

  override getClassName(): string {
    return 'CurrentElm';
  }
  override getDumpType(): number {
    return 'i'.charCodeAt(0);
  }

  override initNew(): void {
    this.currentValue = 0.01;
    this.maxVoltage = 0;
  }

  override undump(st: StringTokenizer): void {
    try {
      this.currentValue = parseJavaDouble(st.nextToken());
      this.maxVoltage = parseJavaDouble(st.nextToken());
    } catch {
      // older files stop early
    }
    if (this.currentValue === 0) this.currentValue = 0.01;
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('cu', this.currentValue);
    if (this.maxVoltage > 0) w.dumpAttr('mv', this.maxVoltage);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.currentValue = r.parseDoubleAttr('cu', this.currentValue);
    this.maxVoltage = r.parseDoubleAttr('mv', 0);
  }

  isVoltageLimited(): boolean {
    return this.maxVoltage > 0;
  }
  override nonLinear(): boolean {
    return this.isVoltageLimited();
  }
  override isCurrentElm(): boolean {
    return true;
  }

  override reset(): void {
    super.reset();
    this.lastVoltDiff = 0;
  }

  /** analyzeCircuit determines whether the source has a current path. */
  setBroken(b: boolean): void {
    this.broken = b && !this.isVoltageLimited();
  }

  /** Stamping waits until we know whether there is a current path. */
  override stamp(): void {
    const sim = this.sim;
    if (this.broken) {
      // no current path; stamping a current source would cause a matrix error
      sim.stampResistor(this.nodes[0], this.nodes[1], 1e8);
      this.current = 0;
    } else if (this.isVoltageLimited()) {
      // nonlinear; doStep() handles the smooth-saturation companion model
      sim.stampNonLinear(this.nodes[0]);
      sim.stampNonLinear(this.nodes[1]);
    } else {
      // ideal current source
      sim.stampCurrentSource(this.nodes[0], this.nodes[1], this.currentValue);
      this.current = this.currentValue;
    }
  }

  /**
   * Smooth voltage compliance via tanh-shaped saturation, from 0.95*maxVoltage to maxVoltage.
   * tanh is centered at 0.975*maxVoltage with scale vt = vWidth/5.
   */
  override doStep(): void {
    if (this.broken || !this.isVoltageLimited()) return;
    const sim = this.sim;
    const maxVoltage = this.maxVoltage;
    let vd = this.nodes[1].v - this.nodes[0].v;
    const vStart = 0.95 * maxVoltage; // transition begins here
    const vWidth = maxVoltage - vStart; // = 0.05 * maxVoltage
    const vMid = (vStart + maxVoltage) / 2.0; // = 0.975 * maxVoltage
    const vt = Math.max(vWidth / 5.0, 1e-3);

    // step-size limit: don't cross the transition region in one Newton step
    if (this.lastVoltDiff < vStart && vd > vStart) {
      // approaching from the low side: stop at the entry boundary
      vd = vStart;
      sim.converged = false;
    } else if (this.lastVoltDiff > maxVoltage && vd < maxVoltage) {
      // approaching from the high side: stop at the exit boundary
      vd = maxVoltage;
      sim.converged = false;
    } else if (this.lastVoltDiff >= vStart && this.lastVoltDiff <= maxVoltage) {
      // inside the transition: fine-step so we don't skip out the other side
      const maxStep = Math.max(vWidth / 4.0, 0.01);
      if (vd > this.lastVoltDiff + maxStep) {
        vd = this.lastVoltDiff + maxStep;
        sim.converged = false;
      } else if (vd < this.lastVoltDiff - maxStep) {
        vd = this.lastVoltDiff - maxStep;
        sim.converged = false;
      }
    }
    this.lastVoltDiff = vd;

    const arg = (vd - vMid) / vt;
    const tanhArg = Math.tanh(arg);
    const i = this.currentValue * 0.5 * (1.0 - tanhArg);
    const sech2 = 1.0 - tanhArg * tanhArg;
    const g = ((-this.currentValue * 0.5 * sech2) / vt) * vd;

    // Norton companion: parallel resistor (1/|g|) plus adjusted current source. The gmin floor
    // keeps the resistance finite when sech^2 vanishes, so the matrix stays non-singular.
    const absG = Math.abs(g) + 1e-6;
    sim.stampResistor(this.nodes[0], this.nodes[1], 1.0 / absG);
    sim.stampCurrentSource(this.nodes[0], this.nodes[1], i - g * vd);
    this.current = i;
  }

  override getVoltageDiff(): number {
    return this.nodes[1].v - this.nodes[0].v;
  }

  override validate(): boolean {
    const fpi = new FindPathInfo(PathType.INDUCT, this, this.getNode(1), this.sim);
    this.setBroken(!fpi.findPath(this.getNode(0)));
    return true;
  }

  override getElmType(): string {
    return 'current source';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return new EditInfo('Current (A)', this.currentValue, 0, 0.1);
    if (n === 1)
      return new EditInfo('Max Voltage (V, 0=unlimited)', this.maxVoltage, 0, 0).setUnitStep();
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) this.currentValue = ei.value;
    if (n === 1 && ei.value >= 0) this.maxVoltage = ei.value;
  }
}

export const CurrentElmType = elementType('CurrentElm', CurrentElm);

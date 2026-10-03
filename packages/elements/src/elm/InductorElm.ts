// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/InductorElm.java and Inductor.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/InductorElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { FindPathInfo, PathType, type CircuitNode, type SimElement } from '@circuitjs-next/engine';
import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { parseJavaDouble } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

/** Inductor companion model, shared with transformers and relays (upstream `Inductor`). */
export class Inductor {
  static readonly FLAG_BACK_EULER = 2;

  nodes: CircuitNode[] = [];
  flags = 0;
  inductance = 0;
  compResistance = 0;
  current = 0;
  curSourceValue = 0;
  /** 0 = disabled (linear), >0 = saturation onset current (A). */
  saturationCurrent = 0;
  private readonly owner: SimElement;

  constructor(owner: SimElement) {
    this.owner = owner;
  }

  private get sim() {
    return this.owner.sim;
  }

  setup(ic: number, cr: number, f: number, isat?: number): void {
    this.inductance = ic;
    this.current = cr;
    this.flags = f;
    if (isat !== undefined) this.saturationCurrent = isat;
  }

  isTrapezoidal(): boolean {
    return (this.flags & Inductor.FLAG_BACK_EULER) === 0;
  }

  reset(): void {
    this.resetTo(0);
  }

  resetTo(c: number): void {
    // set curSourceValue too: if a node is ground, calculateCurrent() may run (from the node
    // voltage update) during analysis, before startIteration()
    this.curSourceValue = this.current = c;
  }

  /** Effective inductance with saturation: L(I) = L0 / (1 + (I/Isat)^2). */
  calcEffectiveInductance(i: number): number {
    if (this.saturationCurrent <= 0) return this.inductance;
    const ratio = i / this.saturationCurrent;
    return this.inductance / (1 + ratio * ratio);
  }

  stamp(n0: CircuitNode, n1: CircuitNode): void {
    // companion model (Norton equivalent): a current source in parallel with a resistor.
    // Trapezoidal is more accurate than backward Euler but can oscillate, a real problem in
    // circuits with switches.
    this.nodes[0] = n0;
    this.nodes[1] = n1;
    const sim = this.sim;
    if (this.saturationCurrent > 0) {
      // nonlinear: conductance changes with current, stamped in doStep()
      sim.stampNonLinear(n0);
      sim.stampNonLinear(n1);
    } else {
      if (this.isTrapezoidal()) this.compResistance = (2 * this.inductance) / sim.timeStep;
      else this.compResistance = this.inductance / sim.timeStep;
      sim.stampResistor(n0, n1, this.compResistance);
    }
    sim.stampRightSide(n0);
    sim.stampRightSide(n1);
  }

  nonLinear(): boolean {
    return this.saturationCurrent > 0;
  }

  startIteration(voltdiff: number): void {
    if (this.saturationCurrent > 0) {
      // recompute companion resistance from current-dependent inductance
      const lEff = this.calcEffectiveInductance(this.current);
      if (this.isTrapezoidal()) this.compResistance = (2 * lEff) / this.sim.timeStep;
      else this.compResistance = lEff / this.sim.timeStep;
    }
    if (this.isTrapezoidal()) this.curSourceValue = voltdiff / this.compResistance + this.current;
    else this.curSourceValue = this.current;
  }

  calculateCurrent(voltdiff: number): number {
    // compResistance is 0 before stamp() has run; avoid infinite current
    if (this.compResistance > 0)
      this.current = voltdiff / this.compResistance + this.curSourceValue;
    return this.current;
  }

  doStep(_voltdiff: number): void {
    // matrix was restored to origMatrix; stamp the current-dependent conductance
    if (this.saturationCurrent > 0)
      this.sim.stampConductance(this.nodes[0], this.nodes[1], 1.0 / this.compResistance);
    this.sim.stampCurrentSource(this.nodes[0], this.nodes[1], this.curSourceValue);
  }
}

export class InductorElm extends CircuitElm {
  ind = new Inductor(this);
  inductance = 0;
  initialCurrent = 0;
  /** 0 = disabled (linear). */
  saturationCurrent = 0;

  override getClassName(): string {
    return 'InductorElm';
  }
  override getDumpType(): number {
    return 'l'.charCodeAt(0);
  }

  override initNew(): void {
    this.inductance = 1;
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  override undump(st: StringTokenizer): void {
    this.inductance = parseJavaDouble(st.nextToken());
    this.current = parseJavaDouble(st.nextToken());
    try {
      this.initialCurrent = parseJavaDouble(st.nextToken());
      this.saturationCurrent = parseJavaDouble(st.nextToken());
    } catch {
      // older files stop early
    }
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('l', this.inductance);
    w.dumpAttr('ic', this.initialCurrent);
    if (this.saturationCurrent !== 0) w.dumpAttr('isat', this.saturationCurrent);
  }

  override dumpXmlState(w: XmlAttrWriter): void {
    w.dumpAttr('i', this.current);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.inductance = r.parseDoubleAttr('l', this.inductance);
    this.initialCurrent = r.parseDoubleAttr('ic', this.initialCurrent);
    this.current = r.parseDoubleAttr('i', this.current);
    this.saturationCurrent = r.parseDoubleAttr('isat', this.saturationCurrent);
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  /** Upstream also zeroes its own copy of the post voltages here; nodes hold them in this port. */
  override reset(): void {
    this.current = this.initialCurrent;
    this.ind.resetTo(this.initialCurrent);
  }

  override stamp(): void {
    this.ind.stamp(this.nodes[0], this.nodes[1]);
  }

  override startIteration(): void {
    this.ind.startIteration(this.nodes[0].v - this.nodes[1].v);
  }

  override nonLinear(): boolean {
    return this.ind.nonLinear();
  }

  override calculateCurrent(): void {
    this.current = this.ind.calculateCurrent(this.nodes[0].v - this.nodes[1].v);
  }

  override doStep(): void {
    this.ind.doStep(this.nodes[0].v - this.nodes[1].v);
  }

  override isInductorElm(): boolean {
    return true;
  }

  override validate(): boolean {
    const fpi = new FindPathInfo(PathType.INDUCT, this, this.getNode(1), this.sim);
    if (!fpi.findPath(this.getNode(0))) this.reset();
    return true;
  }

  override getElmType(): string {
    return this.saturationCurrent > 0 ? 'inductor (sat)' : 'inductor';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return new EditInfo('Inductance (H)', this.inductance, 1e-2, 10).setPositive();
    if (n === 1)
      return EditInfo.createCheckbox('Trapezoidal Approximation', this.ind.isTrapezoidal());
    if (n === 2) return new EditInfo('Initial Current (on Reset) (A)', this.initialCurrent);
    if (n === 3) return new EditInfo('Saturation Current (A) (0=none)', this.saturationCurrent);
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) this.inductance = ei.value;
    if (n === 1) {
      if (ei.checkbox?.state === true) this.flags &= ~Inductor.FLAG_BACK_EULER;
      else this.flags |= Inductor.FLAG_BACK_EULER;
    }
    if (n === 2) this.initialCurrent = ei.value;
    if (n === 3) {
      if (ei.value >= 0) this.saturationCurrent = ei.value;
      else ei.setError('must be >= 0');
    }
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  override getShortcut(): number {
    return 'L'.charCodeAt(0);
  }
}

export const InductorElmType = elementType('InductorElm', InductorElm);

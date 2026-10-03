// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/OpAmpElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/OpAmpElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model. Only the post geometry
// of setPoints() is ported; drawing comes in Phase 4.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { FindPathInfo, PathType, type Point } from '@circuitjs-next/engine';
import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { parseJavaDouble } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

/** Ideal op-amp. Post 0 is the inverting input, 1 the non-inverting input, 2 the output. */
export class OpAmpElm extends CircuitElm {
  static readonly FLAG_SWAP = 1;
  static readonly FLAG_SMALL = 2;
  static readonly FLAG_LOWGAIN = 4;
  static readonly FLAG_GAIN = 8;

  opsize = 0;
  opheight = 0;
  opwidth = 0;
  maxOut = 15;
  minOut = -15;
  gain = 0;
  /** Gain-bandwidth product; has no effect, kept so the text format stays the same. */
  gbw = 1e6;
  lastvd = 0;

  in1p: Point[] = [];
  in2p: Point[] = [];

  // upstream sets this in both constructors
  override noDiagonal = true;

  override getClassName(): string {
    return 'OpAmpElm';
  }
  override getDumpType(): number {
    return 'a'.charCodeAt(0);
  }

  override initNew(): void {
    this.maxOut = 15;
    this.minOut = -15;
    this.gbw = 1e6;
    this.flags = OpAmpElm.FLAG_GAIN; // need to do this before setSize()
    this.gain = 100000;
    this.setSize(this.sim.gridSize === 8 ? 1 : 2);
  }

  override undump(st: StringTokenizer): void {
    this.maxOut = 15;
    this.minOut = -15;
    this.gbw = 1e6;
    try {
      this.maxOut = parseJavaDouble(st.nextToken());
      this.minOut = parseJavaDouble(st.nextToken());
      this.gbw = parseJavaDouble(st.nextToken());
      this.setLoadedVoltage(0, parseJavaDouble(st.nextToken()));
      this.setLoadedVoltage(1, parseJavaDouble(st.nextToken()));
      this.gain = parseJavaDouble(st.nextToken());
    } catch {
      // older files stop early
    }
    this.setSize((this.flags & OpAmpElm.FLAG_SMALL) !== 0 ? 1 : 2);
    this.setGain();
  }

  setGain(): void {
    if ((this.flags & OpAmpElm.FLAG_GAIN) !== 0) return;
    // gain of 100000 breaks e-amp-dfdx.txt; gain was 1000, but it broke amp-schmitt.txt
    this.gain = (this.flags & OpAmpElm.FLAG_LOWGAIN) !== 0 ? 1000 : 100000;
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('ma', this.maxOut);
    w.dumpAttr('mi', this.minOut);
    w.dumpAttr('ga', this.gain);
  }

  override undumpXml(r: XmlAttrReader): void {
    this.flags = 0; // size might have changed
    super.undumpXml(r);
    this.maxOut = r.parseDoubleAttr('ma', this.maxOut);
    this.minOut = r.parseDoubleAttr('mi', this.minOut);
    this.gain = r.parseDoubleAttr('ga', this.gain);
    this.setSize((this.flags & OpAmpElm.FLAG_SMALL) !== 0 ? 1 : 2);
  }

  override nonLinear(): boolean {
    return true;
  }

  setSize(s: number): void {
    this.opsize = s;
    this.opheight = 8 * s;
    this.opwidth = 13 * s;
    this.flags = (this.flags & ~OpAmpElm.FLAG_SMALL) | (s === 1 ? OpAmpElm.FLAG_SMALL : 0);
  }

  override setPoints(): void {
    super.setPoints();
    let hs = this.opheight * this.dsign;
    if ((this.flags & OpAmpElm.FLAG_SWAP) !== 0) hs = -hs;
    const [a, b] = this.interpPoint2(this.point1, this.point2, 0, hs);
    this.in1p = [a];
    this.in2p = [b];
  }

  override getPostCount(): number {
    return 3;
  }

  override getPost(n: number): Point {
    return n === 0 ? this.in1p[0] : n === 1 ? this.in2p[0] : this.point2;
  }

  override getVoltageSourceCount(): number {
    return 1;
  }

  override stamp(): void {
    if (this.voltSource === null) return;
    this.sim.stampMatrixNV(this.nodes[2], this.voltSource, 1);
  }

  override doStep(): void {
    const sim = this.sim;
    const vs = this.voltSource;
    if (vs === null) return;
    const volts0 = this.nodes[0].v;
    const volts2 = this.nodes[2].v;
    const vd = this.nodes[1].v - volts0;
    const midpoint = (this.maxOut + this.minOut) * 0.5;
    if (Math.abs(this.lastvd - vd) > 0.1) sim.converged = false;
    else if (volts2 > this.maxOut + 0.1 || volts2 < this.minOut - 0.1) sim.converged = false;
    let x: number;
    let dx: number;
    const maxAdj = this.maxOut - midpoint;
    const minAdj = this.minOut - midpoint;
    if (vd >= maxAdj / this.gain && (this.lastvd >= 0 || this.getrand(4) === 1)) {
      dx = 1e-4;
      x = this.maxOut - (dx * maxAdj) / this.gain;
    } else if (vd <= minAdj / this.gain && (this.lastvd <= 0 || this.getrand(4) === 1)) {
      dx = 1e-4;
      x = this.minOut - (dx * minAdj) / this.gain;
    } else {
      dx = this.gain;
      x = midpoint;
    }

    // newton-raphson
    sim.stampMatrixVN(vs, this.nodes[0], dx);
    sim.stampMatrixVN(vs, this.nodes[1], -dx);
    sim.stampMatrixVN(vs, this.nodes[2], 1);
    sim.stampRightSideVS(vs, x);

    this.lastvd = vd;
  }

  /** Upstream `CirSim.getrand(x)`: a non-negative int below x from the shared Random. */
  private getrand(x: number): number {
    let q = this.sim.random.nextInt();
    if (q < 0) q = -q | 0;
    return q % x;
  }

  /**
   * There is no current path through the op-amp inputs, but there is an indirect path through
   * the output to ground.
   */
  override validate(): boolean {
    const fpi = new FindPathInfo(PathType.VOLTAGE, this, this.getNode(2), this.sim);
    if (fpi.findPath(this.sim.ground)) {
      this.sim.stop('Path to ground with no resistance!', this);
      return false;
    }
    return true;
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return false;
  }

  override getMatrixConnection(_n1: number, _n2: number): boolean {
    return true;
  }

  override hasGroundConnection(n1: number): boolean {
    return n1 === 2;
  }

  override getVoltageDiff(): number {
    return this.nodes[2].v - this.nodes[1].v;
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 2) return -this.current;
    return 0;
  }

  override getElmType(): string {
    return 'op-amp';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return new EditInfo('Max Output (V)', this.maxOut, 1, 20);
    if (n === 1) return new EditInfo('Min Output (V)', this.minOut, -20, 0);
    if (n === 2) return new EditInfo('Gain', this.gain, 10, 1000000).setPositive();
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) this.maxOut = ei.value;
    if (n === 1) this.minOut = ei.value;
    if (n === 2) this.gain = ei.value;
  }

  override getShortcut(): number {
    return 'a'.charCodeAt(0);
  }

  override flipX(c2: number, count: number): void {
    if (this.dx === 0) this.flags ^= OpAmpElm.FLAG_SWAP;
    super.flipX(c2, count);
  }

  override flipY(c2: number, count: number): void {
    if (this.dy === 0) this.flags ^= OpAmpElm.FLAG_SWAP;
    super.flipY(c2, count);
  }

  override flipXY(xmy: number, count: number): void {
    this.flags ^= OpAmpElm.FLAG_SWAP;
    super.flipXY(xmy, count);
  }
}

export const OpAmpElmType = elementType('OpAmpElm', OpAmpElm);

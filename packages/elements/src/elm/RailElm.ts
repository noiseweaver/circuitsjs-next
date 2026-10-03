// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/RailElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/RailElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { FindPathInfo, PathType, type VoltageSource } from '@circuitjs-next/engine';
import { elementType } from '../CircuitElm.ts';
import { VoltageElm } from './VoltageElm.ts';

/** One-terminal voltage source, referenced to ground. */
export class RailElm extends VoltageElm {
  static readonly FLAG_CLOCK = 1;

  override getClassName(): string {
    return 'RailElm';
  }
  override getDumpType(): number {
    return 'R'.charCodeAt(0);
  }

  override getPostCount(): number {
    return 1;
  }

  override getVoltageDiff(): number {
    return this.nodes[0].v;
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    this.voltSource = v;
    const ground = this.sim.ground;
    if (this.internalResistance > 0) v.setNodes(ground, this.nodes[1]);
    else v.setNodes(ground, this.nodes[0]);
  }

  override stamp(): void {
    const sim = this.sim;
    const vsNode = this.internalResistance > 0 ? this.nodes[1] : this.nodes[0];
    if (this.waveform === VoltageElm.WF_DC)
      sim.stampVoltageSource(sim.ground, vsNode, this.voltSource, this.getVoltage());
    else sim.stampVoltageSource(sim.ground, vsNode, this.voltSource);
    if (this.internalResistance > 0)
      sim.stampResistor(this.nodes[1], this.nodes[0], this.internalResistance);
  }

  override doStep(): void {
    const sim = this.sim;
    const vsNode = this.internalResistance > 0 ? this.nodes[1] : this.nodes[0];
    if (this.waveform !== VoltageElm.WF_DC)
      sim.updateVoltageSource(sim.ground, vsNode, this.voltSource, this.getVoltage());
  }

  override hasGroundConnection(_n1: number): boolean {
    return true;
  }

  override isRailElm(): boolean {
    return true;
  }

  /** A rail tied to ground with no resistance gets a small one and asks for another pass. */
  validateRailNode(n: number): boolean {
    const fpi = new FindPathInfo(PathType.VOLTAGE, this, this.getNode(n), this.sim);
    if (fpi.findPath(this.sim.ground)) {
      this.internalResistance = 0.001;
      return false;
    }
    return true;
  }

  override validate(): boolean {
    return this.internalResistance > 0 || this.validateRailNode(0);
  }

  override getShortcut(): number {
    return 'V'.charCodeAt(0);
  }

  override getDragVertical(requestedVertical: boolean): boolean {
    return requestedVertical;
  }
}

export const RailElmType = elementType('RailElm', RailElm);

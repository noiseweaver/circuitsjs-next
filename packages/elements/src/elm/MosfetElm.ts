// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/MosfetElm.java, NMosfetElm.java
// and PMosfetElm.java (master) at 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with
// ts/MosfetElm.ts (dev-ts) at 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage
// model. Only the post geometry of setPoints() is ported; drawing comes in Phase 4.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import type { Point } from '@circuitjs-next/engine';
import { CircuitElm, elementType, type ElementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { parseJavaDouble } from '../java.ts';
import { modelsFor } from '../models/ModelLibrary.ts';
import type { MosfetModel } from '../models/MosfetModel.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter, XmlDocWriter } from '../xml.ts';
import { Diode } from './Diode.ts';

/** MOSFET (square-law model). Node 0 is the gate, 1 the source, 2 the drain, 3 the body. */
export class MosfetElm extends CircuitElm {
  static readonly FLAG_PNP = 1;
  static readonly FLAG_SHOWVT = 2;
  static readonly FLAG_FLIP = 8;
  // display and body-diode options that older files kept in the element flags; models hold
  // them now
  static readonly FLAG_DIGITAL_LEGACY = 4;
  static readonly FLAG_HIDE_BULK_LEGACY = 16;
  static readonly FLAG_BODY_DIODE_LEGACY = 32;
  static readonly FLAG_BODY_TERMINAL_LEGACY = 64;
  static readonly FLAG_SHOW_BODY_DIODE_LEGACY = 128;
  /** Upstream `MosfetElm.lastModelName`. */
  static readonly defaultModelName: string = 'default';

  pnp = 1;
  bodyTerminal = 0;
  vt = 0;
  beta = 0;

  // gate capacitance companion model state
  capVoltGS = 0;
  capVoltGD = 0;
  capCurGS = 0;
  capCurGD = 0;
  geqGS = 0;
  geqGD = 0;
  ceqGS = 0;
  ceqGD = 0;

  diodeB1 = new Diode(this);
  diodeB2 = new Diode(this);
  diodeCurrent1 = 0;
  diodeCurrent2 = 0;

  modelName = '';
  model: MosfetModel | null = null;
  bulkShown = false;
  digitalSymbolShown = false;
  bodyDiodeSimulated = false;
  bodyTerminalShown = false;
  bodyDiodeSymbolShown = false;

  lastv0 = 0;
  lastv1 = 0;
  lastv2 = 0;
  ids = 0;
  mode = 0;
  gm = 0;

  src: Point[] = [];
  drn: Point[] = [];
  body: Point[] = [];
  /** The model list last shown by getEditInfo, which setEditValue indexes into. */
  models: MosfetModel[] | null = null;

  // upstream sets this in both constructors
  override noDiagonal = true;

  override getClassName(): string {
    return 'MosfetElm';
  }
  override getDumpType(): number {
    return 'f'.charCodeAt(0);
  }

  /** Upstream `MosfetElm(int xx, int yy, boolean pnpflag)`. */
  initMosfet(pnpflag: boolean): void {
    this.pnp = pnpflag ? -1 : 1;
    this.flags = pnpflag ? MosfetElm.FLAG_PNP : 0;
    this.setupDiodes();
    this.modelName = this.getLastModelName();
    this.setup();
  }

  override initNew(): void {
    this.initMosfet(false);
  }

  isJfet(): boolean {
    return false;
  }

  getLastModelName(): string {
    return modelsFor(this.sim).mosfetLastModelName;
  }
  setLastModelName(n: string): void {
    modelsFor(this.sim).mosfetLastModelName = n;
  }

  override undump(st: StringTokenizer): void {
    this.pnp = (this.flags & MosfetElm.FLAG_PNP) !== 0 ? -1 : 1;
    this.setupDiodes();
    let vt0 = this.getDefaultThreshold();
    let beta0 = this.getBackwardCompatibilityBeta();
    try {
      vt0 = parseJavaDouble(st.nextToken());
      beta0 = parseJavaDouble(st.nextToken());
    } catch {
      // older files stop early
    }
    this.model = this.legacyModel(vt0, beta0, this.flags);
    this.modelName = this.model.name;
    this.setup();
  }

  /** The model for settings that older files kept on the element; clears those flags. */
  legacyModel(vt0: number, beta0: number, legacyFlags: number): MosfetModel {
    const legacyShowBulk =
      !this.isJfet() &&
      (legacyFlags & (MosfetElm.FLAG_DIGITAL_LEGACY | MosfetElm.FLAG_HIDE_BULK_LEGACY)) === 0;
    const legacyDigital = (legacyFlags & MosfetElm.FLAG_DIGITAL_LEGACY) !== 0;
    const legacyBodyDiode = (legacyFlags & MosfetElm.FLAG_BODY_DIODE_LEGACY) !== 0;
    const legacyBodyTerminal = (legacyFlags & MosfetElm.FLAG_BODY_TERMINAL_LEGACY) !== 0;
    const legacyShowBodyDiode = (legacyFlags & MosfetElm.FLAG_SHOW_BODY_DIODE_LEGACY) !== 0;
    this.flags &= ~(
      MosfetElm.FLAG_DIGITAL_LEGACY |
      MosfetElm.FLAG_HIDE_BULK_LEGACY |
      MosfetElm.FLAG_BODY_DIODE_LEGACY |
      MosfetElm.FLAG_BODY_TERMINAL_LEGACY |
      MosfetElm.FLAG_SHOW_BODY_DIODE_LEGACY
    );
    return modelsFor(this.sim).mosfet.getModelWithParameters(
      vt0,
      beta0,
      this.isJfet(),
      legacyShowBulk,
      legacyBodyDiode,
      legacyBodyTerminal,
      legacyDigital,
      legacyShowBodyDiode,
    );
  }

  getModel(): MosfetModel {
    return this.model as MosfetModel;
  }

  setup(): void {
    const model = modelsFor(this.sim).mosfet.getModelWithNameOrCopy(
      this.modelName,
      this.model,
      this.isJfet(),
    );
    this.model = model;
    this.modelName = model.name;
    this.vt = model.threshold;
    this.beta = model.beta;
    this.bulkShown = model.showBulk;
    this.digitalSymbolShown = !this.bulkShown && model.digitalSymbol;
    this.bodyDiodeSimulated = this.bulkShown && model.bodyDiode;
    this.bodyTerminalShown = this.bodyDiodeSimulated && model.bodyTerminal;
    this.bodyDiodeSymbolShown = this.bodyDiodeSimulated && model.showBodyDiodeSymbol;
  }

  hasGateCaps(): boolean {
    const model = this.getModel();
    return model.capGS > 0 || model.capGD > 0;
  }

  updateModels(): void {
    this.setup();
    this.setPoints();
  }

  setupDiodes(): void {
    const dm = modelsFor(this.sim).diode.getDefaultModel();
    this.diodeB1.setup(dm);
    this.diodeB2.setup(dm);
  }

  getDefaultThreshold(): number {
    return 1.5;
  }

  /** Default beta for old files: 0.02, from before beta was configurable. */
  getBackwardCompatibilityBeta(): number {
    return 0.02;
  }

  override nonLinear(): boolean {
    return true;
  }

  drawDigital(): boolean {
    return this.digitalSymbolShown;
  }
  showBulk(): boolean {
    return this.bulkShown;
  }
  hasBodyTerminal(): boolean {
    return this.bodyTerminalShown;
  }
  doBodyDiode(): boolean {
    return this.bodyDiodeSimulated;
  }

  override reset(): void {
    this.lastv1 = this.lastv2 = 0;
    this.capVoltGS = this.capVoltGD = this.capCurGS = this.capCurGD = 0;
    this.geqGS = this.geqGD = this.ceqGS = this.ceqGD = 0;
    this.diodeB1.reset();
    this.diodeB2.reset();
  }

  override dumpXmlModels(doc: XmlDocWriter): void {
    const model = this.getModel();
    if (!(model.builtIn || model.dumped)) model.dumpXml(doc);
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('mo', this.modelName);
  }

  override undumpXml(r: XmlAttrReader): void {
    this.flags = 0;
    super.undumpXml(r);
    const mo = r.parseStringAttr('mo', null);
    if (mo === null) {
      const vt0 = r.parseDoubleAttr('vt', this.getDefaultThreshold());
      const beta0 = r.parseDoubleAttr('be', this.getBackwardCompatibilityBeta());
      this.model = this.legacyModel(vt0, beta0, this.flags);
      this.modelName = this.model.name;
    } else this.modelName = mo;
    this.setup();
    this.pnp = (this.flags & MosfetElm.FLAG_PNP) !== 0 ? -1 : 1;
  }

  override getPost(n: number): Point {
    return n === 0 ? this.point1 : n === 1 ? this.src[0] : n === 2 ? this.drn[0] : this.body[0];
  }

  override getCurrent(): number {
    return this.ids;
  }

  override getPostCount(): number {
    return this.hasBodyTerminal() ? 4 : 3;
  }

  override setPoints(): void {
    super.setPoints();
    const hs = 16;
    // find the coordinates of the various points we need to draw the MOSFET
    let hs2 = hs * this.dsign;
    if ((this.flags & MosfetElm.FLAG_FLIP) !== 0) hs2 = -hs2;
    const [s0, d0] = this.interpPoint2(this.point1, this.point2, 1, -hs2);
    this.src = [s0];
    this.drn = [d0];
    this.body = this.showBulk() ? [this.interpPoint(s0, d0, 0.5)] : [];
  }

  override startIteration(): void {
    const sim = this.sim;
    const model = this.getModel();
    if (sim.timeStep <= 0) return;
    if (model.capGS > 0) {
      this.geqGS = model.capGS / sim.timeStep;
      this.ceqGS = -this.geqGS * this.capVoltGS;
    }
    if (model.capGD > 0) {
      this.geqGD = model.capGD / sim.timeStep;
      this.ceqGD = -this.geqGD * this.capVoltGD;
    }
  }

  override stamp(): void {
    const sim = this.sim;
    const nodes = this.nodes;
    sim.stampNonLinear(nodes[1]);
    sim.stampNonLinear(nodes[2]);
    if (this.hasGateCaps()) sim.stampNonLinear(nodes[0]);

    if (this.hasBodyTerminal()) this.bodyTerminal = 3;
    else this.bodyTerminal = this.pnp === -1 ? 2 : 1;

    if (this.doBodyDiode()) {
      if (this.pnp === -1) {
        // pnp: diodes conduct when S or D are higher than body
        this.diodeB1.stamp(nodes[1], nodes[this.bodyTerminal]);
        this.diodeB2.stamp(nodes[2], nodes[this.bodyTerminal]);
      } else {
        // npn: diodes conduct when body is higher than S or D
        this.diodeB1.stamp(nodes[this.bodyTerminal], nodes[1]);
        this.diodeB2.stamp(nodes[this.bodyTerminal], nodes[2]);
      }
    }
  }

  nonConvergence(last: number, now: number): boolean {
    const sim = this.sim;
    let diff = Math.abs(last - now);

    // high beta MOSFETs are more sensitive to small differences, so we are more strict about
    // convergence testing
    if (this.beta > 1) diff *= 100;

    // difference of less than 10mV is fine
    if (diff < 0.01) return false;
    // larger differences are fine if value is large
    if (sim.subIterations > 10 && diff < Math.abs(now) * 0.001) return false;
    // if we're having trouble converging, get more lenient
    if (sim.subIterations > 100 && diff < 0.01 + (sim.subIterations - 100) * 0.0001) return false;
    return true;
  }

  override stepFinished(): void {
    const nodes = this.nodes;
    const model = this.getModel();
    this.calculate(true);

    // fix current if body is connected to source or drain
    if (this.bodyTerminal === 1) this.diodeCurrent1 = -this.diodeCurrent2;
    if (this.bodyTerminal === 2) this.diodeCurrent2 = -this.diodeCurrent1;

    // save gate capacitor state for the next time step's companion model
    if (model.capGS > 0 && this.geqGS > 0) {
      this.capVoltGS = nodes[0].v - nodes[1].v;
      this.capCurGS = this.geqGS * this.capVoltGS + this.ceqGS;
    }
    if (model.capGD > 0 && this.geqGD > 0) {
      this.capVoltGD = nodes[0].v - nodes[2].v;
      this.capCurGD = this.geqGD * this.capVoltGD + this.ceqGD;
    }
  }

  override doStep(): void {
    this.calculate(false);
  }

  calculate(finished: boolean): void {
    const sim = this.sim;
    const nodes = this.nodes;
    const model = this.getModel();
    const volts = nodes.map((n) => n.v);
    let vs: number[];
    if (finished) vs = volts;
    else {
      // limit voltage changes to .5V
      vs = [volts[0], volts[1], volts[2]];
      if (vs[1] > this.lastv1 + 0.5) vs[1] = this.lastv1 + 0.5;
      if (vs[1] < this.lastv1 - 0.5) vs[1] = this.lastv1 - 0.5;
      if (vs[2] > this.lastv2 + 0.5) vs[2] = this.lastv2 + 0.5;
      if (vs[2] < this.lastv2 - 0.5) vs[2] = this.lastv2 - 0.5;
    }

    let source = 1;
    let drain = 2;

    // if source voltage > drain (for NPN), swap source and drain (opposite for PNP)
    if (this.pnp * vs[1] > this.pnp * vs[2]) {
      source = 2;
      drain = 1;
    }
    const gate = 0;
    let vgs = vs[gate] - vs[source];
    let vds = vs[drain] - vs[source];
    if (
      !finished &&
      (this.nonConvergence(this.lastv1, vs[1]) ||
        this.nonConvergence(this.lastv2, vs[2]) ||
        this.nonConvergence(this.lastv0, vs[0]))
    )
      sim.converged = false;
    this.lastv0 = vs[0];
    this.lastv1 = vs[1];
    this.lastv2 = vs[2];
    const realvgs = vgs;
    const realvds = vds;
    vgs *= this.pnp;
    vds *= this.pnp;
    this.ids = 0;
    this.gm = 0;
    let Gds: number;
    const vt = this.vt;
    const beta = this.beta;
    if (vgs < vt) {
      // should be all zero, but that causes a singular matrix, so instead we treat it as a
      // large resistor
      Gds = 1e-8;
      this.ids = vds * Gds;
      this.mode = 0;
    } else if (vds < vgs - vt) {
      // linear region, with channel-length modulation
      const lambda = model.lambda;
      this.ids = beta * ((vgs - vt) * vds - vds * vds * 0.5) * (1 + lambda * vds);
      this.gm = beta * vds * (1 + lambda * vds);
      Gds =
        beta *
        ((vgs - vds - vt) * (1 + lambda * vds) + lambda * ((vgs - vt) * vds - vds * vds * 0.5));
      this.mode = 1;
    } else {
      // saturation, with channel-length modulation
      const lambda = model.lambda;
      const vgs_vt = vgs - vt;
      this.gm = beta * vgs_vt * (1 + lambda * vds);
      Gds = 0.5 * beta * vgs_vt * vgs_vt * lambda;
      // without lambda, use the tiny conductance for numerical stability
      if (Gds < 1e-8) Gds = 1e-8;
      this.ids = 0.5 * beta * vgs_vt * vgs_vt * (1 + lambda * vds);
      this.mode = 2;
    }

    if (this.doBodyDiode()) {
      const bt = this.bodyTerminal;
      this.diodeB1.doStep(this.pnp * (volts[bt] - volts[1]));
      this.diodeCurrent1 =
        this.diodeB1.calculateCurrent(this.pnp * (volts[bt] - volts[1])) * this.pnp;
      this.diodeB2.doStep(this.pnp * (volts[bt] - volts[2]));
      this.diodeCurrent2 =
        this.diodeB2.calculateCurrent(this.pnp * (volts[bt] - volts[2])) * this.pnp;
    } else this.diodeCurrent1 = this.diodeCurrent2 = 0;

    const ids0 = this.ids;

    // flip ids if we swapped source and drain above
    if ((source === 2 && this.pnp === 1) || (source === 1 && this.pnp === -1)) this.ids = -this.ids;

    if (finished) return;

    const gm = this.gm;
    const rs = -this.pnp * ids0 + Gds * realvds + gm * realvgs;
    sim.stampMatrix(nodes[drain], nodes[drain], Gds);
    sim.stampMatrix(nodes[drain], nodes[source], -Gds - gm);
    sim.stampMatrix(nodes[drain], nodes[gate], gm);

    sim.stampMatrix(nodes[source], nodes[drain], -Gds);
    sim.stampMatrix(nodes[source], nodes[source], Gds + gm);
    sim.stampMatrix(nodes[source], nodes[gate], -gm);

    sim.stampRightSide(nodes[drain], rs);
    sim.stampRightSide(nodes[source], -rs);

    // gate capacitance companion model stamps
    if (model.capGS > 0 && this.geqGS > 0) {
      sim.stampMatrix(nodes[0], nodes[0], this.geqGS);
      sim.stampMatrix(nodes[1], nodes[1], this.geqGS);
      sim.stampMatrix(nodes[0], nodes[1], -this.geqGS);
      sim.stampMatrix(nodes[1], nodes[0], -this.geqGS);
      sim.stampRightSide(nodes[0], -this.ceqGS);
      sim.stampRightSide(nodes[1], this.ceqGS);
    }
    if (model.capGD > 0 && this.geqGD > 0) {
      sim.stampMatrix(nodes[0], nodes[0], this.geqGD);
      sim.stampMatrix(nodes[2], nodes[2], this.geqGD);
      sim.stampMatrix(nodes[0], nodes[2], -this.geqGD);
      sim.stampMatrix(nodes[2], nodes[0], -this.geqGD);
      sim.stampRightSide(nodes[0], -this.ceqGD);
      sim.stampRightSide(nodes[2], this.ceqGD);
    }
  }

  override getVoltageDiff(): number {
    return this.nodes[2].v - this.nodes[1].v;
  }

  override getConnection(n1: number, n2: number): boolean {
    // with gate capacitance there is a path through the gate
    if (this.hasGateCaps()) return true;
    return !(n1 === 0 || n2 === 0);
  }

  override getMatrixConnection(_n1: number, _n2: number): boolean {
    return true;
  }

  override getCurrentIntoNode(n: number): number {
    const nodes = this.nodes;
    const model = this.getModel();
    if (n === 0) {
      // gate current: capacitor currents flow out of the gate
      let gateCur = 0;
      if (model.capGS > 0 && this.geqGS > 0)
        gateCur -= this.geqGS * (nodes[0].v - nodes[1].v) + this.ceqGS;
      if (model.capGD > 0 && this.geqGD > 0)
        gateCur -= this.geqGD * (nodes[0].v - nodes[2].v) + this.ceqGD;
      return gateCur;
    }
    if (n === 3) return -this.diodeCurrent1 - this.diodeCurrent2;
    if (n === 1) {
      const capCur =
        model.capGS > 0 && this.geqGS > 0 ? this.geqGS * (nodes[0].v - nodes[1].v) + this.ceqGS : 0;
      return this.ids + this.diodeCurrent1 + capCur;
    }
    const capCur =
      model.capGD > 0 && this.geqGD > 0 ? this.geqGD * (nodes[0].v - nodes[2].v) + this.ceqGD : 0;
    return -this.ids + this.diodeCurrent2 + capCur;
  }

  override getElmType(): string {
    return 'MOSFET';
  }

  /**
   * Does this element support D/S swapping? JfetElm overrides this to false since its
   * setPoints() doesn't honor FLAG_FLIP. (The other MOSFET options live on MosfetModel.)
   */
  hasSwapDS(): boolean {
    return true;
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) {
      const models = modelsFor(this.sim).mosfet.getModelList(this.isJfet());
      this.models = models;
      let selected = 0;
      for (let i = 0; i !== models.length; i++) if (models[i] === this.model) selected = i;
      return EditInfo.createChoice(
        'Model',
        models.map((mm) => mm.getDescription()),
        selected,
      );
    }
    const idx = 1;
    if (this.hasSwapDS() && n === idx)
      return EditInfo.createCheckbox('Swap D/S', (this.flags & MosfetElm.FLAG_FLIP) !== 0);
    // model editing: later phase (upstream buttons after Swap D/S: "Create New Model" and
    // "Edit Model")
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) {
      const models = this.models ?? modelsFor(this.sim).mosfet.getModelList(this.isJfet());
      this.model = models[ei.choice?.selected ?? 0];
      this.modelName = this.model.name;
      this.setLastModelName(this.modelName);
      this.setup();
      ei.newDialog = true;
    } else {
      const idx = 1;
      if (this.hasSwapDS() && n === idx) {
        this.flags =
          ei.checkbox?.state === true
            ? this.flags | MosfetElm.FLAG_FLIP
            : this.flags & ~MosfetElm.FLAG_FLIP;
      }
      // model editing: later phase (the button fields return here without the code below)
    }
    // lots of different cases where the body terminal might have gotten removed/added so just
    // do this all the time
    this.allocNodes();
    this.setPoints();
  }

  override flipX(c2: number, count: number): void {
    if (this.x === this.x2) this.flags ^= MosfetElm.FLAG_FLIP;
    super.flipX(c2, count);
  }

  override flipY(c2: number, count: number): void {
    if (this.y === this.y2) this.flags ^= MosfetElm.FLAG_FLIP;
    super.flipY(c2, count);
  }

  override flipXY(xmy: number, count: number): void {
    this.flags ^= MosfetElm.FLAG_FLIP;
    super.flipXY(xmy, count);
  }
}

export class NMosfetElm extends MosfetElm {
  override getClassName(): string {
    return 'NMosfetElm';
  }
  override getShortcut(): number {
    return 'N'.charCodeAt(0);
  }
}

export class PMosfetElm extends MosfetElm {
  override getClassName(): string {
    return 'PMosfetElm';
  }
  override getShortcut(): number {
    return 'P'.charCodeAt(0);
  }
  override initNew(): void {
    this.initMosfet(true);
  }
}

/**
 * Upstream registers both variants under MosfetElm (`getDumpClass()`): text `f` lines load as
 * MosfetElm, and `constructElement("MosfetElm")` (XML `f`) builds an NMosfetElm.
 */
export const MosfetElmType: ElementType = {
  className: 'MosfetElm',
  create(x, y, sim) {
    const e = new NMosfetElm(x, y, x, y, 0);
    e.sim = sim;
    e.initNew();
    return e;
  },
  load(x1, y1, x2, y2, f, st, sim) {
    const e = new MosfetElm(x1, y1, x2, y2, f);
    e.sim = sim;
    e.undump(st);
    return e;
  },
};

export const NMosfetElmType = elementType('NMosfetElm', NMosfetElm);
export const PMosfetElmType = elementType('PMosfetElm', PMosfetElm);

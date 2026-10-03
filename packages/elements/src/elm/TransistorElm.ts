// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/TransistorElm.java,
// NTransistorElm.java and PTransistorElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/TransistorElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model. dev-ts swaps the saved
// junction voltages to their electrical meaning; this keeps master's naming and file values.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import type { Point } from '@circuitjs-next/engine';
import { CircuitElm, elementType, type ElementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { unescapeToken } from '../escape.ts';
import { parseJavaDouble, parseJavaInt } from '../java.ts';
import { modelsFor } from '../models/ModelLibrary.ts';
import type { TransistorModel } from '../models/TransistorModel.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter, XmlDocWriter } from '../xml.ts';

/** Electron thermal voltage at SPICE's default temperature of 27 C (300.15 K). */
const vt = 0.025865;

/**
 * Voltage-dependent junction depletion capacitance (the SPICE formula):
 * vj is the junction voltage (positive = forward bias), cj0 the zero-bias capacitance, vj0 the
 * built-in potential, mj the grading coefficient.
 */
function calcJunctionCap(vj: number, cj0: number, vj0: number, mj: number): number {
  if (cj0 <= 0) return 0;
  const fc = 0.5;
  // normal depletion region: C increases as reverse bias decreases
  if (vj < fc * vj0) return cj0 / Math.pow(1 - vj / vj0, mj);
  // forward bias beyond fc*Vj: linear extrapolation to avoid the singularity at V=Vj
  return (cj0 / Math.pow(1 - fc, 1 + mj)) * (1 - fc * (1 + mj) + (mj * vj) / vj0);
}

/** Bipolar transistor, Gummel-Poon. Node 0 is the base, 1 the collector, 2 the emitter. */
export class TransistorElm extends CircuitElm {
  static readonly FLAG_FLIP = 1;
  static readonly FLAG_CIRCLE = 2;
  static readonly FLAGS_GLOBAL = TransistorElm.FLAG_CIRCLE;
  /** Upstream `TransistorElm.lastModelName` ("never changes??" upstream). */
  static readonly defaultModelName: string = 'default';

  pnp = 1;
  beta = 100;
  gmin = 0;
  modelName = '';
  model: TransistorModel | null = null;
  badIters = 0;
  localSubIters = 0;

  ic = 0;
  ie = 0;
  ib = 0;

  // junction capacitance state (trapezoidal companion model)
  /** Junction voltages from the end of the previous time step. */
  capVoltBE = 0;
  capVoltBC = 0;
  /** Junction capacitor currents from the end of the previous time step. */
  capCurBE = 0;
  capCurBC = 0;
  /** Companion conductances and current sources (computed in startIteration). */
  geqBE = 0;
  geqBC = 0;
  ceqBE = 0;
  ceqBC = 0;

  vcrit = 0;
  /**
   * Master's names are crossed for loaded circuits: the file's first junction voltage (base
   * minus collector) is read into lastvbe. Kept as master has it, since the first iteration
   * after loading compares against these.
   */
  lastvbc = 0;
  lastvbe = 0;

  coll: Point[] = [];
  emit: Point[] = [];
  /** The model list last shown by getEditInfo, which setEditValue indexes into. */
  models: TransistorModel[] | null = null;

  override getClassName(): string {
    return 'TransistorElm';
  }
  override getDumpType(): number {
    return 't'.charCodeAt(0);
  }

  /** Upstream `TransistorElm(int xx, int yy, boolean pnpflag)`. */
  initTransistor(pnpflag: boolean): void {
    this.pnp = pnpflag ? -1 : 1;
    this.beta = 100;
    this.modelName = TransistorElm.defaultModelName;
    this.setup();
  }

  override initNew(): void {
    this.initTransistor(false);
  }

  override undump(st: StringTokenizer): void {
    this.pnp = parseJavaInt(st.nextToken());
    this.beta = 100;
    try {
      this.lastvbe = parseJavaDouble(st.nextToken());
      this.lastvbc = parseJavaDouble(st.nextToken());
      this.setLoadedVoltages();
      this.beta = parseJavaDouble(st.nextToken());
      this.modelName = unescapeToken(st.nextToken());
    } catch {
      this.modelName = 'default';
    }
    modelsFor(this.sim).transistorGlobalFlags = this.flags & TransistorElm.FLAGS_GLOBAL;
    this.setup();
  }

  private setLoadedVoltages(): void {
    this.setLoadedVoltage(0, 0);
    this.setLoadedVoltage(1, -this.lastvbe);
    this.setLoadedVoltage(2, -this.lastvbc);
  }

  getModel(): TransistorModel {
    return this.model as TransistorModel;
  }

  setup(): void {
    const model = modelsFor(this.sim).transistor.getModelWithNameOrCopy(this.modelName, this.model);
    this.model = model;
    this.modelName = model.name; // in case we couldn't find that model
    this.vcrit = vt * Math.log(vt / (Math.sqrt(2) * model.satCur));
    this.noDiagonal = true;
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.lastvbc = this.lastvbe = 0;
    this.capVoltBE = this.capVoltBC = this.capCurBE = this.capCurBC = 0;
    this.geqBE = this.geqBC = this.ceqBE = this.ceqBC = 0;
    this.badIters = 0;
    this.localSubIters = 0;
  }

  override dumpXmlModels(doc: XmlDocWriter): void {
    const model = this.getModel();
    if (!(model.builtIn || model.dumped)) model.dumpXml(doc);
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('pn', this.pnp);
    w.dumpAttr('be', this.beta);
    w.dumpAttr('mo', this.modelName);
  }

  /** Master saves base-collector voltage as "vbe" and base-emitter as "vbc". */
  override dumpXmlState(w: XmlAttrWriter): void {
    w.dumpAttr('vbe', this.nodes[0].v - this.nodes[1].v);
    w.dumpAttr('vbc', this.nodes[0].v - this.nodes[2].v);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.pnp = r.parseIntAttr('pn', this.pnp);
    this.beta = r.parseDoubleAttr('be', this.beta);
    this.modelName = r.parseStringAttr('mo', this.modelName);
    this.lastvbe = r.parseDoubleAttr('vbe', 0);
    this.lastvbc = r.parseDoubleAttr('vbc', 0);
    this.setLoadedVoltages();
    modelsFor(this.sim).transistorGlobalFlags = this.flags & TransistorElm.FLAGS_GLOBAL;
    this.setup();
  }

  updateModels(): void {
    this.setup();
  }

  override getPostCount(): number {
    return 3;
  }

  override getPost(n: number): Point {
    return n === 0 ? this.point1 : n === 1 ? this.coll[0] : this.emit[0];
  }

  override setPoints(): void {
    // these flags apply to all transistors
    this.flags &= ~TransistorElm.FLAGS_GLOBAL;
    this.flags |= modelsFor(this.sim).transistorGlobalFlags;
    super.setPoints();
    const hs = 16;
    if ((this.flags & TransistorElm.FLAG_FLIP) !== 0) this.dsign = -this.dsign;
    const hs2 = hs * this.dsign * this.pnp;
    // collector and emitter posts
    const [c0, e0] = this.interpPoint2(this.point1, this.point2, 1, hs2);
    this.coll = [c0];
    this.emit = [e0];
  }

  limitStep(vnew: number, vold: number): number {
    let arg: number;
    if (vnew > this.vcrit && Math.abs(vnew - vold) > vt + vt) {
      if (vold > 0) {
        arg = 1 + (vnew - vold) / vt;
        if (arg > 0) vnew = vold + vt * Math.log(arg);
        else vnew = this.vcrit;
      } else {
        vnew = vt * Math.log(vnew / vt);
      }
      this.sim.converged = false;
    }
    return vnew;
  }

  /**
   * Junction capacitance companion model for this time step, trapezoidal like CapacitorElm.
   * Total capacitance is depletion (CJE/CJC) plus diffusion (TF*gm, TR*gm).
   */
  override startIteration(): void {
    const model = this.getModel();
    const sim = this.sim;
    const hasBEcap = model.junctionCapBE > 0 || model.transitTimeF > 0;
    const hasBCcap = model.junctionCapBC > 0 || model.transitTimeR > 0;
    if (hasBEcap && sim.timeStep > 0) {
      const vjBE = this.pnp * this.capVoltBE; // physical junction voltage
      let cje = calcJunctionCap(
        vjBE,
        model.junctionCapBE,
        model.junctionPotBE,
        model.junctionExpBE,
      );
      // add diffusion capacitance only in forward bias (like SPICE)
      if (model.transitTimeF > 0 && vjBE > 0) {
        const vtn = vt * model.emissionCoeffF;
        cje += (model.transitTimeF * model.satCur * Math.exp(vjBE / vtn)) / vtn;
      }
      this.geqBE = (2 * cje) / sim.timeStep;
      if (this.geqBE < 1e-20) this.geqBE = this.ceqBE = this.capCurBE = 0;
      else this.ceqBE = -this.geqBE * this.capVoltBE - this.capCurBE;
    }
    if (hasBCcap && sim.timeStep > 0) {
      const vjBC = this.pnp * this.capVoltBC; // physical junction voltage
      let cjc = calcJunctionCap(
        vjBC,
        model.junctionCapBC,
        model.junctionPotBC,
        model.junctionExpBC,
      );
      // add diffusion capacitance only in forward bias (like SPICE)
      if (model.transitTimeR > 0 && vjBC > 0) {
        cjc +=
          (model.transitTimeR * model.satCur * Math.exp(vjBC / (vt * model.emissionCoeffR))) /
          (vt * model.emissionCoeffR);
      }
      this.geqBC = (2 * cjc) / sim.timeStep;
      if (this.geqBC < 1e-20) this.geqBC = this.ceqBC = this.capCurBC = 0;
      else this.ceqBC = -this.geqBC * this.capVoltBC - this.capCurBC;
    }
  }

  override stamp(): void {
    this.sim.stampNonLinear(this.nodes[0]);
    this.sim.stampNonLinear(this.nodes[1]);
    this.sim.stampNonLinear(this.nodes[2]);
  }

  override doStep(): void {
    const sim = this.sim;
    const model = this.getModel();
    const nodes = this.nodes;
    const pnp = this.pnp;
    let vbc = pnp * (nodes[0].v - nodes[1].v); // typically negative
    let vbe = pnp * (nodes[0].v - nodes[2].v); // typically positive
    const notConverged = Math.abs(vbc - this.lastvbc) > 0.01 || Math.abs(vbe - this.lastvbe) > 0.01;
    if (notConverged) sim.converged = false;

    // track per-transistor convergence difficulty
    if (notConverged) this.localSubIters++;
    else this.localSubIters = 0;

    // To prevent a possible singular matrix, put a tiny conductance in parallel with each P-N
    // junction.
    this.gmin = 1e-12;
    if (this.localSubIters > 100 && this.badIters < 5) {
      // if THIS transistor has trouble converging, put a conductance in parallel with all P-N
      // junctions. The per-transistor count avoids contaminating unrelated transistors.
      this.gmin = Math.exp(-9 * Math.log(10) * (1 - this.localSubIters / 300));
      if (this.gmin > 0.1) this.gmin = 0.1;
    }
    const gmin = this.gmin;

    vbc = this.limitStep(vbc, this.lastvbc);
    vbe = this.limitStep(vbe, this.lastvbe);
    this.lastvbc = vbc;
    this.lastvbe = vbe;

    // dc model parameters (from Spice 3f5, bjtload.c)
    const csat = model.satCur;
    const oik = model.invRollOffF;
    const c2 = model.BEleakCur;
    const vte = model.leakBEemissionCoeff * vt;
    const oikr = model.invRollOffR;
    const c4 = model.BCleakCur;
    const vtc = model.leakBCemissionCoeff * vt;
    let vtn = vt * model.emissionCoeffF;
    let cbe: number, gbe: number, cben: number, gben: number;
    let cbc: number, gbc: number, cbcn: number, gbcn: number;
    let qb: number, dqbdve: number, dqbdvc: number;
    if (vbe > -5 * vtn) {
      const evbe = Math.exp(vbe / vtn);
      cbe = csat * (evbe - 1) + gmin * vbe;
      gbe = (csat * evbe) / vtn + gmin;
      if (c2 === 0) {
        cben = 0;
        gben = 0;
      } else {
        const evben = Math.exp(vbe / vte);
        cben = c2 * (evben - 1);
        gben = (c2 * evben) / vte;
      }
    } else {
      gbe = -csat / vbe + gmin;
      cbe = gbe * vbe;
      gben = -c2 / vbe;
      cben = gben * vbe;
    }
    vtn = vt * model.emissionCoeffR;
    if (vbc > -5 * vtn) {
      const evbc = Math.exp(vbc / vtn);
      cbc = csat * (evbc - 1) + gmin * vbc;
      gbc = (csat * evbc) / vtn + gmin;
      if (c4 === 0) {
        cbcn = 0;
        gbcn = 0;
      } else {
        const evbcn = Math.exp(vbc / vtc);
        cbcn = c4 * (evbcn - 1);
        gbcn = (c4 * evbcn) / vtc;
      }
    } else {
      gbc = -csat / vbc + gmin;
      cbc = gbc * vbc;
      gbcn = -c4 / vbc;
      cbcn = gbcn * vbc;
    }

    // determine base charge terms
    const q1 = 1 / (1 - model.invEarlyVoltF * vbc - model.invEarlyVoltR * vbe);
    if (oik === 0 && oikr === 0) {
      qb = q1;
      dqbdve = q1 * qb * model.invEarlyVoltR;
      dqbdvc = q1 * qb * model.invEarlyVoltF;
    } else {
      const q2 = oik * cbe + oikr * cbc;
      const arg = Math.max(0, 1 + 4 * q2);
      let sqarg = 1;
      if (arg !== 0) sqarg = Math.sqrt(arg);
      qb = (q1 * (1 + sqarg)) / 2;
      dqbdve = q1 * (qb * model.invEarlyVoltR + (oik * gbe) / sqarg);
      dqbdvc = q1 * (qb * model.invEarlyVoltF + (oikr * gbc) / sqarg);
    }

    let cc = 0;
    const cex = cbe;
    const gex = gbe;
    // determine dc incremental conductances
    cc = cc + (cex - cbc) / qb - cbc / model.betaR - cbcn;
    const cb = cbe / this.beta + cben + cbc / model.betaR + cbcn;

    // get currents
    this.ic = pnp * cc;
    this.ib = pnp * cb;
    this.ie = pnp * (-cc - cb);

    // (base resistance is commented out upstream)
    const gpi = gbe / this.beta + gben;
    const gmu = gbc / model.betaR + gbcn;
    const go = (gbc + ((cex - cbc) * dqbdvc) / qb) / qb;
    const gm = (gex - ((cex - cbc) * dqbdve) / qb) / qb - go;

    const ceqbe = pnp * (cc + cb - vbe * (gm + go + gpi) + vbc * go);
    const ceqbc = pnp * (-cc + vbe * (gm + go) - vbc * (gmu + go));

    if (Math.abs(this.ib) === Infinity || Number.isNaN(this.ic))
      sim.stop('infinite transistor current', this);

    // stamp matrix: node 0 is the base, node 1 the collector, node 2 the emitter
    sim.stampMatrix(nodes[1], nodes[1], gmu + go);
    sim.stampMatrix(nodes[1], nodes[0], -gmu + gm);
    sim.stampMatrix(nodes[1], nodes[2], -gm - go);
    sim.stampMatrix(nodes[0], nodes[0], gpi + gmu);
    sim.stampMatrix(nodes[0], nodes[2], -gpi);
    sim.stampMatrix(nodes[0], nodes[1], -gmu);
    sim.stampMatrix(nodes[2], nodes[0], -gpi - gm);
    sim.stampMatrix(nodes[2], nodes[1], -go);
    sim.stampMatrix(nodes[2], nodes[2], gpi + gm + go);

    // load current excitation vector (right side)
    sim.stampRightSide(nodes[0], -ceqbe - ceqbc);
    sim.stampRightSide(nodes[1], ceqbc);
    sim.stampRightSide(nodes[2], ceqbe);

    // junction capacitance companion model: a conductance in parallel with a current source
    // across each junction, like CapacitorElm but voltage-dependent
    if (this.geqBE > 0) {
      // BE junction: base (node 0) to emitter (node 2)
      sim.stampMatrix(nodes[0], nodes[0], this.geqBE);
      sim.stampMatrix(nodes[2], nodes[2], this.geqBE);
      sim.stampMatrix(nodes[0], nodes[2], -this.geqBE);
      sim.stampMatrix(nodes[2], nodes[0], -this.geqBE);
      sim.stampRightSide(nodes[0], -this.ceqBE);
      sim.stampRightSide(nodes[2], this.ceqBE);
    }
    if (this.geqBC > 0) {
      // BC junction: base (node 0) to collector (node 1)
      sim.stampMatrix(nodes[0], nodes[0], this.geqBC);
      sim.stampMatrix(nodes[1], nodes[1], this.geqBC);
      sim.stampMatrix(nodes[0], nodes[1], -this.geqBC);
      sim.stampMatrix(nodes[1], nodes[0], -this.geqBC);
      sim.stampRightSide(nodes[0], -this.ceqBC);
      sim.stampRightSide(nodes[1], this.ceqBC);
    }
  }

  setBeta(b: number): void {
    this.beta = b;
    this.setup();
  }

  override stepFinished(): void {
    const nodes = this.nodes;
    // stop for huge currents that make simulator act weird
    if (Math.abs(this.ic) > 1e12 || Math.abs(this.ib) > 1e12)
      this.sim.stop('max current exceeded', this);

    // if this transistor needed gmin ramping, it was a bad iteration; after 5 in a row, give up
    // on gmin for this transistor
    if (this.localSubIters > 100) this.badIters++;
    else this.badIters = 0;

    // save junction capacitor state for the next step's companion model (circuit reference,
    // not pnp-adjusted)
    if (this.geqBE > 0) {
      this.capVoltBE = nodes[0].v - nodes[2].v;
      this.capCurBE = this.geqBE * this.capVoltBE + this.ceqBE;
    }
    if (this.geqBC > 0) {
      this.capVoltBC = nodes[0].v - nodes[1].v;
      this.capCurBC = this.geqBC * this.capVoltBC + this.ceqBC;
    }

    // add junction capacitor currents to terminal currents for display: BE flows base to
    // emitter, BC base to collector
    if (this.geqBE > 0) {
      const icapBE = this.geqBE * (nodes[0].v - nodes[2].v) + this.ceqBE;
      this.ib += icapBE;
      this.ie -= icapBE;
    }
    if (this.geqBC > 0) {
      const icapBC = this.geqBC * (nodes[0].v - nodes[1].v) + this.ceqBC;
      this.ib += icapBC;
      this.ic -= icapBC;
    }
    this.localSubIters = 0;
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 0) return -this.ib;
    if (n === 1) return -this.ic;
    return -this.ie;
  }

  /** The circle around the symbol, a setting shared by every transistor (upstream static). */
  hasCircle(): boolean {
    return (modelsFor(this.sim).transistorGlobalFlags & TransistorElm.FLAG_CIRCLE) !== 0;
  }

  override getElmType(): string {
    return 'transistor';
  }

  override getEditInfo(n: number): EditInfo | null {
    if (n === 0) return new EditInfo('Beta/hFE', this.beta, 10, 1000).setDimensionless();
    if (n === 1)
      return EditInfo.createCheckbox('Swap E/C', (this.flags & TransistorElm.FLAG_FLIP) !== 0);
    if (n === 2) return EditInfo.createCheckbox('Draw Circle', this.hasCircle());
    if (n === 3) {
      const models = modelsFor(this.sim).transistor.getModelList();
      this.models = models;
      let selected = 0;
      for (let i = 0; i !== models.length; i++) if (models[i] === this.model) selected = i;
      return EditInfo.createChoice(
        'Model',
        models.map((tm) => tm.getDescription()),
        selected,
      );
    }
    // model editing: later phase (upstream buttons 4 "Create New Model" and 5 "Edit Model")
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) {
      this.beta = ei.value;
      this.setup();
    }
    if (n === 1) {
      if (ei.checkbox?.state === true) this.flags |= TransistorElm.FLAG_FLIP;
      else this.flags &= ~TransistorElm.FLAG_FLIP;
      this.setPoints();
    }
    if (n === 2) {
      const lib = modelsFor(this.sim);
      lib.transistorGlobalFlags = ei.changeFlag(
        lib.transistorGlobalFlags,
        TransistorElm.FLAG_CIRCLE,
      );
      return;
    }
    if (n === 3) {
      const models = this.models ?? modelsFor(this.sim).transistor.getModelList();
      this.model = models[ei.choice?.selected ?? 0];
      this.modelName = this.model.name;
      this.setup();
      ei.newDialog = true;
      return;
    }
  }

  override flipX(c2: number, count: number): void {
    if (this.x === this.x2) this.flags ^= TransistorElm.FLAG_FLIP;
    super.flipX(c2, count);
  }

  override flipY(c2: number, count: number): void {
    if (this.y === this.y2) this.flags ^= TransistorElm.FLAG_FLIP;
    super.flipY(c2, count);
  }

  override flipXY(xmy: number, count: number): void {
    this.flags ^= TransistorElm.FLAG_FLIP;
    super.flipXY(xmy, count);
  }

  setFlipped(flip: boolean): void {
    if (((this.flags & TransistorElm.FLAG_FLIP) !== 0) !== flip)
      this.flags ^= TransistorElm.FLAG_FLIP;
  }
}

/** Placed from the menu as NPN; also what an XML `t` element is constructed as. */
export class NTransistorElm extends TransistorElm {
  override getClassName(): string {
    return 'NTransistorElm';
  }
  override getShortcut(): number {
    return 'n'.charCodeAt(0);
  }
}

export class PTransistorElm extends TransistorElm {
  override getClassName(): string {
    return 'PTransistorElm';
  }
  override getShortcut(): number {
    return 'p'.charCodeAt(0);
  }
  override initNew(): void {
    this.initTransistor(true);
  }
}

/**
 * Upstream registers both variants under TransistorElm (`getDumpClass()`): text `t` lines load
 * as TransistorElm, and `constructElement("TransistorElm")` (XML `t`) builds an NTransistorElm.
 */
export const TransistorElmType: ElementType = {
  className: 'TransistorElm',
  create(x, y, sim) {
    const e = new NTransistorElm(x, y, x, y, 0);
    e.sim = sim;
    e.initNew();
    return e;
  },
  load(x1, y1, x2, y2, f, st, sim) {
    const e = new TransistorElm(x1, y1, x2, y2, f);
    e.sim = sim;
    e.undump(st);
    return e;
  },
};

export const NTransistorElmType = elementType('NTransistorElm', NTransistorElm);
export const PTransistorElmType = elementType('PTransistorElm', PTransistorElm);

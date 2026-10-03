// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/TransistorModel.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032. The model edit dialog is left for a later phase.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { unescapeToken } from '../escape.ts';
import { parseJavaDouble, parseJavaInt } from '../java.ts';
import { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlDocWriter } from '../xml.ts';

/** Java `String.compareTo` order on model names (UTF-16 code units), for the model lists. */
function compareNames(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** SPICE Gummel-Poon parameters (bjtload.c names in comments). */
export class TransistorModel {
  flags = 0;
  name = '';
  description: string | null = null;
  satCur = 0; // IS
  invRollOffF = 0; // 1/IKF
  BEleakCur = 0; // ISE
  leakBEemissionCoeff = 0; // NE
  invRollOffR = 0; // 1/IKR
  BCleakCur = 0; // ISC
  leakBCemissionCoeff = 0; // NC
  emissionCoeffF = 0; // NF
  emissionCoeffR = 0; // NR
  invEarlyVoltF = 0; // 1/VAF
  invEarlyVoltR = 0; // 1/VAR
  betaR = 0; // BR

  // Junction capacitance (SPICE charge storage): C(V) = Cj0 / (1 - V/Vj)^Mj for V < 0.5*Vj,
  // linearly extrapolated above. 0 disables.
  junctionCapBE = 0; // CJE
  junctionCapBC = 0; // CJC
  junctionPotBE = 0.75; // VJE
  junctionPotBC = 0.75; // VJC
  junctionExpBE = 0.33; // MJE
  junctionExpBC = 0.33; // MJC
  // Transit times (diffusion capacitance Cd = TT * gm). 0 disables.
  transitTimeF = 0; // TF
  transitTimeR = 0; // TR

  dumped = false;
  readOnly = false;
  builtIn = false;
  internal = false;

  /** Upstream `TransistorModel(String d, double sc)`. */
  static withSatCur(d: string, sc: number): TransistorModel {
    const m = new TransistorModel();
    m.description = d;
    m.satCur = sc;
    m.emissionCoeffF = m.emissionCoeffR = 1;
    m.leakBEemissionCoeff = 1.5;
    m.leakBCemissionCoeff = 2;
    m.betaR = 1;
    m.updateModel();
    return m;
  }

  static copyOf(copy: TransistorModel): TransistorModel {
    const m = new TransistorModel();
    m.flags = copy.flags;
    m.satCur = copy.satCur;
    m.invRollOffF = copy.invRollOffF;
    m.BEleakCur = copy.BEleakCur;
    m.leakBEemissionCoeff = copy.leakBEemissionCoeff;
    m.invRollOffR = copy.invRollOffR;
    m.BCleakCur = copy.BCleakCur;
    m.leakBCemissionCoeff = copy.leakBCemissionCoeff;
    m.emissionCoeffF = copy.emissionCoeffF;
    m.emissionCoeffR = copy.emissionCoeffR;
    m.invEarlyVoltF = copy.invEarlyVoltF;
    m.invEarlyVoltR = copy.invEarlyVoltR;
    m.betaR = copy.betaR;
    m.junctionCapBE = copy.junctionCapBE;
    m.junctionPotBE = copy.junctionPotBE;
    m.junctionExpBE = copy.junctionExpBE;
    m.junctionCapBC = copy.junctionCapBC;
    m.junctionPotBC = copy.junctionPotBC;
    m.junctionExpBC = copy.junctionExpBC;
    m.transitTimeF = copy.transitTimeF;
    m.transitTimeR = copy.transitTimeR;
    m.updateModel();
    return m;
  }

  /** Name and description, as the model choice lists them. */
  getDescription(): string {
    if (this.description === null || this.description === this.name) return this.name;
    return this.name + ' (' + this.description + ')';
  }

  undump(st: StringTokenizer): void {
    this.flags = parseJavaInt(st.nextToken());
    this.satCur = parseJavaDouble(st.nextToken());
    this.invRollOffF = parseJavaDouble(st.nextToken());
    this.BEleakCur = parseJavaDouble(st.nextToken());
    this.leakBEemissionCoeff = parseJavaDouble(st.nextToken());
    this.invRollOffR = parseJavaDouble(st.nextToken());
    this.BCleakCur = parseJavaDouble(st.nextToken());
    this.leakBCemissionCoeff = parseJavaDouble(st.nextToken());
    this.emissionCoeffF = parseJavaDouble(st.nextToken());
    this.emissionCoeffR = parseJavaDouble(st.nextToken());
    this.invEarlyVoltF = parseJavaDouble(st.nextToken());
    this.invEarlyVoltR = parseJavaDouble(st.nextToken());
    this.betaR = parseJavaDouble(st.nextToken());
    // junction capacitance parameters (optional, for backward compatibility)
    try {
      this.junctionCapBE = parseJavaDouble(st.nextToken());
      this.junctionPotBE = parseJavaDouble(st.nextToken());
      this.junctionExpBE = parseJavaDouble(st.nextToken());
      this.junctionCapBC = parseJavaDouble(st.nextToken());
      this.junctionPotBC = parseJavaDouble(st.nextToken());
      this.junctionExpBC = parseJavaDouble(st.nextToken());
    } catch {
      // optional
    }
    try {
      this.transitTimeF = parseJavaDouble(st.nextToken());
      this.transitTimeR = parseJavaDouble(st.nextToken());
    } catch {
      // optional
    }
    this.updateModel();
  }

  dumpXml(doc: XmlDocWriter): void {
    this.dumped = true;
    const w = doc.addElement('tm');
    w.dumpAttr('nm', this.name);
    w.dumpAttr('f', this.flags);
    w.dumpAttr('is', this.satCur);
    w.dumpAttr('ikf', this.invRollOffF);
    w.dumpAttr('ise', this.BEleakCur);
    w.dumpAttr('ne', this.leakBEemissionCoeff);
    w.dumpAttr('ikr', this.invRollOffR);
    w.dumpAttr('isc', this.BCleakCur);
    w.dumpAttr('nc', this.leakBCemissionCoeff);
    w.dumpAttr('nf', this.emissionCoeffF);
    w.dumpAttr('nr', this.emissionCoeffR);
    w.dumpAttr('vaf', this.invEarlyVoltF);
    w.dumpAttr('var', this.invEarlyVoltR);
    w.dumpAttr('br', this.betaR);
    if (this.junctionCapBE !== 0) {
      w.dumpAttr('cje', this.junctionCapBE);
      w.dumpAttr('vje', this.junctionPotBE);
      w.dumpAttr('mje', this.junctionExpBE);
    }
    if (this.junctionCapBC !== 0) {
      w.dumpAttr('cjc', this.junctionCapBC);
      w.dumpAttr('vjc', this.junctionPotBC);
      w.dumpAttr('mjc', this.junctionExpBC);
    }
    if (this.transitTimeF !== 0) w.dumpAttr('tf', this.transitTimeF);
    if (this.transitTimeR !== 0) w.dumpAttr('tr', this.transitTimeR);
  }

  undumpXml(r: XmlAttrReader): void {
    this.flags = r.parseIntAttr('f', this.flags);
    this.satCur = r.parseDoubleAttr('is', this.satCur);
    this.invRollOffF = r.parseDoubleAttr('ikf', this.invRollOffF);
    this.BEleakCur = r.parseDoubleAttr('ise', this.BEleakCur);
    this.leakBEemissionCoeff = r.parseDoubleAttr('ne', this.leakBEemissionCoeff);
    this.invRollOffR = r.parseDoubleAttr('ikr', this.invRollOffR);
    this.BCleakCur = r.parseDoubleAttr('isc', this.BCleakCur);
    this.leakBCemissionCoeff = r.parseDoubleAttr('nc', this.leakBCemissionCoeff);
    this.emissionCoeffF = r.parseDoubleAttr('nf', this.emissionCoeffF);
    this.emissionCoeffR = r.parseDoubleAttr('nr', this.emissionCoeffR);
    this.invEarlyVoltF = r.parseDoubleAttr('vaf', this.invEarlyVoltF);
    this.invEarlyVoltR = r.parseDoubleAttr('var', this.invEarlyVoltR);
    this.betaR = r.parseDoubleAttr('br', this.betaR);
    this.junctionCapBE = r.parseDoubleAttr('cje', this.junctionCapBE);
    this.junctionPotBE = r.parseDoubleAttr('vje', this.junctionPotBE);
    this.junctionExpBE = r.parseDoubleAttr('mje', this.junctionExpBE);
    this.junctionCapBC = r.parseDoubleAttr('cjc', this.junctionCapBC);
    this.junctionPotBC = r.parseDoubleAttr('vjc', this.junctionPotBC);
    this.junctionExpBC = r.parseDoubleAttr('mjc', this.junctionExpBC);
    this.transitTimeF = r.parseDoubleAttr('tf', this.transitTimeF);
    this.transitTimeR = r.parseDoubleAttr('tr', this.transitTimeR);
    this.updateModel();
  }

  updateModel(): void {}
}

/** Upstream's static `TransistorModel.modelMap` and its functions, one per simulation. */
export class TransistorModels {
  readonly modelMap = new Map<string, TransistorModel>();

  constructor() {
    this.addDefaultModel('default', TransistorModel.withSatCur('default', 1e-13));
    this.addDefaultModel('spice-default', TransistorModel.withSatCur('spice-default', 1e-16));

    // for LM324v2 OpAmpRealElm
    this.loadInternalModel(
      'xlm324v2-qpi 0 1.01e-16 333.3333333333333 0 1.5 0 0 2 1 1 0.0034482758620689655 0 1',
    );
    this.loadInternalModel(
      'xlm324v2-qpi 0 1.01e-16 333.3333333333333 0 1.5 0 0 2 1 1 0.0034482758620689655 0 1',
    );
    this.loadInternalModel(
      'xlm324v2-qpa 0 1.01e-16 333.3333333333333 0 1.5 0 0 2 1 1 0.004081632653061225 0 1',
    );
    this.loadInternalModel('xlm324v2-qnq 0 1e-16 200 0 1.5 0 0 2 1 1 0 0 1');
    this.loadInternalModel('xlm324v2-qpq 0 1e-16 333.3333333333333 0 1.5 0 0 2 1 1 0 0 1');

    // for TL431
    this.loadInternalModel('~tl431ed-qn_ed 0 1e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1');
    this.loadInternalModel('~tl431ed-qn_ed-A1.2 0 1.2e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1');
    this.loadInternalModel(
      '~tl431ed-qn_ed-A2.2 0 2.2000000000000002e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1',
    );
    this.loadInternalModel('~tl431ed-qn_ed-A0.5 0 5e-17 0 0 1.5 0 0 2 1 1 0.0125 0.02 1');
    this.loadInternalModel('~tl431ed-qp_ed 0 1e-16 0 0 1.5 0 0 2 1 1 0.014285714285714285 0.025 1');
    this.loadInternalModel('~tl431ed-qn_ed-A5 0 5e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1');

    // for LM317
    this.loadInternalModel('~lm317-qpl-A0.1 0 1e-17 0 0 1.5 0 0 2 1 1 0.02 0 1');
    this.loadInternalModel('~lm317-qnl-A0.2 0 2e-17 0 0 1.5 0 0 2 1 1 0.01 0 1');
    this.loadInternalModel('~lm317-qpl-A0.2 0 2e-17 0 0 1.5 0 0 2 1 1 0.02 0 1');
    this.loadInternalModel('~lm317-qnl-A2 0 2e-16 0 0 1.5 0 0 2 1 1 0.01 0 1');
    this.loadInternalModel('~lm317-qpl-A2 0 2e-16 0 0 1.5 0 0 2 1 1 0.02 0 1');
    this.loadInternalModel('~lm317-qnl-A5 0 5e-16 0 0 1.5 0 0 2 1 1 0.01 0 1');
    this.loadInternalModel('~lm317-qnl-A50 0 5e-15 0 0 1.5 0 0 2 1 1 0.01 0 1');
  }

  private addDefaultModel(name: string, tm: TransistorModel): void {
    this.modelMap.set(name, tm);
    tm.readOnly = tm.builtIn = true;
    tm.name = name;
  }

  private loadInternalModel(s: string): void {
    const tm = this.undumpModel(new StringTokenizer(s));
    tm.builtIn = tm.internal = true;
  }

  getModelWithName(name: string): TransistorModel {
    let lm = this.modelMap.get(name);
    if (lm !== undefined) return lm;
    lm = new TransistorModel();
    lm.name = name;
    this.modelMap.set(name, lm);
    return lm;
  }

  getModelWithNameOrCopy(name: string, oldmodel: TransistorModel | null): TransistorModel {
    let lm = this.modelMap.get(name);
    if (lm !== undefined) return lm;
    // upstream logs "model not found" here
    if (oldmodel === null) return this.getDefaultModel();
    lm = TransistorModel.copyOf(oldmodel);
    lm.name = name;
    this.modelMap.set(name, lm);
    return lm;
  }

  /** Models the user can pick (upstream `getModelList`), sorted by name. */
  getModelList(): TransistorModel[] {
    const vector: TransistorModel[] = [];
    for (const tm of this.modelMap.values()) {
      if (tm.internal) continue;
      if (!vector.includes(tm)) vector.push(tm);
    }
    return vector.sort(compareNames);
  }

  getDefaultModel(): TransistorModel {
    return this.getModelWithName('default');
  }

  undumpModel(st: StringTokenizer): TransistorModel {
    const name = unescapeToken(st.nextToken());
    const tm = this.getModelWithName(name);
    tm.undump(st);
    return tm;
  }

  undumpModelXml(r: XmlAttrReader): TransistorModel {
    const name = r.parseStringAttr('nm', null);
    const tm = this.getModelWithName(name ?? 'null');
    tm.undumpXml(r);
    return tm;
  }

  clearDumpedFlags(): void {
    for (const tm of this.modelMap.values()) tm.dumped = false;
  }
}

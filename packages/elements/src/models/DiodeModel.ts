// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/DiodeModel.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032. The model edit dialog is left for a later phase.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { escapeToken, unescapeToken } from '../escape.ts';
import { parseJavaDouble, parseJavaInt } from '../java.ts';
import { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlDocWriter } from '../xml.ts';

/** Java `String.compareTo` order on model names (UTF-16 code units), for the model lists. */
function compareNames(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Electron thermal voltage at SPICE's default temperature of 27 C (300.15 K). */
const vt = 0.025865;

export class DiodeModel {
  static readonly FLAGS_SIMPLE = 1;

  flags = 0;
  name = '';
  description: string | null = null;
  saturationCurrent: number;
  seriesResistance: number;
  emissionCoefficient: number;
  breakdownVoltage: number;
  // used for UI code, not guaranteed to be set
  forwardVoltage = 0;
  forwardCurrent = 0;

  dumped = false;
  readOnly = false;
  builtIn = false;
  oldStyle = false;
  internal = false;

  /** The diode's "scale voltage": the voltage increase that raises current by a factor of e. */
  vscale = 0;
  /** 1 / vscale, for speed. */
  vdcoef = 0;
  /** Voltage drop at 1 A. */
  fwdrop = 0;

  constructor(sc = 1e-14, sr = 0, ec = 1, bv = 0, d: string | null = null) {
    this.saturationCurrent = sc;
    this.seriesResistance = sr;
    this.emissionCoefficient = ec;
    this.breakdownVoltage = bv;
    this.description = d;
    this.updateModel();
  }

  /** Upstream's copy constructor: parameters only, no name or status flags. */
  static copyOf(copy: DiodeModel): DiodeModel {
    const m = new DiodeModel(
      copy.saturationCurrent,
      copy.seriesResistance,
      copy.emissionCoefficient,
      copy.breakdownVoltage,
    );
    m.flags = copy.flags;
    m.forwardCurrent = copy.forwardCurrent;
    m.updateModel();
    return m;
  }

  setInternal(): this {
    this.internal = true;
    return this;
  }

  undump(st: StringTokenizer): void {
    this.flags = parseJavaInt(st.nextToken());
    this.saturationCurrent = parseJavaDouble(st.nextToken());
    this.seriesResistance = parseJavaDouble(st.nextToken());
    this.emissionCoefficient = parseJavaDouble(st.nextToken());
    this.breakdownVoltage = parseJavaDouble(st.nextToken());
    try {
      this.forwardCurrent = parseJavaDouble(st.nextToken());
    } catch {
      // optional
    }
    this.updateModel();
  }

  undumpXml(r: XmlAttrReader): void {
    this.flags = r.parseIntAttr('f', this.flags);
    this.saturationCurrent = r.parseDoubleAttr('is', this.saturationCurrent);
    this.seriesResistance = r.parseDoubleAttr('rs', this.seriesResistance);
    this.emissionCoefficient = r.parseDoubleAttr('n', this.emissionCoefficient);
    this.breakdownVoltage = r.parseDoubleAttr('bv', this.breakdownVoltage);
    this.forwardCurrent = r.parseDoubleAttr('fi', this.forwardCurrent);
    this.updateModel();
  }

  /** The legacy text record (`34 ...`). */
  dump(): string {
    this.dumped = true;
    return `34 ${escapeToken(this.name)} ${this.flags} ${this.saturationCurrent} ${this.seriesResistance} ${this.emissionCoefficient} ${this.breakdownVoltage} ${this.forwardCurrent}`;
  }

  dumpXml(doc: XmlDocWriter): void {
    this.dumped = true;
    const w = doc.addElement('dm');
    w.dumpAttr('nm', this.name);
    w.dumpAttr('f', this.flags);
    w.dumpAttr('is', this.saturationCurrent);
    w.dumpAttr('rs', this.seriesResistance);
    w.dumpAttr('n', this.emissionCoefficient);
    w.dumpAttr('bv', this.breakdownVoltage);
    if (this.forwardCurrent > 0) w.dumpAttr('fi', this.forwardCurrent);
  }

  isSimple(): boolean {
    return (this.flags & DiodeModel.FLAGS_SIMPLE) !== 0;
  }

  /** Name and description, as the model choice lists them. */
  getDescription(): string {
    if (this.description === null) return this.name;
    return this.name + ' (' + this.description + ')';
  }

  updateModel(): void {
    this.vscale = this.emissionCoefficient * vt;
    this.vdcoef = 1 / this.vscale;
    this.fwdrop = Math.log(1 / this.saturationCurrent + 1) * this.emissionCoefficient * vt;
  }
}

/**
 * Upstream's static `DiodeModel.modelMap` and the functions around it, one per simulation.
 * Upstream's map is a `java.util.HashMap`, which GWT backs with a JS Map for string keys, so
 * iteration (used by getModelWithParameters) is in insertion order here as there.
 */
export class DiodeModels {
  readonly modelMap = new Map<string, DiodeModel>();

  constructor() {
    this.addDefaultModel('spice-default', new DiodeModel(1e-14, 0, 1, 0, null));
    this.addDefaultModel('default', new DiodeModel(1.7143528192808883e-7, 0, 2, 0, null));
    this.addDefaultModel('default-zener', new DiodeModel(1.7143528192808883e-7, 0, 2, 5.6, null));

    // old default LED with saturation current that is way too small (causes numerical errors)
    this.addDefaultModel(
      'old-default-led',
      new DiodeModel(2.2349907006671927e-18, 0, 2, 0, null).setInternal(),
    );

    // default for newly created LEDs, https://www.diyaudio.com/forums/software-tools/25884-spice-models-led.html
    this.addDefaultModel('default-led', new DiodeModel(93.2e-12, 0.042, 3.73, 0, null));

    this.addDefaultModel('default-optocoupler-led', new DiodeModel(1.714e-7, 0, 4.077, 0, null));

    // https://www.allaboutcircuits.com/textbook/semiconductors/chpt-3/spice-models/
    this.addDefaultModel('1N5711', new DiodeModel(315e-9, 2.8, 2.03, 70, 'Schottky'));
    this.addDefaultModel('1N5712', new DiodeModel(680e-12, 12, 1.003, 20, 'Schottky'));

    // https://github.com/peteut/spice-models/blob/master/nxp/sbd/sbd.txt
    this.addDefaultModel('BAT85', new DiodeModel(2.076e-7, 2.326, 1.023, 33, 'Schottky'));

    // model is inaccurate
    this.addDefaultModel(
      '1N34',
      new DiodeModel(200e-12, 84e-3, 2.19, 60, 'germanium').setInternal(),
    );

    this.addDefaultModel('1N4004', new DiodeModel(18.8e-9, 28.6e-3, 2, 400, 'general purpose'));

    // http://users.skynet.be/hugocoolens/spice/diodes/1n4148.htm
    this.addDefaultModel('1N4148', new DiodeModel(4.352e-9, 0.6458, 1.906, 75, 'switching'));
    this.addDefaultModel(
      'x2n2646-emitter',
      new DiodeModel(2.13e-11, 0, 1.8, 0, null).setInternal(),
    );

    // for TL431
    this.loadInternalModel('~tl431ed-d_ed 0 1e-14 5 1 0 0');

    // for LM317
    this.loadInternalModel('~lm317-dz 0 1e-14 0 1 6.3 0');
  }

  private addDefaultModel(name: string, dm: DiodeModel): void {
    this.modelMap.set(name, dm);
    dm.readOnly = dm.builtIn = true;
    dm.name = name;
  }

  private loadInternalModel(s: string): void {
    const dm = this.undumpModel(new StringTokenizer(s));
    dm.builtIn = dm.internal = true;
  }

  getModelWithName(name: string): DiodeModel {
    let lm = this.modelMap.get(name);
    if (lm !== undefined) return lm;
    lm = new DiodeModel();
    lm.name = name;
    this.modelMap.set(name, lm);
    return lm;
  }

  getModelWithNameOrCopy(name: string, oldmodel: DiodeModel | null): DiodeModel {
    let lm = this.modelMap.get(name);
    if (lm !== undefined) return lm;
    // upstream logs "model not found" here
    if (oldmodel === null) return this.getDefaultModel();
    lm = DiodeModel.copyOf(oldmodel);
    lm.name = name;
    this.modelMap.set(name, lm);
    return lm;
  }

  /**
   * A model with the given parameters, for old files. Upstream keeps this for backward
   * compatibility only: changing the leakage current to get a given fwdrop works badly.
   */
  getModelWithParameters(fwdrop: number, zvoltage: number): DiodeModel {
    const emcoef = 2;

    // look for an existing model with the same parameters
    for (const dm of this.modelMap.values()) {
      if (
        Math.abs(dm.fwdrop - fwdrop) < 1e-8 &&
        dm.seriesResistance === 0 &&
        Math.abs(dm.breakdownVoltage - zvoltage) < 1e-8 &&
        dm.emissionCoefficient === emcoef
      )
        return dm;
    }

    // create a new one, converting to new parameter values
    const vscale = emcoef * vt;
    const vdcoef = 1 / vscale;
    const leakage = 1 / (Math.exp(fwdrop * vdcoef) - 1);
    // Java string concatenation of a double is JS number formatting in the GWT build
    let name = 'fwdrop=' + String(fwdrop);
    if (zvoltage !== 0) name = name + ' zvoltage=' + String(zvoltage);
    const dm = this.getModelWithName(name);
    dm.saturationCurrent = leakage;
    dm.emissionCoefficient = emcoef;
    dm.breakdownVoltage = zvoltage;
    dm.readOnly = dm.oldStyle = true;
    dm.updateModel();
    return dm;
  }

  /** Models the user can pick (upstream `getModelList`), sorted by name; zener: only Zeners. */
  getModelList(zener: boolean): DiodeModel[] {
    const vector: DiodeModel[] = [];
    for (const dm of this.modelMap.values()) {
      if (dm.internal) continue;
      if (zener && dm.breakdownVoltage === 0) continue;
      if (!vector.includes(dm)) vector.push(dm);
    }
    return vector.sort(compareNames);
  }

  getDefaultModel(): DiodeModel {
    return this.getModelWithName('default');
  }

  undumpModel(st: StringTokenizer): DiodeModel {
    const name = unescapeToken(st.nextToken());
    const dm = this.getModelWithName(name);
    dm.undump(st);
    return dm;
  }

  undumpModelXml(r: XmlAttrReader): DiodeModel {
    const name = r.parseStringAttr('nm', null);
    // upstream would key the map with null; no valid file does this
    const dm = this.getModelWithName(name ?? 'null');
    dm.undumpXml(r);
    return dm;
  }

  clearDumpedFlags(): void {
    for (const dm of this.modelMap.values()) dm.dumped = false;
  }
}

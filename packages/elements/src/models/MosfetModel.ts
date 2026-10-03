// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/MosfetModel.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032. The model edit dialog is left for a later phase.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { unescapeToken } from '../escape.ts';
import { parseJavaDouble, parseJavaInt } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlDocWriter } from '../xml.ts';

/** Java `String.compareTo` order on model names (UTF-16 code units), for the model lists. */
function compareNames(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export class MosfetModel {
  static readonly FLAG_JFET = 1;

  flags = 0;
  name = '';
  description: string | null = null;
  /** Vt: threshold voltage (V). */
  threshold = 1.5;
  /** Transconductance parameter (A/V^2). */
  beta = 0.02;
  /** Channel-length modulation (1/V), 0 = ideal. */
  lambda = 0;
  /** Gate-source capacitance (F), 0 = disabled. */
  capGS = 0;
  /** Gate-drain capacitance (F), 0 = disabled. */
  capGD = 0;
  showBulk = true;
  /** Draw as a simple digital-logic symbol (only if !showBulk). */
  digitalSymbol = false;
  /** Simulate the parasitic body diode (only if showBulk). */
  bodyDiode = true;
  /** Expose the body as a fourth terminal (only if bodyDiode). */
  bodyTerminal = false;
  /** Draw the body diode symbol (only if bodyDiode). */
  showBodyDiodeSymbol = false;

  dumped = false;
  readOnly = false;
  builtIn = false;
  internal = false;
  oldStyle = false;

  /** Upstream `MosfetModel(String d, double vt, double b)`; no arguments is `MosfetModel()`. */
  constructor(d: string | null = null, vt = 1.5, b = 0.02) {
    this.description = d;
    this.threshold = vt;
    this.beta = b;
  }

  static copyOf(copy: MosfetModel): MosfetModel {
    const m = new MosfetModel();
    m.description = null;
    m.flags = copy.flags;
    m.threshold = copy.threshold;
    m.beta = copy.beta;
    m.lambda = copy.lambda;
    m.capGS = copy.capGS;
    m.capGD = copy.capGD;
    m.showBulk = copy.showBulk;
    m.digitalSymbol = copy.digitalSymbol;
    m.bodyDiode = copy.bodyDiode;
    m.bodyTerminal = copy.bodyTerminal;
    m.showBodyDiodeSymbol = copy.showBodyDiodeSymbol;
    return m;
  }

  isJfet(): boolean {
    return (this.flags & MosfetModel.FLAG_JFET) !== 0;
  }

  /** Name and description, as the model choice lists them. */
  getDescription(): string {
    if (this.description === null || this.description === this.name) return this.name;
    return this.name + ' (' + this.description + ')';
  }

  setJfet(): this {
    this.flags |= MosfetModel.FLAG_JFET;
    return this;
  }

  undump(st: StringTokenizer): void {
    this.flags = parseJavaInt(st.nextToken());
    this.threshold = parseJavaDouble(st.nextToken());
    this.beta = parseJavaDouble(st.nextToken());
    try {
      this.lambda = parseJavaDouble(st.nextToken());
    } catch {
      // optional
    }
    try {
      this.capGS = parseJavaDouble(st.nextToken());
      this.capGD = parseJavaDouble(st.nextToken());
    } catch {
      // optional
    }
    try {
      this.showBulk = parseJavaInt(st.nextToken()) !== 0;
      this.digitalSymbol = parseJavaInt(st.nextToken()) !== 0;
      this.bodyDiode = parseJavaInt(st.nextToken()) !== 0;
      this.bodyTerminal = parseJavaInt(st.nextToken()) !== 0;
      this.showBodyDiodeSymbol = parseJavaInt(st.nextToken()) !== 0;
    } catch {
      // optional
    }
  }

  dumpXml(doc: XmlDocWriter): void {
    this.dumped = true;
    const w = doc.addElement('mm');
    w.dumpAttr('nm', this.name);
    w.dumpAttr('f', this.flags);
    w.dumpAttr('vt', this.threshold);
    w.dumpAttr('be', this.beta);
    if (this.lambda !== 0) w.dumpAttr('la', this.lambda);
    if (this.capGS !== 0) w.dumpAttr('cgs', this.capGS);
    if (this.capGD !== 0) w.dumpAttr('cgd', this.capGD);
    w.dumpAttr('sb', this.showBulk ? 1 : 0);
    w.dumpAttr('dsy', this.digitalSymbol ? 1 : 0);
    w.dumpAttr('bd', this.bodyDiode ? 1 : 0);
    w.dumpAttr('bt', this.bodyTerminal ? 1 : 0);
    w.dumpAttr('sbd', this.showBodyDiodeSymbol ? 1 : 0);
  }

  undumpXml(r: XmlAttrReader): void {
    this.flags = r.parseIntAttr('f', this.flags);
    this.threshold = r.parseDoubleAttr('vt', this.threshold);
    this.beta = r.parseDoubleAttr('be', this.beta);
    this.lambda = r.parseDoubleAttr('la', this.lambda);
    this.capGS = r.parseDoubleAttr('cgs', this.capGS);
    this.capGD = r.parseDoubleAttr('cgd', this.capGD);
    this.showBulk = r.parseIntAttr('sb', this.showBulk ? 1 : 0) !== 0;
    this.digitalSymbol = r.parseIntAttr('dsy', this.digitalSymbol ? 1 : 0) !== 0;
    this.bodyDiode = r.parseIntAttr('bd', this.bodyDiode ? 1 : 0) !== 0;
    this.bodyTerminal = r.parseIntAttr('bt', this.bodyTerminal ? 1 : 0) !== 0;
    this.showBodyDiodeSymbol = r.parseIntAttr('sbd', this.showBodyDiodeSymbol ? 1 : 0) !== 0;
  }
}

/** Upstream's static `MosfetModel.modelMap` and its functions, one per simulation. */
export class MosfetModels {
  readonly modelMap = new Map<string, MosfetModel>();

  constructor() {
    this.addDefaultModel('default', new MosfetModel('default', 1.5, 0.02));
    const noDiodeDefault = new MosfetModel('default-nodiode', 1.5, 0.02);
    noDiodeDefault.bodyDiode = false;
    this.addDefaultModel('default-nodiode', noDiodeDefault);
    const bodyTerminalDefault = new MosfetModel('default-body', 1.5, 0.02);
    bodyTerminalDefault.bodyTerminal = true;
    this.addDefaultModel('default-body', bodyTerminalDefault);
    const digitalDefault = new MosfetModel('default-digital', 1.5, 0.02);
    digitalDefault.showBulk = false;
    digitalDefault.digitalSymbol = true;
    digitalDefault.bodyDiode = false;
    this.addDefaultModel('default-digital', digitalDefault);
    const jfetDefault = new MosfetModel('default-jfet', -4, 0.00125).setJfet();
    jfetDefault.showBulk = jfetDefault.bodyDiode = false;
    this.addDefaultModel('default-jfet', jfetDefault);
  }

  private addDefaultModel(name: string, mm: MosfetModel): void {
    this.modelMap.set(name, mm);
    mm.readOnly = mm.builtIn = true;
    mm.name = name;
  }

  getModelWithName(name: string): MosfetModel {
    let lm = this.modelMap.get(name);
    if (lm !== undefined) return lm;
    lm = new MosfetModel();
    lm.name = name;
    this.modelMap.set(name, lm);
    return lm;
  }

  getModelWithNameOrCopy(name: string, oldmodel: MosfetModel | null, jfet: boolean): MosfetModel {
    let lm = this.modelMap.get(name);
    if (lm !== undefined) return lm;
    // upstream logs "model not found" here
    if (oldmodel === null) return this.getDefaultModel(jfet);
    lm = MosfetModel.copyOf(oldmodel);
    lm.name = name;
    this.modelMap.set(name, lm);
    return lm;
  }

  /** Models the user can pick (upstream `getModelList`), sorted by name; MOSFETs or JFETs. */
  getModelList(jfet: boolean): MosfetModel[] {
    const vector: MosfetModel[] = [];
    for (const mm of this.modelMap.values()) {
      if (mm.internal || mm.isJfet() !== jfet) continue;
      if (!vector.includes(mm)) vector.push(mm);
    }
    return vector.sort(compareNames);
  }

  getDefaultModel(jfet: boolean): MosfetModel {
    return this.getModelWithName(jfet ? 'default-jfet' : 'default');
  }

  /** A model for old files that stored threshold, beta and display flags on the element. */
  getModelWithParameters(
    vt: number,
    beta: number,
    jfet: boolean,
    showBulk: boolean,
    bodyDiode: boolean,
    bodyTerminal: boolean,
    digitalSymbol: boolean,
    showBodyDiodeSymbol: boolean,
  ): MosfetModel {
    for (const mm of this.modelMap.values()) {
      if (
        mm.isJfet() === jfet &&
        Math.abs(mm.threshold - vt) < 1e-15 &&
        Math.abs(mm.beta - beta) < 1e-15 &&
        mm.lambda === 0 &&
        mm.capGS === 0 &&
        mm.capGD === 0 &&
        mm.showBulk === showBulk &&
        mm.bodyDiode === bodyDiode &&
        mm.bodyTerminal === bodyTerminal &&
        mm.digitalSymbol === digitalSymbol &&
        mm.showBodyDiodeSymbol === showBodyDiodeSymbol
      )
        return mm;
    }
    const baseName = 'old-' + (jfet ? 'jfet' : 'mosfet');
    let name = baseName;
    if (this.modelMap.get(name) !== undefined) {
      for (let num = 2; ; num++) {
        const n = baseName + '-' + num;
        if (this.modelMap.get(n) === undefined) {
          name = n;
          break;
        }
      }
    }
    const mm = this.getModelWithName(name);
    mm.threshold = vt;
    mm.beta = beta;
    mm.showBulk = showBulk;
    mm.bodyDiode = bodyDiode;
    mm.bodyTerminal = bodyTerminal;
    mm.digitalSymbol = digitalSymbol;
    mm.showBodyDiodeSymbol = showBodyDiodeSymbol;
    if (jfet) mm.setJfet();
    mm.oldStyle = true;
    return mm;
  }

  undumpModel(st: StringTokenizer): MosfetModel {
    const name = unescapeToken(st.nextToken());
    const mm = this.getModelWithName(name);
    mm.undump(st);
    return mm;
  }

  undumpModelXml(r: XmlAttrReader): MosfetModel {
    const name = r.parseStringAttr('nm', null);
    const mm = this.getModelWithName(name ?? 'null');
    mm.undumpXml(r);
    return mm;
  }

  clearDumpedFlags(): void {
    for (const mm of this.modelMap.values()) mm.dumped = false;
  }
}

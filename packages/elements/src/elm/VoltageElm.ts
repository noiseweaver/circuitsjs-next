// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/VoltageElm.java, DCVoltageElm.java and ACVoltageElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/VoltageElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { FindPathInfo, PathType, type VoltageSource } from '@circuitjs-next/engine';
import { CircuitElm, type ElementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { parseJavaDouble, parseJavaInt } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

const pi = Math.PI;

export class VoltageElm extends CircuitElm {
  static readonly FLAG_COS = 2;
  static readonly FLAG_PULSE_DUTY = 4;
  static readonly FLAG_CIRCLE_SYMBOL = 8;
  static readonly FLAG_SHOW_VOLTAGE = 16;
  static readonly FLAG_TIME_SPEC = 32;
  /** Separate because old RailElms may have FLAG_SHOW_VOLTAGE set though it did nothing. */
  static readonly FLAG_SHOW_VOLTAGE_RAIL = 64;

  static readonly WF_DC = 0;
  static readonly WF_AC = 1;
  static readonly WF_SQUARE = 2;
  static readonly WF_TRIANGLE = 3;
  static readonly WF_SAWTOOTH = 4;
  static readonly WF_PULSE = 5;
  static readonly WF_NOISE = 6;
  static readonly WF_VAR = 7;

  static readonly defaultPulseDuty = 1 / (2 * Math.PI);

  /**
   * Asked when a new frequency is too high for the timestep (upstream `Window.confirm`): true
   * shrinks the maximum timestep, false caps the frequency. Null (no UI) caps it.
   */
  static confirmAdjustTimestep: ((message: string) => boolean) | null = null;

  waveform = 0;
  frequency = 0;
  maxVoltage = 0;
  freqTimeZero = 0;
  bias = 0;
  phaseShift = 0;
  dutyCycle = 0;
  noiseValue = 0;
  riseTime = 0;
  internalResistance = 0;

  override getClassName(): string {
    return 'VoltageElm';
  }
  override getDumpType(): number {
    return 'v'.charCodeAt(0);
  }

  /** Upstream `VoltageElm(int xx, int yy, int wf)`. */
  initWaveform(wf: number): void {
    this.waveform = wf;
    this.maxVoltage = 5;
    this.frequency = 60;
    this.dutyCycle = 0.5;
    this.flags |= VoltageElm.FLAG_SHOW_VOLTAGE;
    this.reset();
  }

  override initNew(): void {
    this.initWaveform(VoltageElm.WF_DC);
  }

  override undump(st: StringTokenizer): void {
    this.maxVoltage = 5;
    this.frequency = 40;
    this.waveform = VoltageElm.WF_DC;
    this.dutyCycle = 0.5;
    try {
      this.waveform = parseJavaInt(st.nextToken());
      this.frequency = parseJavaDouble(st.nextToken());
      this.maxVoltage = parseJavaDouble(st.nextToken());
      this.bias = parseJavaDouble(st.nextToken());
      this.phaseShift = parseJavaDouble(st.nextToken());
      this.dutyCycle = parseJavaDouble(st.nextToken());
      // don't change this, we don't generate this format anymore, plus VarRailElm adds more
    } catch {
      // older files stop early
    }

    if ((this.flags & VoltageElm.FLAG_COS) !== 0) {
      this.flags &= ~VoltageElm.FLAG_COS;
      this.phaseShift = pi / 2;
    }

    // old circuit files have the wrong duty cycle for pulse waveforms (wasn't configurable)
    if ((this.flags & VoltageElm.FLAG_PULSE_DUTY) === 0 && this.waveform === VoltageElm.WF_PULSE)
      this.dutyCycle = VoltageElm.defaultPulseDuty;

    this.reset();
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('wf', this.waveform);
    if (this.waveform !== VoltageElm.WF_DC) w.dumpAttr('fr', this.frequency);
    w.dumpAttr('maxv', this.maxVoltage);
    if (this.bias !== 0) w.dumpAttr('bias', this.bias);
    if (this.phaseShift !== 0) w.dumpAttr('phaseShift', this.phaseShift);
    if (this.dutyCycle !== 0.5) w.dumpAttr('dutyCycle', this.dutyCycle);
    if (this.riseTime !== 0) w.dumpAttr('riseTime', this.riseTime);
    if (this.internalResistance !== 0) w.dumpAttr('ir', this.internalResistance);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.waveform = r.parseIntAttr('wf', this.waveform);
    this.frequency = r.parseDoubleAttr('fr', this.frequency);
    this.maxVoltage = r.parseDoubleAttr('maxv', this.maxVoltage);
    this.bias = r.parseDoubleAttr('bias', this.bias);
    this.phaseShift = r.parseDoubleAttr('phaseShift', this.phaseShift);
    this.dutyCycle = r.parseDoubleAttr('dutyCycle', this.dutyCycle);
    this.riseTime = r.parseDoubleAttr('riseTime', this.riseTime);
    this.internalResistance = r.parseDoubleAttr('ir', 0);
  }

  override reset(): void {
    this.freqTimeZero = 0;
  }

  triangleFunc(x: number): number {
    if (x < pi) return x * (2 / pi) - 1;
    return 1 - (x - pi) * (2 / pi);
  }

  override getInternalNodeCount(): number {
    return this.internalResistance > 0 ? 1 : 0;
  }

  override getVoltageSourceCount(): number {
    return 1;
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    super.setVoltageSource(n, v);
    if (this.internalResistance > 0) v.setNodes(this.nodes[0], this.nodes[2]);
    else v.setNodes(this.nodes[0], this.nodes[1]);
  }

  override stamp(): void {
    const sim = this.sim;
    const vsNode2 = this.internalResistance > 0 ? this.nodes[2] : this.nodes[1];
    if (this.waveform === VoltageElm.WF_DC)
      sim.stampVoltageSource(this.nodes[0], vsNode2, this.voltSource, this.getVoltage());
    else sim.stampVoltageSource(this.nodes[0], vsNode2, this.voltSource);
    if (this.internalResistance > 0)
      sim.stampResistor(this.nodes[2], this.nodes[1], this.internalResistance);
  }

  override doStep(): void {
    const vsNode2 = this.internalResistance > 0 ? this.nodes[2] : this.nodes[1];
    if (this.waveform !== VoltageElm.WF_DC)
      this.sim.updateVoltageSource(this.nodes[0], vsNode2, this.voltSource, this.getVoltage());
  }

  override stepFinished(): void {
    if (this.waveform === VoltageElm.WF_NOISE)
      this.noiseValue = (this.sim.random.nextDouble() * 2 - 1) * this.maxVoltage + this.bias;
  }

  getVoltage(): number {
    if (this.waveform !== VoltageElm.WF_DC && this.doDcAnalysis()) return this.bias;

    const { maxVoltage, bias, riseTime, frequency } = this;
    const w = 2 * pi * (this.sim.t - this.freqTimeZero) * frequency + this.phaseShift;
    switch (this.waveform) {
      case VoltageElm.WF_DC:
        return maxVoltage + bias;
      case VoltageElm.WF_AC:
        return Math.sin(w) * maxVoltage + bias;
      case VoltageElm.WF_SQUARE: {
        const wm = w % (2 * pi);
        const dutyPhase = 2 * pi * this.dutyCycle;
        if (riseTime > 0) {
          const risePhase = riseTime * frequency * 2 * pi;
          const halfRise = risePhase / 2;
          // rising edge centered at phase 0 (wraps around cycle boundary)
          if (wm < halfRise) {
            const t = (wm + halfRise) / risePhase;
            return bias + maxVoltage * (2 * t - 1);
          }
          // high plateau
          else if (wm < dutyPhase - halfRise) return bias + maxVoltage;
          // falling edge centered at dutyPhase
          else if (wm < dutyPhase + halfRise) {
            const t = (wm - dutyPhase + halfRise) / risePhase;
            return bias + maxVoltage * (1 - 2 * t);
          }
          // low plateau
          else if (wm < 2 * pi - halfRise) return bias - maxVoltage;
          // rising edge wrapping around end of cycle
          else {
            const t = (wm - (2 * pi - halfRise)) / risePhase;
            return bias + maxVoltage * (2 * t - 1);
          }
        }
        return bias + (wm > dutyPhase ? -maxVoltage : maxVoltage);
      }
      case VoltageElm.WF_TRIANGLE:
        return bias + this.triangleFunc(w % (2 * pi)) * maxVoltage;
      case VoltageElm.WF_SAWTOOTH:
        return bias + (w % (2 * pi)) * (maxVoltage / pi) - maxVoltage;
      case VoltageElm.WF_PULSE: {
        const wm = w % (2 * pi);
        const dutyPhase = 2 * pi * this.dutyCycle;
        if (riseTime > 0) {
          const risePhase = riseTime * frequency * 2 * pi;
          const halfRise = risePhase / 2;
          // rising edge centered at phase 0 (wraps around cycle boundary)
          if (wm < halfRise) {
            const t = (wm + halfRise) / risePhase;
            return bias + maxVoltage * t;
          }
          // high plateau
          else if (wm < dutyPhase - halfRise) return bias + maxVoltage;
          // falling edge centered at dutyPhase
          else if (wm < dutyPhase + halfRise) {
            const t = (wm - dutyPhase + halfRise) / risePhase;
            return bias + maxVoltage * (1 - t);
          }
          // low for the rest of the cycle
          else if (wm < 2 * pi - halfRise) return bias;
          // rising edge wrapping around end of cycle
          else {
            const t = (wm - (2 * pi - halfRise)) / risePhase;
            return bias + maxVoltage * t;
          }
        }
        return wm < dutyPhase ? maxVoltage + bias : bias;
      }
      case VoltageElm.WF_NOISE:
        return this.noiseValue;
      default:
        return 0;
    }
  }

  override getVoltageDiff(): number {
    return this.nodes[1].v - this.nodes[0].v;
  }

  override getDragVertical(_requestedVertical: boolean): boolean {
    return true;
  }

  /** Point 2, not point 1, tracks the mouse during toolbar drag-and-drop. */
  override dragPlace(xa: number, ya: number, vertical: boolean): void {
    super.dragPlace(xa, ya, vertical);
    this.swapDragEndpoints();
  }

  static diffFromInteger(x: number): number {
    return Math.abs(x - Math.round(x));
  }

  /** Would RMS be a rounder number to display than peak? */
  useRmsDisplay(peakValue: number): boolean {
    const rmsMult = this.getRmsMultiplier();
    const rmsVal = peakValue * rmsMult;
    return (
      rmsMult !== 1 &&
      Math.abs(peakValue) > 1e-4 &&
      VoltageElm.diffFromInteger(rmsVal * 1e4) < VoltageElm.diffFromInteger(peakValue * 1e4)
    );
  }

  /**
   * The RMS-to-peak multiplier for the current waveform: RMS = amplitude * getRmsMultiplier(),
   * so 1/sqrt(2) for a sine, etc.
   */
  getRmsMultiplier(): number {
    switch (this.waveform) {
      case VoltageElm.WF_DC:
        return 1;
      case VoltageElm.WF_AC:
        return 1 / Math.sqrt(2); // sine: Vpk/sqrt(2)
      case VoltageElm.WF_SQUARE:
        return 1; // square swings +A/-A, RMS=A
      case VoltageElm.WF_TRIANGLE:
        return 1 / Math.sqrt(3); // triangle: Vpk/sqrt(3)
      case VoltageElm.WF_SAWTOOTH:
        return 1 / Math.sqrt(3); // sawtooth: Vpk/sqrt(3)
      case VoltageElm.WF_PULSE:
        return Math.sqrt(this.dutyCycle); // pulse: Vpk*sqrt(d)
      default:
        return 1;
    }
  }

  override getElmType(): string | null {
    switch (this.waveform) {
      case VoltageElm.WF_DC:
      case VoltageElm.WF_VAR:
        return 'voltage source';
      case VoltageElm.WF_AC:
        return 'A/C source';
      case VoltageElm.WF_SQUARE:
        return 'square wave gen';
      case VoltageElm.WF_PULSE:
        return 'pulse gen';
      case VoltageElm.WF_SAWTOOTH:
        return 'sawtooth gen';
      case VoltageElm.WF_TRIANGLE:
        return 'triangle gen';
      case VoltageElm.WF_NOISE:
        return 'noise gen';
    }
    return null;
  }

  getFrequencyOffset(): number {
    return 5;
  }
  hasTimingOptions(): boolean {
    return this.waveform === VoltageElm.WF_PULSE || this.waveform === VoltageElm.WF_SQUARE;
  }
  timeSpec(): boolean {
    return this.hasFlag(VoltageElm.FLAG_TIME_SPEC) && this.hasTimingOptions();
  }

  setFrequency(newFreq: number): void {
    const sim = this.sim;
    const oldfreq = this.frequency;
    this.frequency = newFreq;
    const maxfreq = 1 / (8 * sim.maxTimeStep);
    if (this.frequency > maxfreq) {
      const confirm = VoltageElm.confirmAdjustTimestep;
      if (confirm?.('Adjust timestep to allow for higher frequencies?') === true)
        sim.maxTimeStep = 1 / (32 * this.frequency);
      else this.frequency = maxfreq;
    }
    this.freqTimeZero =
      this.frequency === 0 ? 0 : sim.t - (oldfreq * (sim.t - this.freqTimeZero)) / this.frequency;
  }

  setFrequencyFromTimes(highTime: number, lowTime: number): void {
    const newFreq = 1 / (highTime + lowTime);
    const newDuty = highTime / (highTime + lowTime);
    this.setFrequency(newFreq);
    this.dutyCycle = newDuty;
  }

  override getEditInfo(n: number): EditInfo | null {
    const isRail = this.isRailElm();
    if (n === 0)
      return new EditInfo(
        this.waveform === VoltageElm.WF_DC ? 'Voltage' : 'Max Voltage',
        this.maxVoltage,
        -20,
        20,
      ).setUnitStep();
    if (n === 1)
      return EditInfo.createChoice(
        'Waveform',
        ['D/C', 'A/C', 'Square Wave', 'Triangle', 'Sawtooth', 'Pulse', 'Noise'],
        this.waveform,
      );
    if (n === 2) return new EditInfo('DC Offset (V)', this.bias, -20, 20).setUnitStep();
    if (n === 3) {
      const ei = new EditInfo('Internal Resistance (ohms)', this.internalResistance);
      ei.setNonNegative();
      return ei;
    }
    if (
      n === 4 &&
      !(isRail && (this.waveform === VoltageElm.WF_DC || this.waveform === VoltageElm.WF_VAR))
    ) {
      const svFlag = isRail ? VoltageElm.FLAG_SHOW_VOLTAGE_RAIL : VoltageElm.FLAG_SHOW_VOLTAGE;
      return EditInfo.createCheckbox('Show Voltage', (this.flags & svFlag) !== 0);
    }
    if (n === 5 && this.waveform === VoltageElm.WF_DC && !isRail)
      return EditInfo.createCheckbox(
        'Circle Symbol',
        (this.flags & VoltageElm.FLAG_CIRCLE_SYMBOL) !== 0,
      );
    const fo = this.getFrequencyOffset();
    if (this.waveform === VoltageElm.WF_DC || this.waveform === VoltageElm.WF_NOISE) return null;
    const n2 = n - fo;
    if (this.hasTimingOptions()) {
      // square/pulse: dropdown + freq-or-time + phase + duty-or-time + rise
      if (n2 === 0) {
        const ei = EditInfo.createChoice(
          'Specify As',
          ['Frequency/Duty Cycle', 'High Time/Low Time'],
          this.timeSpec() ? 1 : 0,
        );
        ei.newColumn = true;
        return ei;
      }
      if (n2 === 1) {
        if (this.timeSpec())
          return new EditInfo('High Time (s)', this.dutyCycle / this.frequency, 0, 0);
        return new EditInfo('Frequency (Hz)', this.frequency, 4, 500);
      }
      if (n2 === 2)
        return new EditInfo(
          'Phase Offset (degrees)',
          (this.phaseShift * 180) / pi,
          -180,
          180,
        ).setDimensionless();
      if (n2 === 3) {
        if (this.timeSpec())
          return new EditInfo('Low Time (s)', (1 - this.dutyCycle) / this.frequency, 0, 0);
        return new EditInfo('Duty Cycle', this.dutyCycle * 100, 0, 100).setDimensionless();
      }
      if (n2 === 4) return new EditInfo('Rise/Fall Time (s)', this.riseTime, 0, 0);
    } else {
      // other waveforms: freq + phase only
      if (n2 === 0) return new EditInfo('Frequency (Hz)', this.frequency, 4, 500);
      if (n2 === 1)
        return new EditInfo(
          'Phase Offset (degrees)',
          (this.phaseShift * 180) / pi,
          -180,
          180,
        ).setDimensionless();
    }
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    const isRail = this.isRailElm();
    if (n === 0) this.maxVoltage = ei.value;
    if (n === 2) this.bias = ei.value;
    if (n === 3) this.internalResistance = ei.value;
    if (n === 4 && ei.checkbox !== null) {
      const svFlag = isRail ? VoltageElm.FLAG_SHOW_VOLTAGE_RAIL : VoltageElm.FLAG_SHOW_VOLTAGE;
      this.flags = ei.changeFlag(this.flags, svFlag);
    }
    if (n === 5 && this.waveform === VoltageElm.WF_DC && ei.checkbox !== null && !isRail) {
      this.flags = ei.changeFlag(this.flags, VoltageElm.FLAG_CIRCLE_SYMBOL);
      this.setPoints();
    }
    if (n === 1) {
      const ow = this.waveform;
      this.waveform = ei.choice?.selected ?? 0;
      if (this.waveform === VoltageElm.WF_DC && ow !== VoltageElm.WF_DC) {
        ei.newDialog = true;
        this.bias = 0;
      } else if (this.waveform !== ow) ei.newDialog = true;
      // change duty cycle if we're changing to or from pulse
      if (this.waveform === VoltageElm.WF_PULSE && ow !== VoltageElm.WF_PULSE)
        this.dutyCycle = VoltageElm.defaultPulseDuty;
      else if (ow === VoltageElm.WF_PULSE && this.waveform !== VoltageElm.WF_PULSE)
        this.dutyCycle = 0.5;
      this.setPoints();
    }
    const fo = this.getFrequencyOffset();
    const n2 = n - fo;
    if (this.hasTimingOptions()) {
      if (n2 === 0 && ei.choice !== null) {
        const oldFlags = this.flags;
        this.flags =
          ei.choice.selected === 1
            ? this.flags | VoltageElm.FLAG_TIME_SPEC
            : this.flags & ~VoltageElm.FLAG_TIME_SPEC;
        if (this.flags !== oldFlags) ei.newDialog = true;
      }
      if (n2 === 1) {
        if (this.timeSpec()) {
          // high time changed; recompute frequency and duty cycle
          const highTime = ei.value;
          const lowTime = (1 - this.dutyCycle) / this.frequency;
          if (highTime > 0 && lowTime > 0) this.setFrequencyFromTimes(highTime, lowTime);
        } else if (ei.value !== 0) {
          this.setFrequency(ei.value);
        }
      }
      if (n2 === 2) {
        this.phaseShift = (ei.value * pi) / 180;
        this.phaseShift = ((this.phaseShift % (2 * pi)) + 2 * pi) % (2 * pi);
      }
      if (n2 === 3) {
        if (this.timeSpec()) {
          // low time changed; recompute frequency and duty cycle
          const highTime = this.dutyCycle / this.frequency;
          const lowTime = ei.value;
          if (highTime > 0 && lowTime > 0) this.setFrequencyFromTimes(highTime, lowTime);
        } else {
          this.dutyCycle = ei.value * 0.01;
        }
      }
      if (n2 === 4) this.riseTime = ei.value;
    } else {
      if (n2 === 0 && this.waveform !== VoltageElm.WF_DC && ei.value !== 0)
        this.setFrequency(ei.value);
      if (n2 === 1) {
        this.phaseShift = (ei.value * pi) / 180;
        this.phaseShift = ((this.phaseShift % (2 * pi)) + 2 * pi) % (2 * pi);
      }
    }
  }

  override isVoltageElm(): boolean {
    return true;
  }

  override validate(): boolean {
    if (this.internalResistance > 0) return true;
    if (this.getPostCount() === 2) {
      const fpi = new FindPathInfo(PathType.VOLTAGE, this, this.getNode(1), this.sim);
      if (fpi.findPath(this.getNode(0))) {
        // voltage source/wire loop with no resistance: add a little and analyze again
        this.internalResistance = 0.001;
        return false;
      }
    }
    return true;
  }
}

/** A DC source placed from the menu; also what an XML `v` element loads as. */
export class DCVoltageElm extends VoltageElm {
  override getClassName(): string {
    return 'DCVoltageElm';
  }
  override getShortcut(): number {
    return 'v'.charCodeAt(0);
  }
}

/** An AC source placed from the menu. */
export class ACVoltageElm extends VoltageElm {
  override getClassName(): string {
    return 'ACVoltageElm';
  }
  override initNew(): void {
    this.initWaveform(VoltageElm.WF_AC);
    this.maxVoltage = 120 * Math.sqrt(2);
  }
}

/**
 * Upstream registers all three under "VoltageElm" (`getDumpClass()`), so text `v` lines load as
 * VoltageElm and `constructElement("VoltageElm")` (XML `v`) falls back to a new DCVoltageElm.
 */
export const VoltageElmType: ElementType = {
  className: 'VoltageElm',
  create(x, y, sim) {
    const e = new DCVoltageElm(x, y, x, y, 0);
    e.sim = sim;
    e.initNew();
    return e;
  },
  load(x1, y1, x2, y2, f, st, sim) {
    const e = new VoltageElm(x1, y1, x2, y2, f);
    e.sim = sim;
    e.undump(st);
    return e;
  },
};

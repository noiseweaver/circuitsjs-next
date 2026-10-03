// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/CircuitLoader.java,
// XMLDeserializer.java and XMLSerializer.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032: clearing, reading and saving a circuit.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import {
  Simulation,
  StringTokenizer,
  classNameForXmlTag,
  constructElement,
  createCe,
  javaDoubleToInt,
  modelsFor,
  parseJavaDouble,
  parseJavaInt,
  type CircuitElm,
  type XmlDocWriter,
} from '@circuitjs-next/elements';
import { AttrReader, AttrWriter } from './attrs.ts';
import { XmlElement, parseXml, prettyPrint } from './xml.ts';

/** Option flag bits kept in CircuitOptions.flags (64, adjustable timestep, lives on the sim). */
export const OptionFlag = {
  DOTS: 1,
  SMALL_GRID: 2,
  HIDE_VOLTAGE_COLORS: 4,
  POWER: 8,
  HIDE_VALUES: 16,
  ADJUST_TIMESTEP: 64,
  AUTO_DC_ON_RESET: 128,
} as const;

const KEPT_FLAGS =
  OptionFlag.DOTS |
  OptionFlag.SMALL_GRID |
  OptionFlag.HIDE_VOLTAGE_COLORS |
  OptionFlag.POWER |
  OptionFlag.HIDE_VALUES |
  OptionFlag.AUTO_DC_ON_RESET;

/** Display settings saved with a circuit (upstream keeps them in menus and sliders). */
export interface CircuitOptions {
  /** OptionFlag bits, without ADJUST_TIMESTEP. */
  flags: number;
  /** Simulation speed slider, 0..259. */
  speed: number;
  /** Current speed slider, 1..99. */
  currentBar: number;
  /** Power brightness slider, 1..99. */
  powerBar: number;
  voltageRange: number;
}

/** The element and posts the circuit's explanatory hint refers to (`h` record). */
export interface Hint {
  type: number;
  item1: number;
  item2: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** A loaded circuit: its simulation, elements and saved settings. */
export class Circuit {
  readonly sim = new Simulation();
  elements: CircuitElm[] = [];
  options: CircuitOptions = { flags: 0, speed: 117, currentBar: 50, powerBar: 50, voltageRange: 5 };
  hint: Hint = { type: -1, item1: 0, item2: 0 };
  /**
   * Scope (`o`) and slider (`adj`) records from an XML file, kept verbatim and written back after
   * the elements until scopes and sliders are ported (Phase 6, see docs/DEVIATIONS.md).
   */
  xmlExtras: XmlElement[] = [];
  /** Scope (`o`) and slider (`38`) lines from a text file. Not written back (DEVIATIONS.md). */
  textExtras: string[] = [];
  /** What upstream would print to its console while loading (unknown or broken records). */
  warnings: string[] = [];

  /** Upstream `getIterCount()`: the speed slider as iterations per frame. */
  getIterCount(): number {
    if (this.options.speed === 0) return 0;
    return 0.1 * Math.exp((this.options.speed - 61) / 24);
  }

  setSpeedFromIterCount(sp: number): void {
    this.options.speed = clamp(javaDoubleToInt(Math.log(10 * sp) * 24 + 61.5), 0, 259);
  }

  /** Upstream `CircuitLoader.clearCircuit()`, minus the UI. */
  clear(): void {
    const sim = this.sim;
    sim.resetTime();
    sim.solverType = 0;
    this.elements = [];
    this.hint = { type: -1, item1: 0, item2: 0 };
    sim.maxTimeStep = 5e-6;
    sim.minTimeStep = 50e-12;
    this.options = { flags: 0, speed: 117, currentBar: 50, powerBar: 50, voltageRange: 5 };
    this.setGrid();
    this.xmlExtras = [];
    this.textExtras = [];
  }

  private setGrid(): void {
    this.sim.gridSize = (this.options.flags & OptionFlag.SMALL_GRID) !== 0 ? 8 : 16;
  }

  /**
   * Upstream `resetAction()` minus the UI: restart time, zero node voltages and element state, and
   * analyze again (finding the DC operating point first if the circuit asks for it). Node voltages
   * are reset as dev-ts does (`SimulationManager.resetNodes`), since they live on the nodes here.
   */
  reset(): void {
    const sim = this.sim;
    sim.analyzeFlag = true;
    if ((this.options.flags & OptionFlag.AUTO_DC_ON_RESET) !== 0) sim.dcAnalysisFlag = true;
    sim.resetTime();
    sim.resetNodes();
    for (const ce of this.elements) {
      for (const n of ce.nodes) if (n.index === -1) n.v = 0;
      ce.reset();
    }
  }

  readCircuitFlags(flags: number): void {
    this.options.flags = flags & KEPT_FLAGS;
    this.sim.adjustTimeStep = (flags & OptionFlag.ADJUST_TIMESTEP) !== 0;
  }

  /** Load a circuit in either format, replacing this one (upstream `readCircuit(text, 0)`). */
  read(text: string): void {
    this.clear();
    if (text.startsWith('<')) this.readXml(text, false);
    else this.readText(text, false);
    this.finishRead();
  }

  /**
   * Add a circuit's elements to this one, keeping this circuit's settings (upstream
   * `readCircuit(text, RC_RETAIN)`, used by paste). Returns the new elements, in file order.
   */
  readRetain(text: string): CircuitElm[] {
    const first = this.elements.length;
    if (text.startsWith('<')) this.readXml(text, true);
    else this.readText(text, true);
    this.finishRead();
    return this.elements.slice(first);
  }

  private finishRead(): void {
    this.sim.setElements(this.elements);
  }

  private addElement(ce: CircuitElm): void {
    ce.sim = this.sim;
    this.elements.push(ce);
  }

  // ---- text format ---------------------------------------------------------------------------

  private readText(text: string, retain: boolean): void {
    for (const line of text.split(/\r\n|\r|\n/)) {
      const st = new StringTokenizer(line, ' +\t\n\r\f');
      if (!st.hasMoreTokens()) continue;
      const type = st.nextToken();
      let tint = type.charCodeAt(0);
      try {
        if (type.charAt(0) === 'o') {
          this.textExtras.push(line);
          continue;
        }
        if (type.charAt(0) === 'h') {
          if (retain) continue;
          this.hint = {
            type: parseJavaInt(st.nextToken()),
            item1: parseJavaInt(st.nextToken()),
            item2: parseJavaInt(st.nextToken()),
          };
          continue;
        }
        if (type.charAt(0) === '$') {
          if (retain) {
            // a pasted circuit only turns the small grid on
            if ((parseJavaInt(st.nextToken()) & OptionFlag.SMALL_GRID) !== 0) {
              this.options.flags |= OptionFlag.SMALL_GRID;
              this.setGrid();
            }
          } else this.readOptions(st);
          continue;
        }
        if (type.charAt(0) === '!') {
          this.warnings.push('custom logic models are not supported yet');
          continue;
        }
        // afilter-specific records
        if ('%?B'.includes(type.charAt(0))) continue;

        if (tint >= 48 && tint <= 57) tint = parseJavaInt(type);

        if (tint === 34) {
          modelsFor(this.sim).diode.undumpModel(st);
          continue;
        }
        if (tint === 32) {
          modelsFor(this.sim).transistor.undumpModel(st);
          continue;
        }
        if (tint === 38) {
          this.textExtras.push(line);
          continue;
        }
        if (type.charAt(0) === '.') {
          this.warnings.push('subcircuit models are not supported yet');
          continue;
        }

        const x1 = parseJavaInt(st.nextToken());
        const y1 = parseJavaInt(st.nextToken());
        const x2 = parseJavaInt(st.nextToken());
        const y2 = parseJavaInt(st.nextToken());
        const f = parseJavaInt(st.nextToken());
        const ce = createCe(tint, x1, y1, x2, y2, f, st, this.sim);
        if (ce === null) {
          this.warnings.push('unrecognized dump type: ' + type);
          continue;
        }
        ce.sim = this.sim;
        ce.setPoints();
        this.addElement(ce);
      } catch (e) {
        this.warnings.push(`exception while undumping ${String(e)}`);
      }
    }
  }

  private readOptions(st: StringTokenizer): void {
    const sim = this.sim;
    const flags = parseJavaInt(st.nextToken());
    this.readCircuitFlags(flags);
    sim.maxTimeStep = sim.timeStep = parseJavaDouble(st.nextToken());
    this.setSpeedFromIterCount(parseJavaDouble(st.nextToken()));
    this.options.currentBar = clamp(parseJavaInt(st.nextToken()), 1, 99);
    this.options.voltageRange = parseJavaDouble(st.nextToken());
    try {
      this.options.powerBar = clamp(parseJavaInt(st.nextToken()), 1, 99);
      sim.minTimeStep = parseJavaDouble(st.nextToken());
    } catch {
      // older files stop early
    }
    this.setGrid();
  }

  // ---- XML format ----------------------------------------------------------------------------

  private readXml(text: string, retain: boolean): void {
    const root = parseXml(text);
    const sim = this.sim;
    const r = new AttrReader(root);
    if (!retain) {
      this.readCircuitFlags(r.parseIntAttr('f', 0));
      sim.maxTimeStep = sim.timeStep = r.parseDoubleAttr('ts', sim.maxTimeStep);
      this.setSpeedFromIterCount(r.parseDoubleAttr('ic', this.getIterCount()));
      this.options.currentBar = clamp(r.parseIntAttr('cb', this.options.currentBar), 1, 99);
      this.options.voltageRange = r.parseDoubleAttr('vr', this.options.voltageRange);
      this.options.powerBar = clamp(r.parseIntAttr('pb', this.options.powerBar), 1, 99);
      sim.minTimeStep = r.parseDoubleAttr('mts', sim.minTimeStep);
      sim.solverType = r.parseIntAttr('st', sim.solverType) as typeof sim.solverType;
      this.setGrid();
    }

    for (const elem of root.elements()) {
      const tag = elem.name;
      r.elem = elem;
      if (tag === 'o' || tag === 'adj') {
        if (!retain) this.xmlExtras.push(elem);
        continue;
      }
      if (tag === 'h') {
        if (retain) continue;
        this.hint = {
          type: r.parseIntAttr('t', -1),
          item1: r.parseIntAttr('i1', 0),
          item2: r.parseIntAttr('i2', 0),
        };
        continue;
      }
      if (tag === 'dm') {
        modelsFor(sim).diode.undumpModelXml(r);
        continue;
      }
      if (tag === 'tm') {
        modelsFor(sim).transistor.undumpModelXml(r);
        continue;
      }
      if (tag === 'mm') {
        modelsFor(sim).mosfet.undumpModelXml(r);
        continue;
      }
      if (['rlm', 'clm', 'ccm'].includes(tag)) {
        this.warnings.push(`model element <${tag}> is not supported yet`);
        continue;
      }
      // upstream's own regression-test records; only its test runner reads them
      if (tag === 'test' || tag === 'switchevent' || tag === 'scopedata') continue;

      const x = elem.getAttribute('x');
      if (x === null) continue;
      const className = classNameForXmlTag(tag);
      if (className === undefined) {
        this.warnings.push('unrecognized xml element: ' + tag);
        continue;
      }
      const elm = constructElement(className, 0, 0, sim);
      if (elm === null) continue;
      elm.sim = sim;
      elm.undumpXml(r);
      const xs = x.split(' ');
      const pos = [0, 1, 2, 3].map((i) => {
        const s = xs[i];
        if (s === undefined) throw new Error(`bad position "${x}" on <${tag}>`);
        return parseJavaInt(s);
      }) as [number, number, number, number];
      elm.setPosition(...pos);
      this.addElement(elm);
    }
  }

  // ---- saving --------------------------------------------------------------------------------

  /** The circuit as upstream saves it (`XMLSerializer.dumpCircuit()`). */
  dumpXml(): string {
    const sim = this.sim;
    const root = new XmlElement('cir');
    const w = new AttrWriter(root);
    w.dumpAttr('f', this.options.flags | (sim.adjustTimeStep ? OptionFlag.ADJUST_TIMESTEP : 0));
    w.dumpAttr('ts', sim.maxTimeStep);
    w.dumpAttr('ic', this.getIterCount());
    w.dumpAttr('cb', this.options.currentBar);
    w.dumpAttr('pb', this.options.powerBar);
    w.dumpAttr('vr', this.options.voltageRange);
    w.dumpAttr('mts', sim.minTimeStep);
    if (sim.solverType !== 0) w.dumpAttr('st', sim.solverType);

    modelsFor(sim).clearDumpedFlags();
    const doc = docWriter(root);
    for (const ce of this.elements) appendElement(root, doc, ce);
    for (const e of this.xmlExtras) if (e.name === 'o') root.appendChild(e);
    for (const e of this.xmlExtras) if (e.name === 'adj') root.appendChild(e);
    if (this.hint.type !== -1) {
      const h = new XmlElement('h');
      const hw = new AttrWriter(h);
      hw.dumpAttr('t', this.hint.type);
      hw.dumpAttr('i1', this.hint.item1);
      hw.dumpAttr('i2', this.hint.item2);
      root.appendChild(h);
    }
    return prettyPrint(root);
  }

  /**
   * The given elements as a bare `<cir>` document with the models they use, as upstream's
   * clipboard holds them (`CommandManager.copyOfSelectedElms`, which writes them last to first).
   */
  dumpElementsXml(elements: readonly CircuitElm[]): string {
    const root = new XmlElement('cir');
    modelsFor(this.sim).clearDumpedFlags();
    const doc = docWriter(root);
    for (const ce of [...elements].reverse()) appendElement(root, doc, ce);
    return prettyPrint(root);
  }
}

function docWriter(root: XmlElement): XmlDocWriter {
  return {
    addElement(tag) {
      const e = new XmlElement(tag);
      root.appendChild(e);
      return new AttrWriter(e);
    },
  };
}

function appendElement(root: XmlElement, doc: XmlDocWriter, ce: CircuitElm): void {
  // upstream elements append their models from inside dumpXml, before the element itself
  ce.dumpXmlModels(doc);
  const elem = new XmlElement(ce.getXmlDumpType());
  const ew = new AttrWriter(elem);
  ce.dumpXml(ew);
  ce.dumpXmlState(ew);
  root.appendChild(elem);
}

/** Load a circuit from upstream text or XML. */
export function readCircuit(text: string): Circuit {
  const c = new Circuit();
  c.read(text);
  return c;
}

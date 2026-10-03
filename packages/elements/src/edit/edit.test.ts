// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

import { Simulation } from '@circuitjs-next/engine';
import { describe, expect, it } from 'vitest';
import type { CircuitElm } from '../CircuitElm.ts';
import { CapacitorElm } from '../elm/CapacitorElm.ts';
import { GroundElm } from '../elm/GroundElm.ts';
import { LEDElm } from '../elm/LEDElm.ts';
import { MosfetElm } from '../elm/MosfetElm.ts';
import { OutputElm } from '../elm/OutputElm.ts';
import { ResistorElm } from '../elm/ResistorElm.ts';
import { TransistorElm } from '../elm/TransistorElm.ts';
import { ACVoltageElm, VoltageElm } from '../elm/VoltageElm.ts';
import { modelsFor } from '../models/ModelLibrary.ts';
import { ELEMENT_TYPES, constructElement } from '../registry.ts';
import { EditInfo, parseUnits, stepE12, unitString } from './EditInfo.ts';

function make(className: string, sim = new Simulation()): CircuitElm {
  const e = constructElement(className, 0, 0, sim);
  if (e === null) throw new Error(`no element ${className}`);
  e.drag(64, 0);
  return e;
}

/** Every field the element shows, as upstream's dialog walks them. */
function fields(e: CircuitElm): EditInfo[] {
  const out: EditInfo[] = [];
  for (let n = 0; n < 30; n++) {
    const ei = e.getEditInfo(n);
    if (ei === null) return out;
    out.push(ei);
  }
  throw new Error(`${e.getClassName()}: more than 30 edit fields`);
}

function names(e: CircuitElm): string[] {
  return fields(e).map((ei) => ei.checkbox?.label ?? ei.name);
}

describe('edit fields', () => {
  for (const type of ELEMENT_TYPES) {
    it(`${type.className} lists and round-trips its fields`, () => {
      const e = make(type.className);
      const list = fields(e);
      expect(list.length).toBeGreaterThan(0);
      for (let n = 0; n < list.length; n++) {
        const ei = e.getEditInfo(n);
        if (ei === null) break; // an earlier field may have shortened the list
        expect(() => e.setEditValue(n, ei)).not.toThrow();
      }
      // the list is the same after setting every field to its own value
      expect(fields(e).length).toBe(list.length);
      expect(e.getDialogTitle()).not.toBe('Edit Component');
    });
  }

  it('edits a resistor value', () => {
    const r = make('ResistorElm') as ResistorElm;
    expect(names(r)).toEqual(['Resistance (ohms)']);
    const ei = r.getEditInfo(0) as EditInfo;
    expect(ei.value).toBe(1000);
    ei.value = parseUnits('2k2');
    r.setEditValue(0, ei);
    expect(r.resistance).toBe(2200);
    ei.value = 0;
    r.setEditValue(0, ei);
    expect(r.resistance).toBe(1e-9);
    expect(r.getShortcut()).toBe('r'.charCodeAt(0));
    expect(r.getDialogTitle()).toBe('Edit Resistor');
  });

  it('flips a capacitor to backward Euler with the trapezoid checkbox', () => {
    const c = make('CapacitorElm') as CapacitorElm;
    const ei = c.getEditInfo(1) as EditInfo;
    expect(ei.checkbox).toEqual({ label: 'Trapezoidal Approximation', state: true });
    expect(c.flags & CapacitorElm.FLAG_BACK_EULER).toBe(0);
    ei.checkbox = { label: 'Trapezoidal Approximation', state: false };
    c.setEditValue(1, ei);
    expect(c.flags & CapacitorElm.FLAG_BACK_EULER).toBe(CapacitorElm.FLAG_BACK_EULER);
    expect(c.isTrapezoidal()).toBe(false);
    ei.checkbox.state = true;
    c.setEditValue(1, ei);
    expect(c.isTrapezoidal()).toBe(true);
  });

  it('rebuilds the voltage source fields when the waveform changes', () => {
    const v = make('VoltageElm') as VoltageElm;
    expect(v.getClassName()).toBe('DCVoltageElm');
    expect(names(v)).toEqual([
      'Voltage',
      'Waveform',
      'DC Offset (V)',
      'Internal Resistance (ohms)',
      'Show Voltage',
      'Circle Symbol',
    ]);
    const wf = v.getEditInfo(1) as EditInfo;
    expect(wf.choice?.selected).toBe(VoltageElm.WF_DC);
    (wf.choice as { selected: number }).selected = VoltageElm.WF_AC;
    v.setEditValue(1, wf);
    expect(wf.newDialog).toBe(true);
    expect(v.waveform).toBe(VoltageElm.WF_AC);
    expect(names(v)).toEqual([
      'Max Voltage',
      'Waveform',
      'DC Offset (V)',
      'Internal Resistance (ohms)',
      'Show Voltage',
      'Frequency (Hz)',
      'Phase Offset (degrees)',
    ]);
    expect(v.getDialogTitle()).toBe('Edit A/C source');

    // square and pulse add the timing fields; pulse changes the duty cycle
    const wf2 = v.getEditInfo(1) as EditInfo;
    (wf2.choice as { selected: number }).selected = VoltageElm.WF_PULSE;
    v.setEditValue(1, wf2);
    expect(wf2.newDialog).toBe(true);
    expect(v.dutyCycle).toBe(VoltageElm.defaultPulseDuty);
    expect(names(v).slice(5)).toEqual([
      'Specify As',
      'Frequency (Hz)',
      'Phase Offset (degrees)',
      'Duty Cycle',
      'Rise/Fall Time (s)',
    ]);
    const spec = v.getEditInfo(5) as EditInfo;
    expect(spec.newColumn).toBe(true);
    (spec.choice as { selected: number }).selected = 1;
    v.setEditValue(5, spec);
    expect(spec.newDialog).toBe(true);
    expect(v.timeSpec()).toBe(true);
    expect(names(v)[6]).toBe('High Time (s)');

    // the same waveform again does not ask for a new dialog
    const same = v.getEditInfo(1) as EditInfo;
    v.setEditValue(1, same);
    expect(same.newDialog).toBe(false);
  });

  it('caps a frequency the timestep cannot show unless the UI agrees', () => {
    const v = make('VoltageElm') as VoltageElm;
    v.waveform = VoltageElm.WF_AC;
    const ei = v.getEditInfo(5) as EditInfo;
    expect(ei.name).toBe('Frequency (Hz)');
    ei.value = 1e6;
    v.setEditValue(5, ei);
    expect(v.frequency).toBe(1 / (8 * v.sim.maxTimeStep));
    VoltageElm.confirmAdjustTimestep = () => true;
    try {
      v.setEditValue(5, ei);
      expect(v.frequency).toBe(1e6);
      expect(v.sim.maxTimeStep).toBe(1 / (32 * 1e6));
    } finally {
      VoltageElm.confirmAdjustTimestep = null;
    }
  });

  it('shows rail fields without the DC show-voltage checkbox', () => {
    const r = make('RailElm');
    expect(names(r)).toEqual([
      'Voltage',
      'Waveform',
      'DC Offset (V)',
      'Internal Resistance (ohms)',
    ]);
    expect(r.getShortcut()).toBe('V'.charCodeAt(0));
  });

  it('uses RMS display where it gives a rounder number', () => {
    const sim = new Simulation();
    const ac = new ACVoltageElm(0, 0, 0, 0, 0);
    ac.sim = sim;
    ac.initNew();
    expect(ac.getRmsMultiplier()).toBe(1 / Math.sqrt(2));
    expect(ac.useRmsDisplay(ac.maxVoltage)).toBe(true);
    expect(ac.useRmsDisplay(5)).toBe(false);
    const dc = make('VoltageElm') as VoltageElm;
    expect(dc.useRmsDisplay(5)).toBe(false);
  });

  it('only lists output scale and precision when shown', () => {
    const o = make('OutputElm') as OutputElm;
    expect(names(o)).toEqual(['Show Voltage']);
    const ei = o.getEditInfo(0) as EditInfo;
    (ei.checkbox as { state: boolean }).state = true;
    o.setEditValue(0, ei);
    expect(ei.newDialog).toBe(true);
    expect(names(o)).toEqual(['Show Voltage', 'Scale']);
  });

  it('lists diode, LED and zener models from the simulation library', () => {
    const sim = new Simulation();
    const d = make('DiodeElm', sim);
    const model = d.getEditInfo(0) as EditInfo;
    expect(model.name).toBe('Model');
    expect(model.choice?.items).toContain('1N4148 (switching)');
    expect(model.choice?.items[model.choice.selected]).toBe('default');
    expect(d.getEditInfo(1)).toBeNull();

    const z = make('ZenerElm', sim);
    const zm = z.getEditInfo(0) as EditInfo;
    expect(zm.choice?.items).not.toContain('default');
    expect(zm.choice?.items[zm.choice.selected]).toBe('default-zener');

    const led = make('LEDElm', sim) as LEDElm;
    expect(names(led)).toEqual([
      'Red Value (0-1)',
      'Green Value (0-1)',
      'Blue Value (0-1)',
      'Max Brightness Current (A)',
      'Model',
    ]);
    const lm = led.getEditInfo(4) as EditInfo;
    const i = lm.choice?.items.indexOf('1N4148 (switching)') ?? -1;
    (lm.choice as { selected: number }).selected = i;
    led.setEditValue(4, lm);
    expect(lm.newDialog).toBe(true);
    expect(led.modelName).toBe('1N4148');
    expect(led.hasResistance).toBe(true);
  });

  it('changes a MOSFET model and remembers it for new MOSFETs', () => {
    const sim = new Simulation();
    const m = make('MosfetElm', sim) as MosfetElm;
    expect(m.noDiagonal).toBe(true);
    expect(names(m)).toEqual(['Model', 'Swap D/S']);
    const ei = m.getEditInfo(0) as EditInfo;
    expect(ei.choice?.items).not.toContain('default-jfet');
    (ei.choice as { selected: number }).selected = ei.choice?.items.indexOf('default-body') ?? 0;
    m.setEditValue(0, ei);
    expect(m.modelName).toBe('default-body');
    expect(m.getPostCount()).toBe(4);
    expect(m.nodes.length).toBe(m.getNodeCount());
    expect(modelsFor(sim).mosfetLastModelName).toBe('default-body');
    expect((make('PMosfetElm', sim) as MosfetElm).modelName).toBe('default-body');
    expect(make('PMosfetElm', sim).getShortcut()).toBe('P'.charCodeAt(0));
  });

  it('toggles the transistor circle for every transistor', () => {
    const sim = new Simulation();
    const t1 = make('TransistorElm', sim) as TransistorElm;
    const t2 = make('PTransistorElm', sim) as TransistorElm;
    const ei = t1.getEditInfo(2) as EditInfo;
    expect(ei.checkbox?.label).toBe('Draw Circle');
    (ei.checkbox as { state: boolean }).state = !t1.hasCircle();
    t1.setEditValue(2, ei);
    expect(t2.hasCircle()).toBe(t1.hasCircle());
    expect(names(t1)).toEqual(['Beta/hFE', 'Swap E/C', 'Draw Circle', 'Model']);
    expect(t1.getShortcut()).toBe('n'.charCodeAt(0));
    expect(t2.getShortcut()).toBe('p'.charCodeAt(0));
  });

  it('keeps label and key shortcut on switches', () => {
    const s = make('SwitchElm');
    expect(names(s)).toEqual([
      'Momentary Switch',
      'IEC Symbol',
      'Label (for linking)',
      'Keyboard Shortcut',
      'On Resistance (ohms)',
    ]);
    const label = s.getEditInfo(2) as EditInfo;
    label.text = 'A';
    s.setEditValue(2, label);
    const key = s.getEditInfo(3) as EditInfo;
    key.text = ' Qx ';
    s.setEditValue(3, key);
    expect((s as unknown as { label: string }).label).toBe('A');
    expect((s as unknown as { keyShortcut: string }).keyShortcut).toBe('q');
    expect(make('PushSwitchElm').getShortcut()).toBe(0);
    expect(make('PushSwitchElm').getDialogTitle()).toBe('Edit Switch (SPST)');
  });
});

describe('placement and flips', () => {
  it('flips a transistor as upstream', () => {
    const t = make('TransistorElm') as TransistorElm;
    expect(t.noDiagonal).toBe(true);
    // horizontal: flipX mirrors the body, the flag stays
    t.setPosition(0, 0, 64, 0);
    t.flipX(200, 1);
    expect(t.flags & TransistorElm.FLAG_FLIP).toBe(0);
    expect([t.x, t.x2]).toEqual([200, 136]);
    // flipY of a horizontal transistor swaps E/C
    t.flipY(0, 1);
    expect(t.flags & TransistorElm.FLAG_FLIP).toBe(TransistorElm.FLAG_FLIP);
    // flipXY always toggles it
    t.flipXY(0, 1);
    expect(t.flags & TransistorElm.FLAG_FLIP).toBe(0);
    expect([t.x, t.y, t.x2, t.y2]).toEqual([0, 200, 0, 136]);
    // vertical now: flipX toggles
    t.flipX(0, 1);
    expect(t.flags & TransistorElm.FLAG_FLIP).toBe(TransistorElm.FLAG_FLIP);
  });

  it('keeps transistors, MOSFETs and op-amps on a line while dragging', () => {
    for (const name of ['TransistorElm', 'NMosfetElm', 'OpAmpElm']) {
      const e = make(name);
      expect(e.noDiagonal).toBe(true);
      e.drag(40, 100);
      expect(e.x2).toBe(0);
      expect(e.y2).toBe(96);
    }
  });

  it('places grounds and sources vertically from the toolbar', () => {
    const g = make('GroundElm') as GroundElm;
    g.dragPlace(16, 32, false);
    expect([g.x, g.y, g.x2, g.y2]).toEqual([16, 32, 16, 64]);
    const v = make('VoltageElm');
    v.dragPlace(16, 32, false);
    // point 2 follows the mouse
    expect([v.x, v.y, v.x2, v.y2]).toEqual([16, 96, 16, 32]);
    const r = make('RailElm');
    r.dragPlace(16, 32, false);
    expect([r.x, r.y, r.x2, r.y2]).toEqual([80, 32, 16, 32]);
  });

  it('remembers the last ground symbol for new grounds', () => {
    const g = make('GroundElm') as GroundElm;
    const ei = g.getEditInfo(0) as EditInfo;
    (ei.choice as { selected: number }).selected = 2;
    try {
      g.setEditValue(0, ei);
      expect((make('GroundElm') as GroundElm).symbolType).toBe(2);
    } finally {
      GroundElm.lastSymbolType = 0;
    }
  });

  it('only hits a wire near its line', () => {
    const w = make('WireElm');
    expect(w.getMouseDistance(32, 5)).toBe(25);
    expect(w.getMouseDistance(32, 11)).toBe(-1);
  });

  it('places text with a click', () => {
    const t = make('TextElm');
    t.drag(37, 51);
    expect([t.x, t.y, t.x2, t.y2]).toEqual([37, 51, 53, 51]);
  });

  it('edits multi-line text', () => {
    const t = make('TextElm');
    const ei = t.getEditInfo(0) as EditInfo;
    expect(ei.multiline).toBe(true);
    ei.text = 'one\ntwo';
    t.setEditValue(0, ei);
    expect((t as unknown as { text: string }).text).toBe('one\\ntwo');
    expect((t as unknown as { lines: string[] }).lines).toEqual(['one', 'two']);
    expect((t.getEditInfo(0) as EditInfo).text).toBe('one\ntwo');
  });
});

describe('unit text', () => {
  it('parses values with suffixes', () => {
    expect(parseUnits('2k2')).toBe(2200);
    expect(parseUnits('10meg')).toBe(1e7);
    expect(parseUnits('4.7u')).toBeCloseTo(4.7e-6, 18);
    expect(parseUnits('1e-6')).toBe(1e-6);
    expect(() => parseUnits('abc')).toThrow();
  });

  it('formats values with suffixes', () => {
    expect(unitString(null, 4700)).toBe('4.7k');
    expect(unitString(null, 1e-7)).toBe('100n');
  });

  it('steps through the E12 series', () => {
    expect(stepE12(1000, 1)).toBeCloseTo(1200, 9);
    expect(stepE12(8200, 1)).toBeCloseTo(10000, 9);
  });
});

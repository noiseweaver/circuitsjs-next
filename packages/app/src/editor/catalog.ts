// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
// Groups, names and order follow CircuitJS1 Menus.composeMainMenu
// (src/com/lushprojects/circuitjs1/client/Menus.java, master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, limited to the element classes ported so far.

import { Simulation, constructElement } from '@circuitjs-next/elements';

export interface PaletteItem {
  /** Upstream class name, as `constructElement` takes it. */
  className: string;
  /** Upstream menu text without "Add ". */
  label: string;
  /** Extra words the search matches. */
  keywords: string;
  /** Key that selects it (upstream `getShortcut()`), or null. */
  shortcut: string | null;
}

export interface PaletteGroup {
  title: string;
  items: PaletteItem[];
}

const GROUPS: [string, [string, string, string?][]][] = [
  [
    'Basic',
    [
      ['WireElm', 'Wire', 'connection line'],
      ['ResistorElm', 'Resistor', 'ohm'],
      ['GroundElm', 'Ground', 'earth'],
    ],
  ],
  [
    'Passive Components',
    [
      ['CapacitorElm', 'Capacitor', 'farad'],
      ['InductorElm', 'Inductor', 'coil henry'],
      ['SwitchElm', 'Switch', 'spst toggle'],
      ['PushSwitchElm', 'Push Switch', 'button momentary'],
      ['PotElm', 'Potentiometer', 'variable resistor pot'],
    ],
  ],
  [
    'Inputs and Sources',
    [
      ['DCVoltageElm', 'Voltage Source (2-terminal)', 'dc battery supply'],
      ['ACVoltageElm', 'A/C Voltage Source (2-terminal)', 'ac sine generator'],
      ['RailElm', 'Voltage Source (1-terminal)', 'rail vcc supply'],
      ['CurrentElm', 'Current Source', 'amp'],
    ],
  ],
  [
    'Outputs and Labels',
    [
      ['OutputElm', 'Analog Output', 'voltage display'],
      ['LEDElm', 'LED', 'light emitting diode'],
      ['TextElm', 'Text', 'label note'],
      ['LabeledNodeElm', 'Labeled Node', 'net name label'],
      ['ProbeElm', 'Voltmeter/Scope Probe', 'meter probe measure'],
    ],
  ],
  [
    'Active Components',
    [
      ['DiodeElm', 'Diode', 'rectifier'],
      ['ZenerElm', 'Zener Diode', 'regulator'],
      ['NTransistorElm', 'Transistor (bipolar, NPN)', 'bjt npn'],
      ['PTransistorElm', 'Transistor (bipolar, PNP)', 'bjt pnp'],
      ['NMosfetElm', 'MOSFET (N-Channel)', 'fet nmos'],
      ['PMosfetElm', 'MOSFET (P-Channel)', 'fet pmos'],
    ],
  ],
  ['Active Building Blocks', [['OpAmpElm', 'Op Amp (ideal, - on top)', 'opamp amplifier']]],
];

let groups: PaletteGroup[] | null = null;

/** The palette, with each element's upstream shortcut key. */
export function paletteGroups(): PaletteGroup[] {
  if (groups !== null) return groups;
  const sim = new Simulation();
  groups = GROUPS.map(([title, items]) => ({
    title,
    items: items.map(([className, label, keywords]) => {
      const sample = constructElement(className, 0, 0, sim);
      const code = sample?.getShortcut() ?? 0;
      return {
        className,
        label,
        keywords: keywords ?? '',
        shortcut: code > 0 ? String.fromCharCode(code) : null,
      };
    }),
  }));
  return groups;
}

export function paletteItem(className: string): PaletteItem | undefined {
  for (const g of paletteGroups())
    for (const it of g.items) if (it.className === className) return it;
  return undefined;
}

/** Shortcut key (case sensitive, as upstream) to class name. */
export function shortcutMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of paletteGroups())
    for (const it of g.items)
      if (it.shortcut !== null && !m.has(it.shortcut)) m.set(it.shortcut, it.className);
  return m;
}

/** Items whose name or keywords contain every word of the query. */
export function searchPalette(query: string): PaletteGroup[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return paletteGroups();
  return paletteGroups()
    .map((g) => ({
      title: g.title,
      items: g.items.filter((it) => {
        const hay = `${it.label} ${it.keywords} ${it.className}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((g) => g.items.length > 0);
}

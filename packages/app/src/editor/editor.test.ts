// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

import {
  ResistorElm,
  SwitchElm,
  viewFor,
  WireElm,
  type CircuitElm,
} from '@circuitjs-next/elements';
import { Circuit } from '@circuitjs-next/format';
import { describe, expect, it } from 'vitest';
import { Editor, MouseMode, NO_MODIFIERS, type EditorHost } from './Editor.ts';

function setup(text = '$ 1 5.0E-6 10 50 5.0\n') {
  const circuit = new Circuit();
  circuit.read(text);
  let changes = 0;
  const host: EditorHost = {
    bbox: (e) => viewFor(e)?.bbox(e) ?? null,
    circuitChanged: () => {
      circuit.sim.setElements(circuit.elements);
      changes++;
    },
    selectionChanged: () => {},
    restore: (xml) => circuit.read(xml),
    visibleArea: () => ({ x1: 0, y1: 0, x2: 800, y2: 600 }),
  };
  const ed = new Editor(circuit, host);
  return { circuit, ed, changes: () => changes };
}

const pos = (e: CircuitElm) => [e.x, e.y, e.x2, e.y2];

function drag(ed: Editor, x1: number, y1: number, x2: number, y2: number, mods = NO_MODIFIERS) {
  ed.hover(x1, y1);
  ed.pointerDown(x1, y1, mods);
  ed.pointerDrag((x1 + x2) / 2, (y1 + y2) / 2, mods);
  ed.pointerDrag(x2, y2, mods);
  ed.pointerUp(mods);
}

describe('Editor', () => {
  it('places an element by dragging it out, snapped to the grid', () => {
    const { circuit, ed } = setup();
    ed.setAddMode('ResistorElm');
    drag(ed, 101, 99, 197, 102);
    expect(circuit.elements).toHaveLength(1);
    const r = circuit.elements[0] as ResistorElm;
    expect(r).toBeInstanceOf(ResistorElm);
    expect(pos(r)).toEqual([96, 96, 192, 96]);
    expect(r.resistance).toBe(1000);
    expect(ed.history.canUndo).toBe(true);
  });

  it('does not create a zero-length element on a click', () => {
    const { circuit, ed } = setup();
    ed.setAddMode('WireElm');
    drag(ed, 100, 100, 101, 101);
    expect(circuit.elements).toHaveLength(0);
    expect(ed.history.canUndo).toBe(false);
  });

  it('selects with a click and moves the selection by dragging', () => {
    const { circuit, ed } = setup(
      '$ 1 5.0E-6 10 50 5.0\nr 96 96 192 96 0 1000\nw 192 96 192 192 0\n',
    );
    const [r, w] = circuit.elements as [CircuitElm, CircuitElm];
    ed.hover(144, 96);
    ed.pointerDown(144, 96, NO_MODIFIERS);
    ed.pointerUp(NO_MODIFIERS);
    expect(r.selected).toBe(true);
    expect(w.selected).toBe(false);
    drag(ed, 144, 96, 144 + 32, 96 + 48);
    expect(pos(r)).toEqual([128, 144, 224, 144]);
    expect(pos(w)).toEqual([192, 96, 192, 192]);
    ed.history.undo();
    expect(pos(circuit.elements[0] as CircuitElm)).toEqual([96, 96, 192, 96]);
    ed.history.redo();
    expect(pos(circuit.elements[0] as CircuitElm)).toEqual([128, 144, 224, 144]);
  });

  it('selects an area with a rubber band and clears it with a click on empty space', () => {
    const { circuit, ed } = setup(
      '$ 1 5.0E-6 10 50 5.0\nr 96 96 192 96 0 1000\nr 96 400 192 400 0 1000\n',
    );
    drag(ed, 80, 80, 300, 200);
    expect(circuit.elements.map((e) => e.selected)).toEqual([true, false]);
    ed.hover(500, 500);
    ed.pointerDown(500, 500, NO_MODIFIERS);
    ed.pointerUp(NO_MODIFIERS);
    expect(circuit.elements.some((e) => e.selected)).toBe(false);
  });

  it('stretches an element by its end post', () => {
    const { circuit, ed } = setup('$ 1 5.0E-6 10 50 5.0\nw 96 96 192 96 0\n');
    drag(ed, 192, 96, 192, 160);
    expect(pos(circuit.elements[0] as CircuitElm)).toEqual([96, 96, 192, 160]);
  });

  it('splits a wire when a new wire ends on its middle', () => {
    const { circuit, ed } = setup('$ 1 5.0E-6 10 50 5.0\nw 96 96 224 96 0\n');
    ed.setAddMode('WireElm');
    drag(ed, 160, 192, 160, 96);
    const wires = circuit.elements.filter((e) => e instanceof WireElm).map(pos);
    expect(wires).toContainEqual([96, 96, 160, 96]);
    expect(wires).toContainEqual([160, 96, 224, 96]);
    expect(wires).toContainEqual([160, 192, 160, 96]);
  });

  it('splits a new wire where it crosses a junction', () => {
    const { circuit, ed } = setup(
      '$ 1 5.0E-6 10 50 5.0\nw 160 32 160 96 0\nw 160 96 160 160 0\nw 160 96 224 96 0\n',
    );
    ed.setAddMode('WireElm');
    drag(ed, 96, 96, 224, 96);
    const wires = circuit.elements.filter((e) => e instanceof WireElm).map(pos);
    // 96..160 is new; 160..224 already exists, so it is not doubled
    expect(wires).toContainEqual([96, 96, 160, 96]);
    expect(wires.filter((p) => p[1] === 96 && p[3] === 96)).toHaveLength(2);
  });

  it('deletes, copies and pastes, and every step undoes', () => {
    const { circuit, ed } = setup('$ 1 5.0E-6 10 50 5.0\nr 96 96 192 96 0 470\n');
    const r = circuit.elements[0] as ResistorElm;
    ed.select(r);
    const clip = ed.copySelected(null);
    expect(clip).toContain('<r ');
    expect(ed.paste()).toBe(true);
    expect(circuit.elements).toHaveLength(2);
    const pasted = circuit.elements[1] as ResistorElm;
    expect(pasted.resistance).toBe(470);
    expect(pasted.selected).toBe(true);
    expect(pos(pasted)).not.toEqual(pos(r));
    ed.deleteSelected(null);
    expect(circuit.elements).toHaveLength(1);
    ed.history.undo();
    expect(circuit.elements).toHaveLength(2);
    ed.history.undo();
    expect(circuit.elements).toHaveLength(1);
  });

  it('rotates the selection a quarter turn as upstream does', () => {
    const { circuit, ed } = setup('$ 1 5.0E-6 10 50 5.0\nr 96 96 192 96 0 1000\n');
    ed.selectAll();
    ed.rotateCW();
    const r = circuit.elements[0] as CircuitElm;
    // centre (144, 96): a horizontal resistor becomes vertical through the same centre
    expect(r.x).toBe(r.x2);
    expect(Math.abs(r.y2 - r.y)).toBe(96);
    ed.rotateCCW();
    expect(pos(r)).toEqual([96, 96, 192, 96]);
  });

  it('toggles a switch on click without recording an edit', () => {
    const { circuit, ed } = setup('$ 1 5.0E-6 10 50 5.0\ns 96 96 192 96 0 0 false\n');
    const s = circuit.elements[0] as SwitchElm;
    ed.hover(144, 92);
    expect(ed.pointerDown(144, 92, NO_MODIFIERS)).toBe('switch');
    ed.pointerUp(NO_MODIFIERS);
    expect(s.position).toBe(1);
    expect(ed.history.canUndo).toBe(false);
  });

  it('asks the app to pan with alt-drag and edits nothing', () => {
    const { circuit, ed } = setup('$ 1 5.0E-6 10 50 5.0\nr 96 96 192 96 0 1000\n');
    const alt = { ...NO_MODIFIERS, alt: true };
    expect(ed.pointerDown(144, 96, alt)).toBe('pan');
    expect(ed.isPanning).toBe(true);
    ed.pointerDrag(300, 300, alt);
    ed.pointerUp(alt);
    expect(pos(circuit.elements[0] as CircuitElm)).toEqual([96, 96, 192, 96]);
    expect(ed.tempMouseMode).toBe(MouseMode.SELECT);
  });

  it('drops an element dragged from the palette at its default size', () => {
    const { circuit, ed } = setup();
    ed.paletteDragMove('CapacitorElm', { x: 99, y: 130 }, false);
    ed.paletteDragMove('CapacitorElm', { x: 120, y: 160 }, true);
    const c = ed.paletteDragEnd();
    expect(c).not.toBeNull();
    expect(circuit.elements).toHaveLength(1);
    expect(pos(circuit.elements[0] as CircuitElm)).toEqual([112, 160, 112, 224]);
  });

  it('saves a circuit it built that reads back the same', () => {
    const { circuit, ed } = setup();
    ed.setAddMode('DCVoltageElm');
    drag(ed, 96, 192, 96, 96);
    ed.setAddMode('ResistorElm');
    drag(ed, 96, 96, 224, 96);
    ed.setAddMode('WireElm');
    drag(ed, 224, 96, 224, 192);
    drag(ed, 224, 192, 96, 192);
    const xml = circuit.dumpXml();
    const again = new Circuit();
    again.read(xml);
    expect(again.dumpXml()).toBe(xml);
    expect(again.elements.map((e) => e.getClassName())).toEqual([
      'DCVoltageElm',
      'ResistorElm',
      'WireElm',
      'WireElm',
    ]);
  });
});

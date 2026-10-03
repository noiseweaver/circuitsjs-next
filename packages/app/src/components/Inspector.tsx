// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
// Fields follow CircuitJS1 EditDialog (src/com/lushprojects/circuitjs1/client/EditDialog.java,
// master) at 5a707168778216bb6ed01bfdd62e8bbf7ae0a032: the element lists its fields with
// getEditInfo and takes values back with setEditValue. Unlike upstream's dialog, each field
// applies on its own (Enter or leaving the field), so values can be tuned while the circuit runs.

import {
  CircuitElm,
  VoltageElm,
  parseUnits,
  stepE12,
  unitString,
  type EditInfo,
} from '@circuitjs-next/elements';
import { useEffect, useMemo, useRef, useState } from 'react';
import { controller } from '../SimController.ts';
import { useApp } from '../store.ts';
import { Icon, type IconName } from './Icon.tsx';

/** Upstream unitString(ei), with voltage sources shown in rms when that is shorter. */
function displayValue(elm: CircuitElm, ei: EditInfo, v = ei.value): string {
  if (elm instanceof VoltageElm && !ei.dimensionless && elm.useRmsDisplay(v))
    return unitString(ei, v * elm.getRmsMultiplier()) + 'rms';
  return unitString(ei, v);
}

/** Upstream parseUnits(ei): voltage sources convert "rms" with their waveform's multiplier. */
function readValue(elm: CircuitElm, text: string): number {
  const s = text.trim();
  if (elm instanceof VoltageElm && s.endsWith('rms')) {
    const mult = elm.getRmsMultiplier();
    if (mult > 0) return parseUnits(s.substring(0, s.length - 3)) / mult;
  }
  return parseUnits(s);
}

function labelText(name: string): string {
  // upstream allows HTML in names starting with "<" (links); show the text only
  return name.startsWith('<') ? name.replace(/<[^>]*>/g, '') : name;
}

const fieldLabel = (ei: EditInfo): string => labelText(ei.name);

interface FieldProps {
  elm: CircuitElm;
  n: number;
  ei: EditInfo;
  autoFocus: boolean;
  onError: (msg: string | null) => void;
}

function apply(props: FieldProps): void {
  const { elm, n, ei, onError } = props;
  ei.error = null;
  if (ei.positive && ei.value <= 0) ei.setError('must be > 0');
  if (ei.nonNegative && ei.value < 0) ei.setError('must be >= 0');
  if (ei.error === null) controller.applyEdit(elm, n, ei);
  if (ei.error !== null) {
    const field = ei.errorFieldName ?? ei.name;
    onError(field ? `${labelText(field)}: ${ei.error}` : ei.error);
  } else onError(null);
}

function NumberField(props: FieldProps) {
  const { elm, ei } = props;
  const [text, setText] = useState(() => displayValue(elm, ei));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(displayValue(elm, ei)), [elm, ei]);
  const commit = (s: string): void => {
    let v: number;
    try {
      v = readValue(elm, s);
    } catch {
      setBad(true);
      return;
    }
    setBad(false);
    if (v === ei.value) return;
    ei.value = v;
    apply(props);
  };
  const step = (dir: number): void => {
    let cur: number;
    try {
      cur = readValue(elm, text);
    } catch {
      cur = ei.value;
    }
    const next = ei.dimensionless || ei.unitStep ? cur + dir : stepE12(cur, dir);
    setText(displayValue(elm, ei, next));
    ei.value = next;
    apply(props);
  };
  const id = `field-${props.n}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {fieldLabel(ei)}
      </label>
      <div className="stepper">
        <button
          type="button"
          className="icon-button icon-button-small"
          aria-label={`Decrease ${fieldLabel(ei)}`}
          onClick={() => step(-1)}
        >
          <Icon name="minus" size={18} />
        </button>
        <input
          id={id}
          className="text-input field-input"
          data-invalid={bad || undefined}
          value={text}
          autoFocus={props.autoFocus}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value);
            if (e.key === 'Escape') {
              setText(displayValue(elm, ei));
              setBad(false);
              e.currentTarget.blur();
            }
          }}
          data-testid={`field-${props.n}`}
        />
        <button
          type="button"
          className="icon-button icon-button-small"
          aria-label={`Increase ${fieldLabel(ei)}`}
          onClick={() => step(1)}
        >
          <Icon name="add" size={18} />
        </button>
      </div>
      {bad && <span className="field-error">Not a number. Try 4.7k, 100n or 2k2.</span>}
    </div>
  );
}

function TextField(props: FieldProps) {
  const { ei } = props;
  const [text, setText] = useState(ei.text ?? '');
  useEffect(() => setText(ei.text ?? ''), [ei]);
  const commit = (s: string): void => {
    if (s === ei.text) return;
    ei.text = s;
    apply(props);
  };
  const id = `field-${props.n}`;
  const common = {
    id,
    className: 'text-input field-input',
    value: text,
    autoFocus: props.autoFocus,
    spellCheck: false,
    'data-testid': `field-${props.n}`,
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {fieldLabel(ei)}
      </label>
      {ei.multiline ? (
        <textarea
          {...common}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
        />
      ) : (
        <input
          {...common}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value);
          }}
        />
      )}
    </div>
  );
}

function CheckboxField(props: FieldProps) {
  const cb = props.ei.checkbox;
  if (!cb) return null;
  return (
    <label className="field field-check">
      <input
        type="checkbox"
        className="checkbox"
        checked={cb.state}
        autoFocus={props.autoFocus}
        onChange={(e) => {
          cb.state = e.target.checked;
          apply(props);
        }}
        data-testid={`field-${props.n}`}
      />
      <span>{cb.label}</span>
    </label>
  );
}

function ChoiceField(props: FieldProps) {
  const ch = props.ei.choice;
  if (!ch) return null;
  const id = `field-${props.n}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {fieldLabel(props.ei)}
      </label>
      <select
        id={id}
        className="select"
        value={ch.selected}
        autoFocus={props.autoFocus}
        onChange={(e) => {
          ch.selected = Number(e.target.value);
          props.ei.value = ch.selected;
          apply(props);
        }}
        data-testid={`field-${props.n}`}
      >
        {ch.items.map((it, i) => (
          <option key={i} value={i}>
            {it}
          </option>
        ))}
      </select>
    </div>
  );
}

function ActionButton(props: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/** Rotate, mirror and delete for the selection. */
function SelectionActions({ elm }: { elm: CircuitElm | null }) {
  const ed = controller.editor;
  return (
    <div className="inspector-actions">
      <ActionButton icon="rotateLeft" label="Rotate CCW" onClick={() => ed.rotateCCW()} />
      <ActionButton icon="rotateRight" label="Rotate CW" onClick={() => ed.rotateCW()} />
      <ActionButton icon="flip" label="Mirror X" onClick={() => ed.mirrorX()} />
      {elm !== null && elm.getPostCount() === 2 && (
        <ActionButton icon="swap" label="Swap terminals" onClick={() => ed.swapTerminals(elm)} />
      )}
      <ActionButton icon="copy" label="Duplicate" onClick={() => ed.duplicate(null)} />
      <ActionButton icon="delete" label="Delete" onClick={() => ed.deleteSelected(null)} />
    </div>
  );
}

/** Properties of the selected element, or what to do with a multiple selection. */
/** Narrow screens show the panel as a bottom sheet (matches the CSS breakpoint). */
const NARROW = '(max-width: 719px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = (): void => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

type SheetSnap = 'peek' | 'half' | 'full';
/** The sheet keeps the height the user last chose while the app is open. */
let lastSnap: SheetSnap = 'half';

/** Sheet heights in px: just the title row, about half the screen, or up to the app bar. */
function sheetHeights(panel: HTMLElement): Record<SheetSnap, number> {
  const header = panel.querySelector<HTMLElement>('.inspector-header');
  const peek = header ? header.offsetTop + header.offsetHeight + 8 : 96;
  const full = Math.max(peek, window.innerHeight - 64 - 16);
  const half = Math.min(full, Math.max(peek, Math.round(window.innerHeight * 0.45)));
  return { peek, half, full };
}

/** Drag handle: drag to resize the sheet, release to snap; a tap toggles it open or shut. */
function SheetHandle(props: {
  panel: React.RefObject<HTMLElement | null>;
  snap: SheetSnap;
  setSnap: (s: SheetSnap) => void;
  setDragHeight: (h: number | null) => void;
}) {
  const drag = useRef<{ id: number; y: number; h: number; moved: boolean } | null>(null);
  const { panel, snap, setSnap, setDragHeight } = props;
  const heightAt = (y: number): number => {
    const d = drag.current;
    const el = panel.current;
    if (!d || !el) return 0;
    const hs = sheetHeights(el);
    return Math.min(hs.full, Math.max(hs.peek, d.h - (y - d.y)));
  };
  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={snap === 'peek' ? 'Show properties' : 'Hide properties'}
      aria-expanded={snap !== 'peek'}
      data-testid="sheet-handle"
      onPointerDown={(e) => {
        const el = panel.current;
        if (!el || e.button !== 0) return;
        drag.current = { id: e.pointerId, y: e.clientY, h: el.offsetHeight, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        if (!d.moved && Math.abs(e.clientY - d.y) < 4) return;
        d.moved = true;
        setDragHeight(heightAt(e.clientY));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        const el = panel.current;
        if (!d || d.id !== e.pointerId || !el) return;
        let next: SheetSnap;
        if (!d.moved) next = snap === 'peek' ? 'half' : 'peek';
        else {
          const h = heightAt(e.clientY);
          const hs = sheetHeights(el);
          next = (['peek', 'half', 'full'] as const).reduce((a, b) =>
            Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a,
          );
        }
        drag.current = null;
        setDragHeight(null);
        setSnap(next);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragHeight(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') setSnap(snap === 'peek' ? 'half' : 'full');
        else if (e.key === 'ArrowDown') setSnap(snap === 'full' ? 'half' : 'peek');
        else return;
        e.preventDefault();
      }}
    >
      <span className="sheet-handle-bar" />
    </button>
  );
}

export function Inspector() {
  const selected = useApp((s) => s.editor.selected);
  const count = useApp((s) => s.editor.selectionCount);
  const revision = useApp((s) => s.editor.revision);
  const focus = useApp((s) => s.inspectorFocus);
  const [error, setError] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  const [snap, setSnapState] = useState<SheetSnap>(lastSnap);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [heights, setHeights] = useState<Record<SheetSnap, number> | null>(null);
  const setSnap = (s: SheetSnap): void => {
    lastSnap = s;
    setSnapState(s);
  };

  const infos = useMemo(() => {
    const list: EditInfo[] = [];
    if (selected === null) return list;
    for (let i = 0; i < 40; i++) {
      const ei = selected.getEditInfo(i);
      if (ei === null) break;
      list.push(ei);
    }
    return list;
    // revision: values changed elsewhere (undo, drag); rebuild: a field asked for a new list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, revision, rebuild]);

  useEffect(() => setError(null), [selected]);

  // measure the sheet's snap heights once it is on screen, and again when the window resizes
  const shown = count > 0;
  useEffect(() => {
    if (!narrow || !shown) return;
    const measure = (): void => {
      if (panel.current) setHeights(sheetHeights(panel.current));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [narrow, shown, selected]);

  // double-click and Enter move the keyboard to the first field (opening a shut sheet)
  useEffect(() => {
    if (focus === 0) return;
    if (lastSnap === 'peek') setSnap('half');
    const first = panel.current?.querySelector<HTMLElement>('[data-testid="field-0"]');
    first?.focus();
  }, [focus]);

  if (count === 0) return null;

  const onError = (msg: string | null): void => {
    setError(msg);
    // upstream rebuilds the dialog when a field sets newDialog (a waveform change)
    if (infos.some((ei) => ei.newDialog)) setRebuild((r) => r + 1);
  };

  return (
    <aside
      className="inspector"
      aria-label="Properties"
      data-testid="inspector"
      data-sheet={narrow ? snap : undefined}
      data-dragging={dragHeight !== null || undefined}
      style={narrow && heights !== null ? { height: dragHeight ?? heights[snap] } : undefined}
      ref={panel}
    >
      <SheetHandle panel={panel} snap={snap} setSnap={setSnap} setDragHeight={setDragHeight} />
      <header className="inspector-header">
        <h2 className="inspector-title" data-testid="inspector-title">
          {selected !== null
            ? selected.getDialogTitle().replace(/^Edit /, '')
            : `${count} selected`}
        </h2>
        <button
          type="button"
          className="icon-button icon-button-small"
          aria-label="Close"
          onClick={() => controller.editor.clearSelection()}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <SelectionActions elm={selected} />
      {selected !== null && (
        <form className="inspector-fields" onSubmit={(e) => e.preventDefault()}>
          {infos.length === 0 && <p className="inspector-empty">No properties to edit.</p>}
          {infos.map((ei, n) => {
            const props: FieldProps = {
              elm: selected,
              n,
              ei,
              autoFocus: false,
              onError,
            };
            const key = `${n}:${revision}:${rebuild}`;
            if (ei.choice) return <ChoiceField key={key} {...props} />;
            if (ei.checkbox) return <CheckboxField key={key} {...props} />;
            if (ei.text !== null) return <TextField key={key} {...props} />;
            return <NumberField key={key} {...props} />;
          })}
          {error !== null && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </aside>
  );
}

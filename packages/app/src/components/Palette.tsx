// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

import { Simulation, constructElement } from '@circuitjs-next/elements';
import { drawPreview } from '@circuitjs-next/render';
import { useEffect, useRef, useState } from 'react';
import { searchPalette, type PaletteItem } from '../editor/catalog.ts';
import { themeById, controller } from '../SimController.ts';
import { useApp } from '../store.ts';
import { Icon } from './Icon.tsx';

const previewSim = new Simulation();
const ICON_W = 44;
const ICON_H = 32;

/** The element drawn small with the current theme. */
function Preview({ className }: { className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const themeId = useApp((s) => s.settings.themeId);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const e = constructElement(className, 0, 0, previewSim);
    if (!e) return;
    e.dragPlace(0, 0, false);
    drawPreview(c, e, themeById(themeId), ICON_W, ICON_H, window.devicePixelRatio || 1);
  }, [className, themeId]);
  return (
    <canvas
      ref={ref}
      className="palette-icon"
      style={{ width: ICON_W, height: ICON_H }}
      aria-hidden
    />
  );
}

/** Pixels a press must travel before it becomes a drag onto the canvas. */
const DRAG_THRESHOLD = 6;

function PaletteButton({ item, active }: { item: PaletteItem; active: boolean }) {
  const drag = useRef<{ x: number; y: number; id: number; active: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
      d.active = true;
    }
    const pos = controller.clientToCircuit(e.clientX, e.clientY);
    controller.editor.paletteDragMove(item.className, pos, e.shiftKey);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (d.active) {
      controller.editor.paletteDragEnd();
      // the drag is not a click
      e.preventDefault();
      return;
    }
    // a click picks the element for placing by dragging on the canvas (again to stop)
    if (active) controller.editor.setSelectMode();
    else controller.editor.setAddMode(item.className);
    if (window.innerWidth < 720) useApp.setState({ paletteOpen: false });
  };
  const onPointerCancel = (): void => {
    drag.current = null;
    controller.editor.paletteDragMove(item.className, null, false);
  };

  return (
    <button
      type="button"
      className="palette-item"
      data-active={active || undefined}
      data-testid={`palette-${item.className}`}
      title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (active) controller.editor.setSelectMode();
          else controller.editor.setAddMode(item.className);
        }
      }}
    >
      <Preview className={item.className} />
      <span className="palette-label">{item.label}</span>
      {item.shortcut && <kbd className="palette-key">{item.shortcut}</kbd>}
    </button>
  );
}

/** Searchable list of the elements that can be placed. */
export function Palette() {
  const [query, setQuery] = useState('');
  const addClass = useApp((s) => s.editor.addClass);
  const groups = searchPalette(query);
  return (
    <aside className="palette" aria-label="Components" data-testid="palette">
      <div className="palette-search">
        <Icon name="search" size={20} />
        <input
          className="palette-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search components"
          aria-label="Search components"
          data-testid="palette-search"
        />
        {query && (
          <button
            type="button"
            className="icon-button icon-button-small"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      <div className="palette-hint">Click, then drag on the canvas. Or drag onto it.</div>
      <div className="palette-list">
        {groups.map((g) => (
          <section key={g.title} className="palette-group">
            <h2 className="palette-group-title">{g.title}</h2>
            {g.items.map((it) => (
              <PaletteButton key={it.className} item={it} active={addClass === it.className} />
            ))}
          </section>
        ))}
        {groups.length === 0 && <p className="palette-empty">No component matches “{query}”.</p>}
      </div>
    </aside>
  );
}

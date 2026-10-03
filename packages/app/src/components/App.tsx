// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

import { themeCssVariables } from '@circuitjs-next/theme';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useEffect } from 'react';
import { themeById } from '../SimController.ts';
import { startup } from '../startup.ts';
import { useApp } from '../store.ts';
import { installShortcuts } from '../commands.ts';
import { paletteItem } from '../editor/catalog.ts';
import { controller } from '../SimController.ts';
import { AppBar } from './AppBar.tsx';
import { CircuitCanvas } from './CircuitCanvas.tsx';
import { ControlBar } from './ControlBar.tsx';
import { Dialogs } from './Dialogs.tsx';
import { Inspector } from './Inspector.tsx';
import { Palette } from './Palette.tsx';

let started = false;

export function App() {
  const themeId = useApp((s) => s.settings.themeId);
  const paletteOpen = useApp((s) => s.paletteOpen);

  useEffect(() => {
    // theme tokens for the UI chrome; values are validated theme data
    const vars = themeCssVariables(themeById(themeId));
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset['theme'] = themeId;
  }, [themeId]);

  useEffect(() => installShortcuts(), []);

  useEffect(() => {
    if (started) return;
    started = true;
    void startup();
  }, []);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="app">
        <AppBar />
        <div className="workspace">
          {paletteOpen && <Palette />}
          <main className="canvas-area">
            <CircuitCanvas />
            <ModeChip />
            <Toast />
          </main>
          <Inspector />
        </div>
        <ControlBar />
        <Dialogs />
      </div>
    </Tooltip.Provider>
  );
}

/** What a drag on the canvas will place, with a way out. */
function ModeChip() {
  const addClass = useApp((s) => s.editor.addClass);
  if (addClass === null) return null;
  const label = paletteItem(addClass)?.label ?? addClass;
  return (
    <div className="mode-chip" data-testid="mode-chip">
      <span>
        Drag to place: <strong>{label}</strong>
      </span>
      <button type="button" className="button" onClick={() => controller.editor.setSelectMode()}>
        Done
      </button>
    </div>
  );
}

function Toast() {
  const toast = useApp((s) => s.toast);
  if (toast === null) return null;
  return (
    <div className="toast" role="status" data-testid="toast">
      {toast}
    </div>
  );
}

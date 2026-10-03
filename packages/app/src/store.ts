// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

import type { CircuitElm } from '@circuitjs-next/elements';
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from '@circuitjs-next/theme';
import { create } from 'zustand';
import type { ExampleList } from './examples.ts';

/** Display settings that belong to the user, not the circuit (kept in localStorage). */
export interface UserSettings {
  themeId: string;
  euroResistors: boolean;
  showOhm: boolean;
  conventionalCurrent: boolean;
}

/** Circuit options shown in the Options menu (saved with the circuit). */
export interface CircuitDisplay {
  showDots: boolean;
  voltageColors: boolean;
  showValues: boolean;
  smallGrid: boolean;
}

export interface SimStatus {
  t: number;
  timeStep: number;
  stopMessage: string | null;
  badConnections: number;
}

/** Editor state the UI shows (the editor itself lives in the controller). */
export interface EditorState {
  /** Class placed by dragging on the canvas, or null in select mode. */
  addClass: string | null;
  selectionCount: number;
  /** The one selected element (property panel), else null. */
  selected: CircuitElm | null;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  /** Bumped when the selected element's properties may have changed. */
  revision: number;
}

export interface AppState {
  title: string;
  running: boolean;
  /** Simulation speed slider, 0..259 (upstream scale). */
  speed: number;
  /** Current speed slider, 1..99. */
  currentSpeed: number;
  display: CircuitDisplay;
  settings: UserSettings;
  status: SimStatus;
  warnings: string[];
  /** Load or fetch error to show. */
  error: string | null;
  examples: ExampleList | null;
  editor: EditorState;
  /** The palette panel is open (it closes itself on narrow screens). */
  paletteOpen: boolean;
  /** Text of a short notice ("Link copied"), or null. */
  toast: string | null;
  /** Open dialog (commands.ts DialogKind). */
  dialog: 'save' | 'exportLink' | 'exportText' | 'importText' | 'shortcuts' | null;
  /** Bumped to move keyboard focus to the property panel (double-click, Enter). */
  inspectorFocus: number;
}

const SETTINGS_KEY = 'circuitjs-next.settings.v2';
/**
 * Version 1 saved the default theme (Classic) along with any other setting, so its theme is not
 * a choice the user made. Its other settings carry over; the theme starts at the new default.
 */
const SETTINGS_KEY_V1 = 'circuitjs-next.settings';

function loadSettings(): UserSettings {
  const defaults: UserSettings = {
    themeId: DEFAULT_THEME_ID,
    euroResistors: false,
    showOhm: false,
    conventionalCurrent: true,
  };
  try {
    let raw = localStorage.getItem(SETTINGS_KEY);
    let fromV1 = false;
    if (raw === null) {
      raw = localStorage.getItem(SETTINGS_KEY_V1);
      fromV1 = true;
    }
    if (raw === null) return defaults;
    const s = JSON.parse(raw) as Partial<UserSettings>;
    if (fromV1) delete s.themeId;
    return {
      themeId:
        typeof s.themeId === 'string' && s.themeId in BUILTIN_THEMES ? s.themeId : defaults.themeId,
      euroResistors:
        typeof s.euroResistors === 'boolean' ? s.euroResistors : defaults.euroResistors,
      showOhm: typeof s.showOhm === 'boolean' ? s.showOhm : defaults.showOhm,
      conventionalCurrent:
        typeof s.conventionalCurrent === 'boolean'
          ? s.conventionalCurrent
          : defaults.conventionalCurrent,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // private mode or storage disabled: settings last for this page only
  }
}

export const useApp = create<AppState>(() => ({
  title: '',
  running: true,
  speed: 117,
  currentSpeed: 50,
  display: { showDots: true, voltageColors: true, showValues: true, smallGrid: false },
  settings: loadSettings(),
  status: { t: 0, timeStep: 5e-6, stopMessage: null, badConnections: 0 },
  warnings: [],
  error: null,
  examples: null,
  editor: {
    addClass: null,
    selectionCount: 0,
    selected: null,
    canUndo: false,
    canRedo: false,
    canPaste: false,
    revision: 0,
  },
  paletteOpen: typeof window === 'undefined' || window.innerWidth >= 720,
  toast: null,
  inspectorFocus: 0,
  dialog: null,
}));

export function updateSettings(patch: Partial<UserSettings>): void {
  const settings = { ...useApp.getState().settings, ...patch };
  useApp.setState({ settings });
  saveSettings(settings);
}

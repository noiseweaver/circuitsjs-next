// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/PushSwitchElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import type { ElementType } from '../CircuitElm.ts';
import { SwitchElm } from './SwitchElm.ts';

/**
 * A momentary switch, open until pressed. Upstream saves it as a plain SwitchElm
 * (`getDumpClass()`), so files never load as this class; it only comes from the menu.
 */
export class PushSwitchElm extends SwitchElm {
  override getClassName(): string {
    return 'PushSwitchElm';
  }
  override getShortcut(): number {
    return 0;
  }

  /** Upstream `SwitchElm(int xx, int yy, boolean mm)` with mm true. */
  override initNew(): void {
    this.position = 1;
    this.momentary = true;
    this.posCount = 2;
    this.label = null;
    this.keyShortcut = null;
  }
}

export const PushSwitchElmType: ElementType = {
  className: 'PushSwitchElm',
  create(x, y, sim) {
    const e = new PushSwitchElm(x, y, x, y, 0);
    e.sim = sim;
    e.initNew();
    return e;
  },
  load(x1, y1, x2, y2, f, st, sim) {
    const e = new SwitchElm(x1, y1, x2, y2, f);
    e.sim = sim;
    e.undump(st);
    return e;
  },
};

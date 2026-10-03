// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/ZenerElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032 (Zener code contributed by J. Mike Rollins).
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { elementType } from '../CircuitElm.ts';
import { parseJavaDouble } from '../java.ts';
import { modelsFor } from '../models/ModelLibrary.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import { DiodeElm } from './DiodeElm.ts';

export class ZenerElm extends DiodeElm {
  /** Upstream `ZenerElm.lastZenerModelName`. */
  static readonly defaultZenerModelName: string = 'default-zener';

  override getClassName(): string {
    return 'ZenerElm';
  }
  override getDumpType(): number {
    return 'z'.charCodeAt(0);
  }

  override initNew(): void {
    super.initNew();
    this.modelName = ZenerElm.defaultZenerModelName;
    this.setup();
  }

  override undump(st: StringTokenizer): void {
    super.undump(st);
    if ((this.flags & DiodeElm.FLAG_MODEL) === 0) {
      const zvoltage = parseJavaDouble(st.nextToken());
      this.model = modelsFor(this.sim).diode.getModelWithParameters(
        this.getModel().fwdrop,
        zvoltage,
      );
      this.modelName = this.model.name;
    }
    this.setup();
  }

  override getElmType(): string {
    return 'Zener diode';
  }

  protected override isZener(): boolean {
    return true;
  }

  override getShortcut(): number {
    return 'z'.charCodeAt(0);
  }
}

export const ZenerElmType = elementType('ZenerElm', ZenerElm);

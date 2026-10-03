// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

import type { Simulation } from '@circuitjs-next/engine';
import { DiodeModels } from './DiodeModel.ts';
import { MosfetModels } from './MosfetModel.ts';
import { TransistorModels } from './TransistorModel.ts';

/**
 * The device models a circuit can refer to by name. Upstream keeps these in static maps that
 * live as long as the page, so models loaded with one circuit stay available to the next. Here
 * they live as long as the Simulation, which a `Circuit` keeps across loads in the same way.
 */
export class ModelLibrary {
  readonly diode = new DiodeModels();
  readonly transistor = new TransistorModels();
  readonly mosfet = new MosfetModels();
  /**
   * Upstream `TransistorElm.globalFlags`: display flags (the circle) shared by every transistor,
   * taken from the last one loaded.
   */
  transistorGlobalFlags = 0;
  /** Upstream `MosfetElm.lastModelName`: the model for new MOSFETs, set when one is edited. */
  mosfetLastModelName = 'default';

  clearDumpedFlags(): void {
    this.diode.clearDumpedFlags();
    this.transistor.clearDumpedFlags();
    this.mosfet.clearDumpedFlags();
  }
}

const libraries = new WeakMap<Simulation, ModelLibrary>();

/** The model library of a simulation, created on first use. */
export function modelsFor(sim: Simulation): ModelLibrary {
  let lib = libraries.get(sim);
  if (lib === undefined) {
    lib = new ModelLibrary();
    libraries.set(sim, lib);
  }
  return lib;
}

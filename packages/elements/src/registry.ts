// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/CirSim.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032: register(), createCe() and constructElement().
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import { Simulation } from '@circuitjs-next/engine';
import { elementType, type CircuitElm, type ElementType } from './CircuitElm.ts';
import { CapacitorElmType } from './elm/CapacitorElm.ts';
import { DiodeElmType } from './elm/DiodeElm.ts';
import { LEDElmType } from './elm/LEDElm.ts';
import { MosfetElmType, NMosfetElmType, PMosfetElmType } from './elm/MosfetElm.ts';
import { OpAmpElmType } from './elm/OpAmpElm.ts';
import { PushSwitchElmType } from './elm/PushSwitchElm.ts';
import { RailElmType } from './elm/RailElm.ts';
import { TextElmType } from './elm/TextElm.ts';
import { NTransistorElmType, PTransistorElmType, TransistorElmType } from './elm/TransistorElm.ts';
import { ZenerElmType } from './elm/ZenerElm.ts';
import { CurrentElmType } from './elm/CurrentElm.ts';
import { GroundElmType } from './elm/GroundElm.ts';
import { InductorElmType } from './elm/InductorElm.ts';
import { LabeledNodeElmType } from './elm/LabeledNodeElm.ts';
import { OutputElmType } from './elm/OutputElm.ts';
import { PotElmType } from './elm/PotElm.ts';
import { ProbeElmType } from './elm/ProbeElm.ts';
import { ResistorElmType } from './elm/ResistorElm.ts';
import { SwitchElmType } from './elm/SwitchElm.ts';
import { ACVoltageElm, DCVoltageElm, VoltageElmType } from './elm/VoltageElm.ts';
import { WireElmType } from './elm/WireElm.ts';
import type { StringTokenizer } from './StringTokenizer.ts';

/** Every ported element class. */
export const ELEMENT_TYPES: readonly ElementType[] = [
  WireElmType,
  GroundElmType,
  ResistorElmType,
  CapacitorElmType,
  InductorElmType,
  VoltageElmType,
  CurrentElmType,
  SwitchElmType,
  LabeledNodeElmType,
  ProbeElmType,
  OutputElmType,
  PotElmType,
  PushSwitchElmType,
  RailElmType,
  DiodeElmType,
  ZenerElmType,
  LEDElmType,
  TransistorElmType,
  MosfetElmType,
  OpAmpElmType,
  TextElmType,
  // menu-only variants; their dump types are already registered under the base class
  NTransistorElmType,
  PTransistorElmType,
  NMosfetElmType,
  PMosfetElmType,
  elementType('DCVoltageElm', DCVoltageElm),
  elementType('ACVoltageElm', ACVoltageElm),
];

const byClassName = new Map<string, ElementType>();
/** Text dump type (char code or number) to class name, first registration wins. */
const dumpTypeMap = new Map<number, string>();
/** XML tag to class name, first registration wins. */
const xmlDumpTypeMap = new Map<string, string>();

const sampleSim = new Simulation();
for (const type of ELEMENT_TYPES) {
  byClassName.set(type.className, type);
  // upstream registers a sample element of each class and asks it for its dump types
  const sample = type.create(0, 0, sampleSim);
  const t = sample.getDumpType();
  if (t > 0 && !dumpTypeMap.has(t)) dumpTypeMap.set(t, type.className);
  const xt = sample.getXmlDumpType();
  if (!xmlDumpTypeMap.has(xt)) xmlDumpTypeMap.set(xt, type.className);
}

/**
 * A new element of the named class at (x, y), or null for an unknown class. Like upstream,
 * a class registered under its base class (TransistorElm, MosfetElm) builds the N-type variant.
 */
export function constructElement(
  className: string,
  x: number,
  y: number,
  sim: Simulation = new Simulation(),
): CircuitElm | null {
  return byClassName.get(className)?.create(x, y, sim) ?? null;
}

/** Class name for an XML tag, or undefined if no ported class uses it. */
export function classNameForXmlTag(tag: string): string | undefined {
  return xmlDumpTypeMap.get(tag);
}

/** Read a text-format element line, or null for an unknown dump type. Throws on bad fields. */
export function createCe(
  tint: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  f: number,
  st: StringTokenizer,
  sim: Simulation = new Simulation(),
): CircuitElm | null {
  const name = dumpTypeMap.get(tint);
  if (name === undefined) return null;
  return byClassName.get(name)?.load(x1, y1, x2, y2, f, st, sim) ?? null;
}

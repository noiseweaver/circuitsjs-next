// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

export {
  CircuitElm,
  distanceSq,
  elementType,
  lineDistanceSq,
  type ElementType,
} from './CircuitElm.ts';
export {
  E12,
  EditInfo,
  noCommaFormat,
  parseUnits,
  stepE12,
  unitString,
  type EditCheckbox,
  type EditChoice,
  type Editable,
} from './edit/EditInfo.ts';
export { SCALE_AUTO, SCALE_1, SCALE_M, SCALE_MU } from './constants.ts';
export { escapeToken, unescapeToken } from './escape.ts';
export {
  NumberFormatException,
  javaDoubleToInt,
  parseJavaBoolean,
  parseJavaDouble,
  parseJavaInt,
} from './java.ts';
export { StringTokenizer } from './StringTokenizer.ts';
export type { XmlAttrReader, XmlAttrWriter, XmlDocWriter } from './xml.ts';
export { ELEMENT_TYPES, classNameForXmlTag, constructElement, createCe } from './registry.ts';

export { CapacitorElm } from './elm/CapacitorElm.ts';
export { Diode } from './elm/Diode.ts';
export { DiodeElm } from './elm/DiodeElm.ts';
export { LEDElm } from './elm/LEDElm.ts';
export { MosfetElm, NMosfetElm, PMosfetElm } from './elm/MosfetElm.ts';
export { OpAmpElm } from './elm/OpAmpElm.ts';
export { PushSwitchElm } from './elm/PushSwitchElm.ts';
export { RailElm } from './elm/RailElm.ts';
export { TextElm } from './elm/TextElm.ts';
export { NTransistorElm, PTransistorElm, TransistorElm } from './elm/TransistorElm.ts';
export { ZenerElm } from './elm/ZenerElm.ts';
export { DiodeModel, DiodeModels } from './models/DiodeModel.ts';
export { ModelLibrary, modelsFor } from './models/ModelLibrary.ts';
export { MosfetModel, MosfetModels } from './models/MosfetModel.ts';
export { TransistorModel, TransistorModels } from './models/TransistorModel.ts';
export { CurrentElm } from './elm/CurrentElm.ts';
export { GroundElm } from './elm/GroundElm.ts';
export { Inductor, InductorElm } from './elm/InductorElm.ts';
export { LabeledNodeElm } from './elm/LabeledNodeElm.ts';
export { OutputElm } from './elm/OutputElm.ts';
export { PotElm } from './elm/PotElm.ts';
export { ProbeElm } from './elm/ProbeElm.ts';
export { ResistorElm } from './elm/ResistorElm.ts';
export { SwitchElm } from './elm/SwitchElm.ts';
export { ACVoltageElm, DCVoltageElm, VoltageElm } from './elm/VoltageElm.ts';
export { WireElm } from './elm/WireElm.ts';

// The engine types loaders and runners need, so packages above elements need not depend on the
// engine directly (eslint.config.js dependency direction).
export { JavaRandom, Simulation, type CircuitNode } from '@circuitjs-next/engine';

// Views: drawing through the Painter interface (render implements it).
export * from './view/index.ts';

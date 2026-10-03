// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/EditInfo.java, EditDialog.java
// (unitString, parseUnits, stepE12) and ScrollValuePopup.java (e12) (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

/** A checkbox field (upstream `Checkbox`). */
export interface EditCheckbox {
  label: string;
  state: boolean;
}

/** A drop-down field (upstream `Choice`). */
export interface EditChoice {
  items: string[];
  selected: number;
}

/**
 * One editable property of an element, as upstream's edit dialog shows it. Elements describe
 * their properties with `getEditInfo(n)` for n = 0, 1, ... until null, and take changes back
 * through `setEditValue(n, ei)`. Which fields appear can depend on other values (a voltage
 * source's waveform), so the list is rebuilt when a field sets `newDialog`.
 *
 * Exactly one of these describes the field: `choice`, `checkbox`, `text` (a text box), or none
 * of them (a number, edited with unit suffixes).
 */
export class EditInfo {
  name: string;
  value: number;
  /** Text field contents; null for numeric fields. */
  text: string | null = null;
  minVal = 0;
  maxVal = 0;
  choice: EditChoice | null = null;
  checkbox: EditCheckbox | null = null;
  /** A multi-line text field (upstream `textArea`). */
  multiline = false;
  /** The field list must be rebuilt after this field changes. */
  newDialog = false;
  dimensionless = false;
  /** Step by 1 instead of through the E12 series. */
  unitStep = false;
  noSliders = false;
  isColor = false;
  newColumn = false;
  positive = false;
  nonNegative = false;
  error: string | null = null;
  errorFieldName: string | null = null;

  constructor(name: string, value: number, minVal?: number, maxVal?: number) {
    this.name = name;
    this.value = value;
    if (minVal !== undefined) this.minVal = minVal;
    if (maxVal !== undefined) this.maxVal = maxVal;
  }

  /** Upstream `EditInfo(String n, String txt)`. */
  static text(name: string, text: string): EditInfo {
    const ei = new EditInfo(name, 0);
    ei.text = text;
    ei.dimensionless = ei.noSliders = true;
    return ei;
  }

  static createCheckbox(name: string, flag: boolean): EditInfo {
    const ei = new EditInfo('', 0, -1, -1);
    ei.checkbox = { label: name, state: flag };
    return ei;
  }

  /** A drop-down with the given items and selection (upstream builds a `Choice` by hand). */
  static createChoice(name: string, items: string[], selected: number): EditInfo {
    const ei = new EditInfo(name, selected, -1, -1);
    ei.choice = { items, selected };
    return ei;
  }

  setDimensionless(): this {
    this.dimensionless = true;
    return this;
  }
  setUnitStep(): this {
    this.unitStep = true;
    return this;
  }
  disallowSliders(): this {
    this.noSliders = true;
    return this;
  }
  setIsColor(): this {
    this.isColor = true;
    return this;
  }
  setNewColumn(): this {
    this.newColumn = true;
    return this;
  }
  setPositive(): this {
    this.positive = true;
    return this;
  }
  setNonNegative(): this {
    this.nonNegative = true;
    return this;
  }
  setError(s: string): void {
    this.error = s;
  }
  setErrorFieldName(s: string): this {
    this.errorFieldName = s;
    return this;
  }

  changeFlag(flags: number, bit: number): number {
    return this.checkbox?.state === true ? flags | bit : flags & ~bit;
  }
  changeFlagInverted(flags: number, bit: number): number {
    return this.checkbox?.state === true ? flags & ~bit : flags | bit;
  }

  /** A number field (not a choice, checkbox or text). */
  isNumeric(): boolean {
    return this.choice === null && this.checkbox === null && this.text === null;
  }

  canCreateAdjustable(): boolean {
    return this.choice === null && this.checkbox === null && !this.multiline && !this.noSliders;
  }
}

/** Anything the edit panel can edit (upstream `Editable`). */
export interface Editable {
  getEditInfo(n: number): EditInfo | null;
  setEditValue(n: number, ei: EditInfo): void;
  getDialogTitle(): string;
}

// ---- number text, as the edit dialog shows and reads it ---------------------------------------

/** GWT `NumberFormat.getFormat("####.##########")`: up to 10 decimals, no grouping. */
export function noCommaFormat(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : 'NaN';
  let s = v.toFixed(10);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

/** Upstream `EditDialog.unitString(ei, v)`: a value with an SI suffix ("4.7k", "100n"). */
export function unitString(ei: EditInfo | null, v: number): string {
  const va = Math.abs(v);
  if (ei !== null && ei.dimensionless) return noCommaFormat(v);
  if (!Number.isFinite(va)) return noCommaFormat(v);
  if (v === 0) return '0';
  if (va < 1e-12) return noCommaFormat(v * 1e15) + 'f';
  if (va < 1e-9) return noCommaFormat(v * 1e12) + 'p';
  if (va < 1e-6) return noCommaFormat(v * 1e9) + 'n';
  if (va < 1e-3) return noCommaFormat(v * 1e6) + 'u';
  if (va < 1) return noCommaFormat(v * 1e3) + 'm';
  if (va < 1e3) return noCommaFormat(v);
  if (va < 1e6) return noCommaFormat(v * 1e-3) + 'k';
  if (va < 1e9) return noCommaFormat(v * 1e-6) + 'M';
  return noCommaFormat(v * 1e-9) + 'G';
}

export const ROOT2 = 1.4142135623730951;

/** GWT `NumberFormat.parse` for "####.##": a plain decimal number, or throws. */
function parsePlain(s: string): number {
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) throw new Error(`not a number: "${s}"`);
  return Number(s);
}

/**
 * Upstream `EditDialog.parseUnits(String)`: reads "4.7k", "2k2", "10meg", "1e-6", "5rms".
 * Throws on text that is not a number.
 */
export function parseUnits(text: string): number {
  let s = text.trim();
  let rmsMult = 1;
  if (s.endsWith('rms')) {
    s = s.substring(0, s.length - 3).trim();
    rmsMult = ROOT2;
  }
  s = s.replace(/([0-9]+)([pPnNuUmMkKgG])([0-9]+)/g, '$1.$3$2');
  s = s.replace(/[mM][eE][gG]$/, 'M');
  if (/^-?[0-9]*\.?[0-9]+[eE][+-]?[0-9]+$/.test(s)) return Number(s) * rmsMult;
  if (s.length === 0) throw new Error('empty value');
  const uc = s.charAt(s.length - 1);
  let mult = 1;
  switch (uc) {
    case 'f':
    case 'F':
      mult = 1e-15;
      break;
    case 'p':
    case 'P':
      mult = 1e-12;
      break;
    case 'n':
    case 'N':
      mult = 1e-9;
      break;
    case 'u':
    case 'U':
    case 'μ':
    case 'µ':
      mult = 1e-6;
      break;
    case 'm':
      mult = 1e-3;
      break;
    case 'k':
    case 'K':
      mult = 1e3;
      break;
    case 'M':
      mult = 1e6;
      break;
    case 'G':
    case 'g':
      mult = 1e9;
      break;
  }
  if (mult !== 1) s = s.substring(0, s.length - 1).trim();
  return parsePlain(s) * mult * rmsMult;
}

/** The E12 preferred-value series (upstream `ScrollValuePopup.e12`). */
export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2] as const;

/** Upstream `EditDialog.stepE12`: the next or previous E12 value, by decade. */
export function stepE12(value: number, dir: number): number {
  if (value === 0) return dir > 0 ? E12[0] : -E12[0];
  const sign = value < 0 ? -1 : 1;
  const av = Math.abs(value);
  let decade = Math.floor(Math.log10(av));
  let idx = 0;
  for (let i = 0; i < E12.length; i++) if (E12[i] * Math.pow(10, decade) <= av * 1.0000001) idx = i;
  idx += dir;
  if (idx < 0) {
    idx = E12.length - 1;
    decade--;
  } else if (idx >= E12.length) {
    idx = 0;
    decade++;
  }
  return sign * E12[idx] * Math.pow(10, decade);
}

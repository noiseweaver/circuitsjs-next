// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from CircuitJS1 src/com/lushprojects/circuitjs1/client/PotElm.java (master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032, with ts/PotElm.ts (dev-ts) at
// 7ec858d662d8be1d76d54241ba3a5c1d1c524f51 for the node-voltage model.
// Copyright (C) Paul Falstad and Iain Sharp; port Copyright (C) circuitjs-next contributors.
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 2 of the
// License, or (at your option) any later version. See LICENSE.

import type { Point } from '@circuitjs-next/engine';
import { CircuitElm, elementType } from '../CircuitElm.ts';
import { EditInfo } from '../edit/EditInfo.ts';
import { javaDoubleToInt, parseJavaDouble } from '../java.ts';
import type { StringTokenizer } from '../StringTokenizer.ts';
import type { XmlAttrReader, XmlAttrWriter } from '../xml.ts';

/**
 * Potentiometer. Upstream drives `position` from a 0..100 slider in the side panel, so a loaded
 * position is quantized to that slider in setPoints(); `sliderValue` models the slider here.
 */
export class PotElm extends CircuitElm {
  static readonly FLAG_SHOW_VALUES = 1;
  static readonly FLAG_FLIP = 2;
  static readonly FLAG_FLIP_OFFSET = 4;

  position = 0;
  maxResistance = 0;
  resistance1 = 0;
  resistance2 = 0;
  current1 = 0;
  current2 = 0;
  current3 = 0;
  sliderText = '';
  /** Pots with the same nonzero link share one slider. */
  link = 0;
  sliderValue = 0;
  post3: Point = this.point1;
  /** Offset of the wiper post from the body, from setPoints() (views draw the wiper with it). */
  offset = 0;

  override getClassName(): string {
    return 'PotElm';
  }
  override getDumpType(): number {
    return 174;
  }
  override getXmlDumpType(): string {
    return 'pt';
  }

  override initNew(): void {
    this.maxResistance = 1000;
    this.position = 0.5;
    this.sliderText = 'Resistance';
    this.flags = PotElm.FLAG_SHOW_VALUES;
    this.createSlider();
  }

  override undump(st: StringTokenizer): void {
    this.maxResistance = parseJavaDouble(st.nextToken());
    this.position = parseJavaDouble(st.nextToken());
    this.sliderText = st.nextToken();
    while (st.hasMoreTokens()) this.sliderText += ' ' + st.nextToken();
    this.createSlider();
  }

  override dumpXml(w: XmlAttrWriter): void {
    super.dumpXml(w);
    w.dumpAttr('ma', this.maxResistance);
    w.dumpAttr('po', this.position);
    w.dumpAttr('sl', this.sliderText);
    if (this.link !== 0) w.dumpAttr('li', this.link);
  }

  override undumpXml(r: XmlAttrReader): void {
    super.undumpXml(r);
    this.maxResistance = r.parseDoubleAttr('ma', this.maxResistance);
    this.position = r.parseDoubleAttr('po', this.position);
    this.sliderText = r.parseStringAttr('sl', this.sliderText);
    this.link = r.parseIntAttr('li', 0);
    // Scrollbar.setValue clamps to the slider range
    this.sliderValue = Math.min(Math.max(this.calcSliderValue(), 0), 100);
  }

  calcSliderValue(): number {
    return Math.round((this.position - 0.005) / 0.0099);
  }

  /** A new slider starts at the current position, unclamped (upstream Scrollbar constructor). */
  createSlider(): void {
    this.sliderValue = this.calcSliderValue();
  }

  override getPostCount(): number {
    return 3;
  }

  override getPost(n: number): Point {
    return n === 0 ? this.point1 : n === 1 ? this.point2 : this.post3;
  }

  override setPoints(): void {
    super.setPoints();
    const gridSize = this.sim.gridSize;
    const { dx, dy } = this;
    let offset = 0;
    // point2 snaps to a whole number of double grid steps along the major axis
    if (Math.abs(dx) > Math.abs(dy) !== this.hasFlag(PotElm.FLAG_FLIP)) {
      const myLen =
        2 *
        gridSize *
        Math.sign(dx) *
        Math.trunc((Math.abs(dx) + 2 * gridSize - 1) / (2 * gridSize));
      this.point2.x = this.point1.x + myLen;
      offset = dx < 0 ? dy : -dy;
      this.point2.y = this.point1.y;
    } else {
      const myLen =
        2 *
        gridSize *
        Math.sign(dy) *
        Math.trunc((Math.abs(dy) + 2 * gridSize - 1) / (2 * gridSize));
      if (dy !== 0) {
        this.point2.y = this.point1.y + myLen;
        offset = dy > 0 ? dx : -dx;
        this.point2.x = this.point1.x;
      }
    }
    if (offset === 0) offset = this.hasFlag(PotElm.FLAG_FLIP_OFFSET) ? -gridSize : gridSize;
    const ddx = this.point2.x - this.point1.x;
    const ddy = this.point2.y - this.point1.y;
    this.dn = Math.sqrt(ddx * ddx + ddy * ddy);
    this.position = this.sliderValue * 0.0099 + 0.005;
    this.offset = offset;
    this.post3 = this.interpPointPerp(this.point1, this.point2, 0.5, offset);
  }

  override calculateCurrent(): void {
    if (this.resistance1 === 0) return; // avoid NaN
    this.current1 = (this.nodes[0].v - this.nodes[2].v) / this.resistance1;
    this.current2 = (this.nodes[1].v - this.nodes[2].v) / this.resistance2;
    this.current3 = -this.current1 - this.current2;
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 0) return -this.current1;
    if (n === 1) return -this.current2;
    return -this.current3;
  }

  override stamp(): void {
    this.resistance1 = this.maxResistance * this.position;
    this.resistance2 = this.maxResistance * (1 - this.position);
    this.sim.stampResistor(this.nodes[0], this.nodes[2], this.resistance1);
    this.sim.stampResistor(this.nodes[2], this.nodes[1], this.resistance2);
  }

  /**
   * Upstream detaches the slider and attaches to the slider of another pot in the same group,
   * if any; sliders are UI here, so only the group number changes.
   */
  setLink(newLink: number): void {
    if (newLink === this.link) return;
    this.link = newLink;
    this.createSlider();
  }

  override getElmType(): string {
    return 'potentiometer';
  }

  override getEditInfo(n: number): EditInfo | null {
    // ohmString doesn't work here on linux
    if (n === 0) return new EditInfo('Resistance (ohms)', this.maxResistance, 0, 0);
    if (n === 1) {
      const ei = new EditInfo('Slider Text', 0, -1, -1);
      ei.text = this.sliderText;
      return ei;
    }
    if (n === 2)
      return EditInfo.createCheckbox('Show Values', (this.flags & PotElm.FLAG_SHOW_VALUES) !== 0);
    if (n === 3) return new EditInfo('Group Number (for linking)', this.link, -1, -1);
    return null;
  }

  override setEditValue(n: number, ei: EditInfo): void {
    if (n === 0) this.maxResistance = ei.value;
    // upstream also relabels the slider and resizes the iframe; the slider UI reads sliderText
    if (n === 1) this.sliderText = ei.text ?? '';
    if (n === 2) this.flags = ei.changeFlag(this.flags, PotElm.FLAG_SHOW_VALUES);
    if (n === 3) {
      this.setLink(javaDoubleToInt(ei.value));
      // Scrollbar.setValue clamps to the slider range
      this.sliderValue = Math.min(Math.max(this.calcSliderValue(), 0), 100);
    }
  }

  override flipX(c2: number, count: number): void {
    // this is only needed / only has an effect if point1 and point2 are on same grid line
    this.flags ^= PotElm.FLAG_FLIP_OFFSET;
    super.flipX(c2, count);
  }

  override flipY(c2: number, count: number): void {
    this.flags ^= PotElm.FLAG_FLIP_OFFSET;
    super.flipY(c2, count);
  }

  override flipXY(xmy: number, count: number): void {
    if (Math.abs(this.dx) === Math.abs(this.dy)) this.flags ^= PotElm.FLAG_FLIP;
    this.flags ^= PotElm.FLAG_FLIP_OFFSET;
    super.flipXY(xmy, count);
  }
}

export const PotElmType = elementType('PotElm', PotElm);

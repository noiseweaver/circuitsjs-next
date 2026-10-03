// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
// What is drawn and in which order follows CircuitJS1 UIManager.updateCircuit and
// SimulationManager (post and bad-connection lists) (src/com/lushprojects/circuitjs1/client/,
// master) at 5a707168778216bb6ed01bfdd62e8bbf7ae0a032.

import {
  rectContains,
  unionRect,
  viewFor,
  type CircuitElm,
  type DrawContext,
  type Rect,
} from '@circuitjs-next/elements';
import type { Theme } from '@circuitjs-next/theme';
import { CanvasPainter } from './CanvasPainter.ts';
import { DotCounters } from './dots.ts';
import { Palette } from './palette.ts';
import { Viewport } from './Viewport.ts';

/** Per-frame inputs from the app. */
export interface FrameState {
  running: boolean;
  /** From currentMultiplier(): how far dots move per ampere this frame. */
  currentMult: number;
  /** Circuit options. */
  showDots: boolean;
  voltageColors: boolean;
  showValues: boolean;
  voltageRange: number;
  /** User settings. */
  euroResistors: boolean;
  showOhm: boolean;
  /** Grid spacing in circuit units (16, or 8 with the small grid option). */
  gridSize: number;
}

export const DEFAULT_FRAME: FrameState = {
  running: true,
  currentMult: 0,
  showDots: true,
  voltageColors: true,
  showValues: true,
  voltageRange: 5,
  euroResistors: false,
  showOhm: false,
  gridSize: 16,
};

interface PostInfo {
  /** Posts drawn as dots: those not joining exactly two element ends. */
  draw: { x: number; y: number }[];
  /** Unconnected posts lying inside another element's box. */
  bad: { x: number; y: number }[];
}

/**
 * Draws a circuit on a canvas: grid, elements through their views, posts, bad connections. Owns
 * the viewport (pan, zoom, HiDPI) and hit testing.
 */
export class CircuitRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly viewport = new Viewport();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly painter: CanvasPainter;
  private palette: Palette;
  private readonly dots = new DotCounters();
  private elements: CircuitElm[] = [];
  private posts: PostInfo = { draw: [], bad: [] };
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  /** Element under the mouse. */
  hovered: CircuitElm | null = null;
  /** Element that stopped the simulation; drawn highlighted and on top. */
  stopElm: CircuitElm | null = null;
  /** Element being placed (not in the circuit yet); drawn on top with all its posts. */
  pending: CircuitElm | null = null;
  /** Rubber band selection in circuit coordinates. */
  selectionRect: Rect | null = null;

  constructor(canvas: HTMLCanvasElement, theme: Theme) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D canvas not available');
    this.canvas = canvas;
    this.ctx = ctx;
    this.palette = new Palette(theme);
    this.painter = new CanvasPainter(ctx, this.palette);
  }

  get theme(): Theme {
    return this.palette.theme;
  }

  setTheme(theme: Theme): void {
    this.palette = new Palette(theme);
    this.painter.palette = this.palette;
  }

  /** Show a new circuit; dot positions restart. */
  setElements(elements: CircuitElm[]): void {
    this.elements = elements;
    this.dots.clear();
    this.hovered = null;
    this.stopElm = null;
    this.posts = this.findPosts();
  }

  /** The circuit was edited (elements added, removed or moved); dot positions are kept. */
  elementsChanged(elements: CircuitElm[]): void {
    this.elements = elements;
    if (this.hovered !== null && !elements.includes(this.hovered)) this.hovered = null;
    this.posts = this.findPosts();
  }

  /** Recompute post lists after elements moved or changed shape. */
  refreshPosts(): void {
    this.posts = this.findPosts();
  }

  /** Number of bad connections (shown in the status bar, as upstream's info area does). */
  get badConnectionCount(): number {
    return this.posts.bad.length;
  }

  /** Canvas size in CSS pixels and the device pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** Bounds of the circuit in circuit units (upstream `getCircuitBounds`), null when empty. */
  circuitBounds(): Rect | null {
    let r: Rect | null = null;
    for (const e of this.elements) {
      const pts: Rect = {
        x1: Math.min(e.x, e.x2),
        y1: Math.min(e.y, e.y2),
        x2: Math.max(e.x, e.x2),
        y2: Math.max(e.y, e.y2),
      };
      const v = viewFor(e);
      const box = v ? unionRect(pts, v.bbox(e)) : pts;
      r = r === null ? box : unionRect(r, box);
    }
    return r;
  }

  /** Centre the circuit in the canvas. */
  fit(): void {
    this.viewport.fit(this.circuitBounds(), this.cssWidth, this.cssHeight);
  }

  /** The element at a point in CSS pixels relative to the canvas, smallest box first. */
  elementAt(sx: number, sy: number): CircuitElm | null {
    const { x, y } = this.viewport.toCircuit(sx, sy);
    let best: CircuitElm | null = null;
    let bestArea = Infinity;
    for (const e of this.elements) {
      const v = viewFor(e);
      if (!v) continue;
      const b = v.bbox(e);
      const pad = 2;
      if (!rectContains({ x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad }, x, y))
        continue;
      const area = (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1);
      if (area < bestArea) {
        best = e;
        bestArea = area;
      }
    }
    return best;
  }

  render(frame: FrameState): void {
    const c = this.ctx;
    const theme = this.palette.theme;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = theme.canvas.background;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const vp = this.viewport;
    const s = vp.scale * this.dpr;
    c.setTransform(s, 0, 0, s, vp.offsetX * this.dpr, vp.offsetY * this.dpr);
    c.lineCap = 'round';
    c.lineJoin = 'miter';

    this.drawGrid(frame.gridSize);

    const painter = this.painter;
    painter.settings = {
      voltageColors: frame.voltageColors,
      voltageRange: frame.voltageRange,
      dots: frame.showDots && frame.running,
    };

    for (const e of this.elements) if (e !== this.stopElm) this.drawElement(e, frame);
    if (this.stopElm !== null) this.drawElement(this.stopElm, frame);

    painter.highlighted = false;
    for (const p of this.posts.draw) this.drawPost(p.x, p.y, 'post');
    for (const p of this.posts.bad) this.drawPost(p.x, p.y, 'badConnection');

    if (this.pending !== null) this.drawElement(this.pending, frame);
    if (this.selectionRect !== null) this.drawSelectionRect(this.selectionRect);
  }

  private drawSelectionRect(r: Rect): void {
    const c = this.ctx;
    c.save();
    c.strokeStyle = this.palette.selection;
    c.fillStyle = this.palette.selection;
    c.lineWidth = 1 / this.viewport.scale;
    c.setLineDash([4 / this.viewport.scale, 3 / this.viewport.scale]);
    c.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    c.globalAlpha = 0.08;
    c.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    c.restore();
  }

  private drawElement(e: CircuitElm, frame: FrameState): void {
    const view = viewFor(e);
    if (!view) return;
    const painter = this.painter;
    const highlighted =
      e === this.hovered || e === this.stopElm || e.selected || e === this.pending;
    painter.highlighted = highlighted;
    painter.highlightColor =
      e === this.stopElm || e.selected || e === this.pending
        ? this.palette.selection
        : this.palette.hover;
    const dots = this.dots;
    const ctx: DrawContext = {
      painter,
      highlighted,
      showValues: frame.showValues,
      euroResistors: frame.euroResistors,
      showOhm: frame.showOhm,
      dotCount: (slot, current) => dots.advance(e, slot, current, frame.currentMult, frame.running),
    };
    this.ctx.save();
    view.draw(e, ctx);
    this.ctx.restore();
    if (highlighted) {
      // a highlighted element shows all its posts (upstream drawPosts)
      painter.highlighted = false;
      for (let i = 0; i !== e.getPostCount(); i++) {
        const p = e.getPost(i);
        this.drawPost(p.x, p.y, 'post');
      }
    }
  }

  private drawPost(x: number, y: number, role: 'post' | 'badConnection'): void {
    // upstream fillOval(x-3, y-3, 7, 7)
    this.painter.fillCircle({ x: x + 0.5, y: y + 0.5 }, 3.5, { role });
  }

  private drawGrid(gridSize: number): void {
    const theme = this.palette.theme;
    if (theme.style.grid === 'none' || this.cssWidth === 0) return;
    const vp = this.viewport;
    const step = gridSize * (vp.scale < 0.5 ? 4 : 1);
    const tl = vp.toCircuit(0, 0);
    const br = vp.toCircuit(this.cssWidth, this.cssHeight);
    const x0 = Math.floor(tl.x / step) * step;
    const y0 = Math.floor(tl.y / step) * step;
    const c = this.ctx;
    const major = step * 8;
    const isMajor = (v: number): boolean => Math.abs(v % major) < 1e-9;
    if (theme.style.grid === 'lines') {
      c.lineWidth = 1 / vp.scale;
      for (const majorPass of [false, true]) {
        c.strokeStyle = majorPass ? theme.canvas.gridMajor : theme.canvas.grid;
        c.beginPath();
        for (let x = x0; x <= br.x; x += step) {
          if (isMajor(x) !== majorPass) continue;
          c.moveTo(x, tl.y);
          c.lineTo(x, br.y);
        }
        for (let y = y0; y <= br.y; y += step) {
          if (isMajor(y) !== majorPass) continue;
          c.moveTo(tl.x, y);
          c.lineTo(br.x, y);
        }
        c.stroke();
      }
    } else {
      const r = 1 / vp.scale;
      for (let x = x0; x <= br.x; x += step) {
        for (let y = y0; y <= br.y; y += step) {
          c.fillStyle = isMajor(x) && isMajor(y) ? theme.canvas.gridMajor : theme.canvas.grid;
          c.fillRect(x - r, y - r, 2 * r, 2 * r);
        }
      }
    }
  }

  /** Upstream's postDrawList and badConnectionList. */
  private findPosts(): PostInfo {
    const count = new Map<string, { x: number; y: number; n: number }>();
    for (const e of this.elements) {
      for (let j = 0; j !== e.getPostCount(); j++) {
        const p = e.getPost(j);
        const k = `${p.x},${p.y}`;
        const entry = count.get(k);
        if (entry) entry.n++;
        else count.set(k, { x: p.x, y: p.y, n: 1 });
      }
    }
    const info: PostInfo = { draw: [], bad: [] };
    const boxes = this.elements.map((e) => ({ e, box: viewFor(e)?.bbox(e) ?? null }));
    for (const p of count.values()) {
      if (p.n !== 2) info.draw.push({ x: p.x, y: p.y });
      if (p.n !== 1) continue;
      let bad = false;
      for (const { e, box } of boxes) {
        if (box === null || !rectContains(box, p.x, p.y)) continue;
        let own = false;
        for (let k = 0; k !== e.getPostCount() && !own; k++) {
          const q = e.getPost(k);
          own = q.x === p.x && q.y === p.y;
        }
        if (!own) {
          bad = true;
          break;
        }
      }
      if (bad) info.bad.push({ x: p.x, y: p.y });
    }
    return info;
  }
}

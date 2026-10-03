// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors

import { viewFor, type CircuitElm, type DrawContext } from '@circuitjs-next/elements';
import type { Theme } from '@circuitjs-next/theme';
import { CanvasPainter } from './CanvasPainter.ts';
import { Palette } from './palette.ts';

/**
 * Draw one element, centred and scaled to fit a small canvas (palette icons). No values, voltage
 * colors or current; the background stays transparent so the icon sits on any surface.
 */
export function drawPreview(
  canvas: HTMLCanvasElement,
  e: CircuitElm,
  theme: Theme,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  const ctx = canvas.getContext('2d');
  const view = viewFor(e);
  if (ctx === null || view === null) return;
  // never analyzed: give it unconnected nodes at 0 V so views can read voltages
  if (e.nodes.length === 0) e.allocNodes();
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const b = view.bbox(e);
  const bw = Math.max(b.x2 - b.x1, 1);
  const bh = Math.max(b.y2 - b.y1, 1);
  const pad = 4;
  const scale = Math.min((cssWidth - 2 * pad) / bw, (cssHeight - 2 * pad) / bh, 0.75);
  const ox = (cssWidth - bw * scale) / 2 - b.x1 * scale;
  const oy = (cssHeight - bh * scale) / 2 - b.y1 * scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  ctx.lineCap = 'round';
  const painter = new CanvasPainter(ctx, new Palette(theme));
  painter.settings = { voltageColors: false, voltageRange: 5, dots: false };
  const dc: DrawContext = {
    painter,
    highlighted: false,
    showValues: false,
    euroResistors: false,
    showOhm: false,
    dotCount: () => 0,
  };
  view.draw(e, dc);
}

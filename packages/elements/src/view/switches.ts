// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
// Geometry learned from CircuitJS1 SwitchElm (src/com/lushprojects/circuitjs1/client/, master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032; the drawing code is new.

import { SwitchElm } from '../elm/SwitchElm.ts';
import {
  COMPONENT,
  doDots,
  draw2Leads,
  elementBox,
  UNITS_FONT,
  type ElementView,
} from './common.ts';
import { calcLeads, interp, pt, rectOf, type Rect } from './geometry.ts';

const OPEN_HS = 16;

/** Toggle and push switches: a blade that lifts OPEN_HS off the line when open. */
export const switchView: ElementView<SwitchElm> = {
  draw(e, ctx) {
    const p = ctx.painter;
    const [lead1, lead2] = calcLeads(e.point1, e.point2, e.dn, 32);
    const open = e.position === 1;
    draw2Leads(e, ctx, lead1, lead2);
    if (e.position === 0) doDots(e, ctx);
    p.line(
      interp(lead1, lead2, 0, open ? 0 : 2),
      interp(lead1, lead2, 1, open ? OPEN_HS : 2),
      COMPONENT,
    );

    if (e.label !== null) {
      if (Math.abs(e.dy) > Math.abs(e.dx)) {
        p.text(e.label, pt(e.x + 10, (e.y < e.y2 ? lead1 : lead2).y - 5), COMPONENT, UNITS_FONT);
      } else {
        const ty = e.x2 > e.x ? e.y + 15 : e.y - 15;
        p.text(e.label, pt(Math.trunc((e.x + e.x2) / 2), ty), COMPONENT, {
          ...UNITS_FONT,
          align: 'center',
        });
      }
    }

    if (e.hasFlag(SwitchElm.FLAG_IEC)) {
      // IEC actuator: dashed plunger, plus a detent for latching switches
      const thin = { width: 1 };
      const x0 = interp(lead1, lead2, 0.5, open ? OPEN_HS / 2 : 2);
      const x1 = interp(lead1, lead2, 0.5, 24);
      const x2 = interp(lead1, lead2, 0.5 - 0.1, 24);
      const x3 = interp(lead1, lead2, 0.5 + 0.1, 24);
      const x4 = interp(lead1, lead2, 0.5, 19);
      const x5 = interp(lead1, lead2, 0.5 - 0.1, 16);
      const x6 = interp(lead1, lead2, 0.5, 13);
      p.line(x2, x3, COMPONENT, thin);
      const dashed = { width: 1, dash: [3, 3] };
      if (e.momentary) p.line(x1, x0, COMPONENT, dashed);
      else {
        p.line(x6, x0, COMPONENT, dashed);
        p.line(x1, x4, COMPONENT, dashed);
        p.line(x4, x5, COMPONENT, thin);
        p.line(x6, x5, COMPONENT, thin);
      }
    }
  },
  bbox: (e) => elementBox(e, OPEN_HS),
};

/** Where a click toggles the switch rather than grabbing it (upstream `getSwitchRect`). */
export function switchRect(e: SwitchElm): Rect {
  const [lead1, lead2] = calcLeads(e.point1, e.point2, e.dn, 32);
  return rectOf([lead1, lead2, interp(lead1, lead2, 0, OPEN_HS)]);
}

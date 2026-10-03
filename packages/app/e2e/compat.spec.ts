// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
//
// Phase 5 acceptance: a circuit built here opens in upstream CircuitJS1, and one built in upstream
// opens here. Upstream is the reference build in .reference-site (pnpm reference:build); the
// tests skip when it is missing.

/// <reference types="node" />

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { compressCircuit } from '@circuitjs-next/format';

const SITE = resolve(import.meta.dirname, '../../../.reference-site');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

let server: Server | null = null;
let upstream = '';

test.skip(!existsSync(join(SITE, 'circuitjs.html')), 'no reference build (pnpm reference:build)');

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = normalize(
      join(SITE, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)),
    );
    if (!path.startsWith(SITE + sep) || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  await new Promise<void>((ok) => server?.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  upstream = `http://127.0.0.1:${port}/circuitjs.html`;
});

test.afterAll(() => {
  server?.close();
});

interface UpstreamApi {
  exportCircuit(): string;
  importCircuit(text: string, subcircuitsOnly: boolean): void;
  getElements(): { getType(): string }[];
}
declare global {
  interface Window {
    CircuitJS1?: UpstreamApi;
  }
}

/** Open upstream, optionally with a query, and wait for its JS interface. */
const openUpstream = async (page: Page, query = ''): Promise<void> => {
  await page.goto(upstream + query);
  await page.waitForFunction(() => window.CircuitJS1 !== undefined, null, { timeout: 30_000 });
};
const upstreamExport = (page: Page): Promise<string> =>
  page.evaluate(() => window.CircuitJS1?.exportCircuit() ?? '');
const upstreamTypes = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window.CircuitJS1?.getElements() ?? []).map((e) => e.getType()));

const openHere = async (page: Page, query: string): Promise<void> => {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window.circuitjsNext?.controller.frames ?? 0) > 2);
};
const saveHere = async (page: Page): Promise<string> =>
  (await page.evaluate(() => window.circuitjsNext?.controller.saveText())) ?? '';

/** Page coordinates of a circuit point in this app. */
const at = async (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => {
  const box = await page.getByTestId('circuit-canvas').boundingBox();
  const p = await page.evaluate(
    ([x, y]) => window.circuitjsNext?.controller.toScreen(x, y) ?? null,
    [x, y] as const,
  );
  if (!box || !p) throw new Error('no canvas');
  return { x: box.x + p.x, y: box.y + p.y };
};
const dragHere = async (page: Page, from: [number, number], to: [number, number]) => {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
};

test('a circuit built here opens in upstream', async ({ page }) => {
  await openHere(page, `?ctz=${compressCircuit('$ 1 5.0E-6 10 50 5.0\n')}`);
  const canvas = page.getByTestId('circuit-canvas');
  await canvas.focus();
  // a source, a resistor, a capacitor, a diode and wires, placed with the mouse and keys
  await page.keyboard.press('v');
  await dragHere(page, [96, 224], [96, 96]);
  await page.keyboard.press('r');
  await dragHere(page, [96, 96], [224, 96]);
  await page.keyboard.press('c');
  await dragHere(page, [224, 96], [224, 224]);
  await page.keyboard.press('d');
  await dragHere(page, [224, 224], [160, 224]);
  await page.keyboard.press('w');
  await dragHere(page, [160, 224], [96, 224]);
  await page.keyboard.press('Escape');
  // edit the resistor while it runs
  const r = await at(page, 160, 96);
  await page.mouse.dblclick(r.x, r.y);
  await page.getByTestId('field-0').fill('4.7k');
  await page.getByTestId('field-0').press('Enter');

  // stop it so the capacitor's saved voltage is the one upstream starts from
  await page.getByTestId('run-stop').click();
  const saved = await saveHere(page);
  expect(saved).toContain('<r x="96 96 224 96"');
  expect(saved).toContain('4700');

  // the upstream link from Export link, pointed at the local upstream build
  await page.getByTestId('file-menu').click();
  await page.getByTestId('menu-export-link').click();
  const link = await page.getByTestId('link-upstream').inputValue();
  const query = link.slice(link.indexOf('?'));
  await openUpstream(page, `${query}&running=false`);
  expect(await upstreamTypes(page)).toEqual([
    'DCVoltageElm',
    'ResistorElm',
    'CapacitorElm',
    'DiodeElm',
    'WireElm',
  ]);
  // upstream reads every value back: its save is ours, byte for byte
  expect(await upstreamExport(page)).toBe(saved);
});

const GOLDEN = resolve(import.meta.dirname, '../../../tools/golden/circuits');
const golden = (name: string): string => readFileSync(join(GOLDEN, name), 'utf8');

test('a circuit built in upstream opens here', async ({ page }) => {
  // build in upstream: import, then place a resistor with its own shortcut and mouse
  await openUpstream(page, `?ctz=${compressCircuit(golden('labels-probe.txt'))}`);
  const before = await upstreamTypes(page);
  // the circuit canvas is upstream's largest; its sliders are canvases too
  const boxes = await page
    .locator('canvas')
    .evaluateAll((cs) => cs.map((c) => c.getBoundingClientRect().toJSON() as DOMRect));
  const box = boxes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const x = box.x + box.width - 60;
  await page.mouse.move(x, box.y + 100);
  await page.keyboard.press('r');
  await page.mouse.down();
  await page.mouse.move(x, box.y + 250, { steps: 8 });
  await page.mouse.up();
  const types = await upstreamTypes(page);
  expect(types.length).toBe(before.length + 1);
  expect(types.at(-1)).toBe('ResistorElm');
  const exported = await upstreamExport(page);
  expect(exported.startsWith('<cir ')).toBe(true);

  // open upstream's XML save here; saving it again gives the same file
  await openHere(page, `?ctz=${compressCircuit(exported)}`);
  const elements = await page.evaluate(() =>
    (window.circuitjsNext?.controller.circuit.elements ?? []).map((e) => e.getClassName()),
  );
  // upstream names a 'v' it reads VoltageElm; this app names the DC one by its menu class
  expect(elements.map((c) => (c === 'DCVoltageElm' ? 'VoltageElm' : c))).toEqual(types);
  expect(await saveHere(page)).toBe(exported);
});

test('every golden circuit saves the same here as in upstream', async ({ page }) => {
  const names = readdirSync(GOLDEN).filter((n) => n.endsWith('.txt'));
  expect(names.length).toBeGreaterThan(0);
  await openHere(page, '');
  const here: Record<string, string> = {};
  for (const n of names)
    here[n] = await page.evaluate((t) => {
      const c = window.circuitjsNext?.controller;
      c?.load(t, 'x', false, false);
      return c?.saveText() ?? '';
    }, golden(n));
  await openUpstream(page);
  for (const n of names) {
    const there = await page.evaluate((t) => {
      window.CircuitJS1?.importCircuit(t, false);
      return window.CircuitJS1?.exportCircuit() ?? '';
    }, golden(n));
    expect(here[n], n).toBe(there);
    // and upstream reads our save back to the same file
    const again = await page.evaluate((t) => {
      window.CircuitJS1?.importCircuit(t, false);
      return window.CircuitJS1?.exportCircuit() ?? '';
    }, here[n] ?? '');
    expect(again, n).toBe(there);
  }
});

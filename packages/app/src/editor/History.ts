// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 circuitjs-next contributors
// Undo and redo after CircuitJS1 UndoManager (src/com/lushprojects/circuitjs1/client/, master) at
// 5a707168778216bb6ed01bfdd62e8bbf7ae0a032: like upstream, a step restores a saved copy of the
// whole circuit, so every edit, present and future, undoes the same way.

/** One undoable edit. */
export interface Command {
  readonly label: string;
  undo(): void;
  redo(): void;
}

/** Saves and restores the whole circuit (upstream's undo items are circuit dumps). */
export interface Snapshots {
  save(): string;
  restore(snapshot: string): void;
}

/** An edit recorded as the circuit before and after it. */
class SnapshotCommand implements Command {
  constructor(
    readonly label: string,
    private readonly target: Snapshots,
    private readonly before: string,
    private readonly after: string,
  ) {}
  undo(): void {
    this.target.restore(this.before);
  }
  redo(): void {
    this.target.restore(this.after);
  }
}

/** Upstream keeps every step; cap it so a long session can't grow without bound. */
const MAX_STEPS = 200;

/**
 * Undo and redo stacks. An edit is bracketed by `begin(label)` and `commit()`; only edits that
 * changed something (`touch()` was called) are recorded.
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private pending: { label: string; before: string; touched: boolean } | null = null;
  /** Called when canUndo or canRedo may have changed. */
  onChange: () => void = () => {};

  constructor(private readonly target: Snapshots) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Start an edit, saving the circuit as it is now. A pending edit is committed first. */
  begin(label: string): void {
    this.commit();
    this.pending = { label, before: this.target.save(), touched: false };
  }

  /** Mark the pending edit as having changed the circuit. */
  touch(): void {
    if (this.pending) this.pending.touched = true;
  }

  get inEdit(): boolean {
    return this.pending !== null;
  }

  /** Finish the pending edit; it is recorded if it changed anything. */
  commit(): void {
    const p = this.pending;
    this.pending = null;
    if (!p || !p.touched) return;
    this.push(new SnapshotCommand(p.label, this.target, p.before, this.target.save()));
  }

  /** Drop the pending edit without recording it. */
  cancel(): void {
    this.pending = null;
  }

  /** Run `fn` as one edit; it returns false when it changed nothing. */
  record(label: string, fn: () => unknown): void {
    this.begin(label);
    if (fn() !== false) this.touch();
    this.commit();
  }

  private push(c: Command): void {
    this.undoStack.push(c);
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }

  undo(): void {
    this.commit();
    const c = this.undoStack.pop();
    if (!c) return;
    c.undo();
    this.redoStack.push(c);
    this.onChange();
  }

  redo(): void {
    this.commit();
    const c = this.redoStack.pop();
    if (!c) return;
    c.redo();
    this.undoStack.push(c);
    this.onChange();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.onChange();
  }
}

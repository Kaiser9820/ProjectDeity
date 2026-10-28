import type { GravitySimulation, SimulationSnapshot } from '../simulation/GravitySimulation';

export interface UndoEntry {
  label: string;
  before: SimulationSnapshot;
  after: SimulationSnapshot;
}

export interface HistoryStep {
  label: string;
  /** Simulated days the universe jumped by (negative = rewound). */
  timeShiftDays: number;
}

export const UNDO_LIMIT = 50;

/**
 * The one undo/redo history, shared by console commands, toolbar buttons, the gizmo and the
 * inspector. Each entry stores the complete physical state before and after the change (bodies,
 * masses, radii, positions, velocities, frozen flags, simulated time), so restoring is exact,
 * including after destructive commands.
 *
 * Undo returns the universe to the moment before the change, so time spent since then is rewound.
 * The time shift is reported, never silent.
 */
export class UndoHistory {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<() => void>();
  /** Bumped on every change; lets UI subscribe cheaply. */
  version = 0;

  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  record(label: string, before: SimulationSnapshot, after: SimulationSnapshot) {
    this.undoStack.push({ label, before, after });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
  }

  undo(sim: GravitySimulation): HistoryStep | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    const t0 = sim.time;
    sim.restore(e.before);
    this.redoStack.push(e);
    this.changed();
    return { label: e.label, timeShiftDays: sim.time - t0 };
  }

  redo(sim: GravitySimulation): HistoryStep | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    const t0 = sim.time;
    sim.restore(e.after);
    this.undoStack.push(e);
    this.changed();
    return { label: e.label, timeShiftDays: sim.time - t0 };
  }

  /** Replace the whole history (import). */
  replace(undo: UndoEntry[], redo: UndoEntry[]) {
    this.undoStack = undo.slice(-UNDO_LIMIT);
    this.redoStack = redo.slice(-UNDO_LIMIT);
    this.changed();
  }

  get undoEntries(): readonly UndoEntry[] { return this.undoStack; }
  get redoEntries(): readonly UndoEntry[] { return this.redoStack; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  peekUndo() { return this.undoStack.at(-1)?.label ?? null; }
  peekRedo() { return this.redoStack.at(-1)?.label ?? null; }
}

import type { TerminalLineKind, Vec3 } from '../types';
import type { GravitySimulation } from '../simulation/GravitySimulation';
import type { UndoHistory } from './history';

/**
 * Everything a command may touch. Physics goes through `sim` (the single source of truth);
 * selection, camera and display settings go through `ui`, which the app wires to the same state
 * as the on-screen controls.
 */
export interface ConsoleContext {
  creatorName: string;
  sim: GravitySimulation;
  history: UndoHistory;
  ui: ConsoleUi;
}

export interface ConsoleUi {
  readonly selectedId: string | null;
  select(id: string | null): void;
  /** Fly the camera to a body and follow it (selection unchanged). */
  focus(id: string): void;
  /** Stop following any body; the camera stays where it is. */
  freeCamera(): void;
  overview(): void;
  readonly orbits: boolean;
  setOrbits(on: boolean): void;
  readonly labels: boolean;
  setLabels(on: boolean): void;
  readonly bodyScale: string;
  setBodyScale(id: string): void;
  /** Simulated days per real second; updates the toolbar too. */
  setRate(daysPerSecond: number): void;
  /**
   * Visual-only effect at a physical position (au). When `debrisIds` is given and the camera was
   * following `sourceId`, it follows the debris' centre of mass instead.
   */
  effect(kind: 'explosion' | 'supernova', atAu: Vec3, sizeKm: number, color: string, sourceId?: string, debrisIds?: string[]): void;
}

export type Category = 'basics' | 'bodies' | 'time' | 'view' | 'god';

export const CATEGORY_TITLES: Record<Category, string> = {
  basics: 'Basics',
  bodies: 'Bodies',
  time: 'Time & simulation',
  view: 'Camera & view',
  god: 'God mode (nonphysical by design)',
};

export interface OutLine {
  kind: TerminalLineKind;
  text: string;
}

export interface CommandOutput {
  lines: OutLine[];
  clear?: boolean;
  /** True if the command changed physical state (used to record undo). */
  changed?: boolean;
}

export interface CommandSpec {
  name: string;
  aliases?: string[];
  category: Category;
  summary: string;
  usage: string[];
  examples: string[];
  details?: string[];
  /** Physical changes made by this command can be undone. */
  undoable?: boolean;
  run(args: string[], ctx: ConsoleContext): CommandOutput;
  /** Candidates for the last (partially typed) argument. */
  complete?(args: string[], ctx: ConsoleContext): string[];
}

/** A user-facing failure: shown as an error, never as success. */
export class CommandError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

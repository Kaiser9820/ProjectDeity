import { SOLAR_SYSTEM } from '../src/data/solarSystem';
import { GravitySimulation } from '../src/simulation/GravitySimulation';
import { executeCommand } from '../src/terminal/commands';
import { UndoHistory } from '../src/terminal/history';
import type { ConsoleContext, ConsoleUi } from '../src/terminal/types';

/** A console context with a recording fake UI, wired to a real simulation. */
export function makeConsole(name = 'ada') {
  const sim = new GravitySimulation(SOLAR_SYSTEM, 7);
  const calls: string[] = [];
  const effects: { kind: string; sizeKm: number }[] = [];
  const state = { selectedId: null as string | null, orbits: true, labels: true, bodyScale: 'x1000', focus: 'sun' as string | null, rate: 7 };
  const ui: ConsoleUi = {
    get selectedId() { return state.selectedId; },
    select: (id) => { state.selectedId = id; calls.push(`select:${id}`); },
    focus: (id) => { state.focus = id; calls.push(`focus:${id}`); },
    freeCamera: () => { state.focus = null; calls.push('free'); },
    overview: () => { state.focus = 'sun'; calls.push('overview'); },
    get orbits() { return state.orbits; },
    setOrbits: (on) => { state.orbits = on; },
    get labels() { return state.labels; },
    setLabels: (on) => { state.labels = on; },
    get bodyScale() { return state.bodyScale; },
    setBodyScale: (id) => { state.bodyScale = id; },
    setRate: (r) => { state.rate = r; sim.rate = r; },
    effect: (kind, _at, sizeKm) => { effects.push({ kind, sizeKm }); },
  };
  const ctx: ConsoleContext = { creatorName: name, sim, history: new UndoHistory(), ui };
  const run = (raw: string) => {
    const out = executeCommand(raw, ctx);
    return { out, text: out?.lines.map((l) => l.text).join('\n') ?? '', kinds: out?.lines.map((l) => l.kind) ?? [] };
  };
  return { sim, ctx, ui, state, calls, effects, run };
}

import { describe, expect, it } from 'vitest';
import { SOLAR_SYSTEM } from '../src/data/solarSystem';
import { GravitySimulation } from '../src/simulation/GravitySimulation';
import {
  buildUniverseFile, exportFilename, MAX_FILE_BYTES, parseUniverse, SaveError, serializeUniverse, SAVE_VERSION, type ExportInput,
} from '../src/persistence/saveFormat';
import { executeCommand } from '../src/terminal/commands';
import type { TerminalLine } from '../src/types';
import { makeConsole } from './helpers';

/** JSON has no −0; compare states the way they are stored (every other bit is exact). */
const norm = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function exportOf(c: ReturnType<typeof makeConsole>, extra: Partial<ExportInput> = {}): string {
  const transcript: TerminalLine[] = [
    { id: 1, kind: 'input', text: 'explode Mars', prompt: 'ada@solarsystem ~$', at: Date.UTC(2026, 9, 28, 12) },
    { id: 2, kind: 'success', text: 'Mars is gone.', at: Date.UTC(2026, 9, 28, 12, 0, 1) },
  ];
  return serializeUniverse({
    creatorName: 'ada', snapshot: c.sim.snapshot(), paused: c.sim.paused, rate: c.sim.rate,
    commands: ['explode Mars', 'freeze Jupiter'], transcript,
    undo: c.ctx.history.undoEntries, redo: c.ctx.history.redoEntries,
    now: new Date(Date.UTC(2026, 9, 28, 14, 5)), ...extra,
  });
}

/** A universe with every kind of dynamic state. */
function busyUniverse() {
  const c = makeConsole();
  c.run('sim step 40 d');
  c.run('explode Mars --force 2');
  c.run('blackhole spawn 8 Msun --at 0 0 30 au --vel 1 0 0 km/s');
  c.run('freeze Jupiter');
  c.run('body set Earth mass 2 Mearth');
  c.run('launch Venus 3 km/s');
  c.run('undo'); // one entry on the redo stack too
  c.sim.paused = true;
  c.run('sim speed 3 d/s');
  return c;
}

describe('export → import round trip', () => {
  it('restores the exact physical state, time, speed and pause state', () => {
    const c = busyUniverse();
    const json = exportOf(c);
    expect(() => JSON.parse(json)).not.toThrow();
    const loaded = parseUniverse(json);
    expect(norm(loaded.snapshot)).toEqual(norm(c.sim.snapshot())); // derived GM/radius match bit-for-bit
    expect(loaded.paused).toBe(true);
    expect(loaded.rate).toBe(3);

    const target = new GravitySimulation(SOLAR_SYSTEM);
    target.restore(loaded.snapshot);
    expect(norm(target.snapshot())).toEqual(norm(c.sim.snapshot()));
    expect(target.time).toBeCloseTo(40, 9);
    expect(target.bodies.filter((b) => b.kind === 'fragment')).toHaveLength(8);
    expect(target.def('blackhole-1')!.physical.massKg).toBeCloseTo(8 * 1.98841e30, -24);
    expect(target.isFrozen('jupiter')).toBe(true);
    expect(target.def('earth')!.physical.massKg).toBeCloseTo(2 * 5.97219e24, -18);
    // and it evolves identically afterwards
    c.sim.stepFixed(500);
    target.stepFixed(500);
    expect(norm(target.snapshot())).toEqual(norm(c.sim.snapshot()));
  });

  it('preserves creator metadata, command list and timestamped transcript', () => {
    const c = busyUniverse();
    const file = JSON.parse(exportOf(c));
    expect(file).toMatchObject({ format: 'project-deity-universe', version: SAVE_VERSION, creator: { name: 'ada' }, exportedAt: '2026-10-28T14:05:00.000Z' });
    const loaded = parseUniverse(JSON.stringify(file));
    expect(loaded.creatorName).toBe('ada');
    expect(loaded.commands).toEqual(['explode Mars', 'freeze Jupiter']);
    expect(loaded.transcript.map((l) => [l.kind, l.text, l.at])).toEqual([
      ['input', 'explode Mars', Date.UTC(2026, 9, 28, 12)],
      ['success', 'Mars is gone.', Date.UTC(2026, 9, 28, 12, 0, 1)],
    ]);
  });

  it('round-trips undo/redo history so it stays usable after import', () => {
    const c = busyUniverse();
    const loaded = parseUniverse(exportOf(c));
    expect(loaded.undo.map((e) => e.label)).toEqual(c.ctx.history.undoEntries.map((e) => e.label));
    expect(loaded.redo.map((e) => e.label)).toEqual(['launch Venus 3 km/s']);
    const d = makeConsole();
    d.sim.restore(loaded.snapshot);
    d.ctx.history.replace(loaded.undo, loaded.redo);
    expect(executeCommand('redo', d.ctx)!.lines[0].text).toBe('Redid: launch Venus 3 km/s');
    executeCommand('undo', d.ctx);
    executeCommand('undo', d.ctx); // body set Earth mass
    expect(d.sim.def('earth')!.physical.massKg).toBe(5.97219e24);
  });

  it('import replaces history: undo cannot reach the unrelated pre-import universe', () => {
    const c = makeConsole();
    c.run('explode Earth');
    const fresh = makeConsole();
    const loaded = parseUniverse(exportOf(fresh));
    c.sim.restore(loaded.snapshot);
    c.ctx.history.replace(loaded.undo, loaded.redo);
    expect(c.run('undo').text).toMatch(/Nothing to undo/);
    expect(c.sim.has('earth')).toBe(true);
  });

  it('makes filesystem-safe filenames', () => {
    const at = new Date(2026, 9, 28, 15, 42);
    expect(exportFilename('Ada.Love_lace', at)).toBe('deity-ada-love-lace-2026-10-28-1542.json');
    expect(exportFilename('...', at)).toBe('deity-universe-2026-10-28-1542.json');
  });
});

describe('import validation', () => {
  const good = () => JSON.parse(exportOf(makeConsole()));
  const reject = (mutate: (f: any) => unknown, re: RegExp) => {
    const f = good();
    mutate(f);
    expect(() => parseUniverse(typeof f === 'string' ? f : JSON.stringify(f))).toThrow(re);
  };

  it('rejects malformed or foreign files', () => {
    expect(() => parseUniverse('{not json')).toThrow(/not valid JSON/);
    expect(() => parseUniverse('[]')).toThrow(SaveError);
    expect(() => parseUniverse(JSON.stringify({ format: 'something-else', version: 1 }))).toThrow(/not a Project Deity/);
    expect(() => parseUniverse(' '.repeat(MAX_FILE_BYTES + 1))).toThrow(/too large/);
  });

  it('rejects unsupported versions and missing fields', () => {
    reject((f) => (f.version = 99), /v99/);
    reject((f) => delete f.universe, /universe must be an object/);
    reject((f) => delete f.universe.bodies[3].velocity, /velocity must be a list/);
    reject((f) => delete f.universe.bodies[0].physical.massKg, /massKg must be a finite number/);
    reject((f) => delete f.console, /console must be an object/);
  });

  it('rejects non-finite or out-of-range physics', () => {
    const s = exportOf(makeConsole()).replace('"timeDays": 0', '"timeDays": 1e999');
    expect(() => parseUniverse(s)).toThrow(/timeDays must be a finite number/);
    reject((f) => (f.universe.bodies[1].physical.massKg = -5), /must be positive/);
    reject((f) => (f.universe.bodies[2].position = [1, 'x', 0]), /position\[1\]/);
    reject((f) => (f.universe.bodies[2].velocity = [0, 1e9, 0]), /out of range/);
    reject((f) => (f.universe.rateDaysPerSecond = 1e9), /out of range/);
  });

  it('rejects duplicate ids, unknown kinds, foreign textures and overlaps', () => {
    reject((f) => (f.universe.bodies[2].id = f.universe.bodies[1].id), /duplicate body id/);
    reject((f) => (f.universe.bodies[2].kind = 'dragon'), /not a supported body type/);
    reject((f) => (f.universe.bodies[2].texture = 'https://evil.example/x.png'), /not a bundled texture/);
    reject((f) => (f.universe.bodies[3].position = f.universe.bodies[0].position), /overlap/);
  });

  it('rejects unreasonable payloads', () => {
    reject((f) => (f.universe.bodies = Array.from({ length: 500 }, () => f.universe.bodies[1])), /too many entries/);
    reject((f) => (f.console.transcript = Array.from({ length: 5000 }, () => ({ kind: 'output', text: 'x', at: '2026-01-01T00:00:00Z' }))), /too many/);
    reject((f) => (f.creator.name = 'bad name with spaces'), /creator\.name/);
  });

  it('a failed import leaves the current universe untouched', () => {
    const c = busyUniverse();
    const before = c.sim.snapshot();
    const undoBefore = c.ctx.history.undoEntries.length;
    const bad = JSON.parse(exportOf(makeConsole()));
    bad.universe.bodies[4].velocity[0] = 'NaN';
    expect(() => parseUniverse(JSON.stringify(bad))).toThrow(SaveError);
    expect(c.sim.snapshot()).toEqual(before);
    expect(c.ctx.history.undoEntries.length).toBe(undoBefore);
  });

  it('exports nothing transient: no GPU or renderer data, only documented keys', () => {
    const f = buildUniverseFile({ creatorName: 'ada', snapshot: makeConsole().sim.snapshot(), paused: false, rate: 7, commands: [], transcript: [], undo: [], redo: [] });
    expect(Object.keys(f).sort()).toEqual(['app', 'console', 'creator', 'exportedAt', 'format', 'undo', 'universe', 'version']);
    expect(Object.keys(f.universe.bodies[0]).sort()).toEqual(['color', 'dynamics', 'frozen', 'id', 'kind', 'name', 'physical', 'position', 'texture', 'velocity']);
  });
});

describe('undo history semantics', () => {
  it('undo and redo report time shifts instead of rewinding silently', () => {
    const c = makeConsole();
    c.run('explode Mars');
    c.sim.stepFixed(16 * 10);
    const r = c.run('undo');
    expect(r.text).toMatch(/time rewound 10\.0 d/);
    expect(c.sim.time).toBe(0);
    expect(c.run('redo').text).toMatch(/Redid: explode Mars/);
  });

  it('records arbitrary edits (gizmo/inspector path) in the same history', () => {
    const c = makeConsole();
    const before = c.sim.snapshot();
    c.sim.setBodyPosition('mars', [2, 0, 0]);
    c.ctx.history.record('move Mars (gizmo)', before, c.sim.snapshot());
    expect(c.run('undo').text).toMatch(/Undid: move Mars \(gizmo\)/);
    expect(c.sim.getState('mars')!.position).toEqual(before.r.slice(12, 15));
  });
});

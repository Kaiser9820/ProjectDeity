import { describe, expect, it } from 'vitest';
import { AU_KM, DAY_S } from '../src/physics/units';
import { STEP_DAYS } from '../src/simulation/GravitySimulation';
import { MSUN_KG } from '../src/simulation/godMode';
import { makeConsole } from './helpers';

const KMS = DAY_S / AU_KM; // km/s → au/d
const ME = 5.97219e24;

describe('body commands change the real simulation', () => {
  it('lists and inspects bodies with explicit units', () => {
    const c = makeConsole();
    const list = c.run('bodies').text;
    expect(list).toMatch(/9 bodies/);
    for (const n of ['Sun', 'Mercury', 'Neptune']) expect(list).toContain(n);
    c.state.selectedId = 'earth';
    const info = c.run('planet info earth').text;
    expect(info).toMatch(/Earth · terrestrial · selected/);
    expect(info).toMatch(/mass .* kg/);
    expect(info).toMatch(/position .* au/);
    expect(info).toMatch(/velocity .* km\/s/);
    expect(info).toMatch(/camera focus Earth/);
  });

  it('mass changes alter gravity on other bodies and keep the moon share', () => {
    const c = makeConsole();
    const ref = makeConsole();
    const r = c.run('body set Earth mass 2 Mearth');
    expect(r.kinds).toEqual(['success']);
    const e = c.sim.def('earth')!;
    expect(e.physical.massKg).toBeCloseTo(2 * ME, -18);
    expect(e.dynamics.gmKm3s2 - e.physical.gmKm3s2).toBeCloseTo(4902.800118, 3); // Moon kept
    expect(c.sim.def('earth')!.physical.meanRadiusKm).toBe(6371.01); // unrelated property untouched
    // Venus feels the heavier Earth: trajectories diverge
    c.sim.stepFixed(16 * 200);
    ref.sim.stepFixed(16 * 200);
    const dv = Math.hypot(...c.sim.getState('venus')!.position.map((x, i) => x - ref.sim.getState('venus')!.position[i]));
    expect(dv).toBeGreaterThan(1e-7);
  });

  it('radius changes update collision radius and density, and reject overlaps', () => {
    const c = makeConsole();
    expect(c.run('body set Jupiter radius 80000 km').kinds).toEqual(['success']);
    expect(c.sim.def('jupiter')!.physical.meanRadiusKm).toBe(80000);
    expect(c.sim.def('jupiter')!.physical.massKg).toBe(1.89819e27);
    const blocked = c.run('body set Sun radius 1 au');
    expect(blocked.kinds[0]).toBe('error');
    expect(c.sim.def('sun')!.physical.meanRadiusKm).toBe(695700);
  });

  it('move and velocity write position and velocity; velocity changes the trajectory', () => {
    const c = makeConsole();
    expect(c.run('body move Mars 1.5 0 0 au').kinds).toEqual(['success']);
    expect(c.sim.getState('mars')!.position).toEqual([1.5, 0, 0]);
    expect(c.run('planet velocity Mars 0 24 0 km/s').kinds).toEqual(['success']);
    expect(c.sim.getState('mars')!.velocity[1]).toBeCloseTo(24 * KMS, 15);
    const ref = makeConsole();
    ref.run('body move Mars 1.5 0 0 au');
    ref.run('planet velocity Mars 0 30 0 km/s');
    c.sim.stepFixed(16 * 100);
    ref.sim.stepFixed(16 * 100);
    expect(Math.abs(c.sim.getState('mars')!.position[1] - ref.sim.getState('mars')!.position[1])).toBeGreaterThan(0.05);
  });

  it('rejects bad input without false success and without changing state', () => {
    const c = makeConsole();
    const before = c.sim.snapshot();
    for (const raw of [
      'body set Earth mass 2', 'body set Earth mass -1 kg', 'body set Earth mass 2 parsec', 'body set Earth color red',
      'body move Mars 1 2 au', 'body move Mars -0.003 -0.0055 0 au', 'body velocity Mars 0 20000 0 km/s', 'body set Pluto mass 1 kg',
      'body set Earth mass 2 Mearth extra',
    ]) {
      const r = c.run(raw);
      expect(r.kinds[0], raw).toBe('error');
      expect(r.kinds).not.toContain('success');
    }
    expect(c.sim.snapshot()).toEqual(before);
  });
});

describe('time commands', () => {
  it('pause, resume, speed and fixed-duration step', () => {
    const c = makeConsole();
    c.run('sim pause');
    expect(c.sim.paused).toBe(true);
    c.sim.step(1);
    expect(c.sim.time).toBe(0);
    const s = c.run('sim step 1d');
    expect(s.kinds).toEqual(['success']);
    expect(c.sim.time).toBeCloseTo(1, 12);
    c.run('sim step 1 min'); // rounds to one 1.5 h step
    expect(c.sim.time).toBeCloseTo(1 + STEP_DAYS, 12);
    expect(c.run('sim step 2 h').text).toMatch(/rounded/);
    expect(c.run('sim speed 10 d/s').kinds).toEqual(['success']);
    expect(c.sim.rate).toBe(10);
    expect(c.state.rate).toBe(10);
    expect(c.run('sim speed 10').kinds[0]).toBe('error'); // ambiguous: no unit
    expect(c.run('sim speed 100 yr/s').kinds[0]).toBe('error');
    c.run('sim resume');
    expect(c.sim.paused).toBe(false);
    expect(c.run('sim status').text).toMatch(/running · speed 10\.00 d\/s/);
  });

  it('reset restores the epoch and catalogue, and is undoable', () => {
    const c = makeConsole();
    const initial = c.sim.snapshot();
    c.run('explode Mars');
    c.run('sim step 30 d');
    c.run('sim reset');
    expect(c.sim.snapshot()).toEqual(initial);
    c.run('undo');
    expect(c.sim.has('mars')).toBe(false);
    expect(c.sim.time).toBeCloseTo(30, 9);
  });
});

describe('view commands', () => {
  it('drive the same UI state as the on-screen controls', () => {
    const c = makeConsole();
    c.run('camera focus Saturn');
    c.run('camera free');
    c.run('select Earth');
    c.run('orbit trails off');
    c.run('labels off');
    c.run('size true');
    expect(c.calls).toEqual(['focus:saturn', 'free', 'select:earth']);
    expect(c.state).toMatchObject({ orbits: false, labels: false, bodyScale: 'true', selectedId: 'earth' });
    expect(c.run('labels maybe').kinds[0]).toBe('error');
    c.run('select none');
    expect(c.state.selectedId).toBeNull();
  });
});

describe('explode', () => {
  it('replaces the body with 8 real fragments, conserving mass and momentum', () => {
    const c = makeConsole();
    const p0 = c.sim.totalMomentum();
    const m0 = c.sim.totalMassKg();
    const earthMass = (c.sim.def('earth')!.dynamics.gmKm3s2 * 1e9) / 6.6743e-11; // Earth + Moon
    const r = c.run('explode Earth --force 2');
    expect(r.kinds[0]).toBe('success');
    expect(c.sim.has('earth')).toBe(false);
    const frags = c.sim.bodies.filter((b) => b.kind === 'fragment');
    expect(frags).toHaveLength(8);
    expect(frags.reduce((s, f) => s + f.physical.massKg, 0)).toBeCloseTo(earthMass, -14);
    expect(c.sim.totalMassKg() / m0).toBeCloseTo(1, 12);
    const p1 = c.sim.totalMomentum();
    const scale = Math.hypot(...p0) + earthMass * 30e3;
    expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / scale).toBeLessThan(1e-9);
    expect(c.effects).toEqual([{ kind: 'explosion', sizeKm: 6371.01 }]);
    // fragments are integrated like any body
    c.sim.stepFixed(160);
    expect(c.sim.status.kind).toBe('ok');
  });

  it('clears dangling selection references via the app; undo restores the original body exactly', () => {
    const c = makeConsole();
    const before = c.sim.snapshot();
    c.run('explode Mars');
    expect(c.run('body info Mars').kinds[0]).toBe('error');
    expect(c.run('undo').kinds).toEqual(['success']);
    expect(c.sim.snapshot()).toEqual(before);
    c.run('redo');
    expect(c.sim.has('mars')).toBe(false);
  });

  it('explode all requires --confirm and typos never destroy anything', () => {
    const c = makeConsole();
    const before = c.sim.snapshot();
    const w = c.run('explode all');
    expect(w.kinds[0]).toBe('warning');
    expect(c.sim.snapshot()).toEqual(before);
    expect(c.run('explode al').kinds[0]).toBe('error');
    expect(c.run('explode all --confrim').kinds[0]).toBe('error');
    expect(c.sim.snapshot()).toEqual(before);
    expect(c.run('explode all --confirm').kinds[0]).toBe('success');
    expect(c.sim.bodies).toHaveLength(72);
    expect(c.sim.bodies.every((b) => b.kind === 'fragment')).toBe(true);
    c.run('undo');
    expect(c.sim.snapshot()).toEqual(before);
  });

  it('validates force', () => {
    const c = makeConsole();
    expect(c.run('explode Earth --force 0.5').kinds[0]).toBe('error');
    expect(c.run('explode Earth --force').kinds[0]).toBe('error');
    expect(c.sim.has('earth')).toBe(true);
  });
});

describe('other god-mode commands', () => {
  it('launch adds Δv along the requested direction', () => {
    const c = makeConsole();
    const v0 = c.sim.getState('earth')!.velocity;
    c.run('launch Earth 5 km/s --dir north');
    const v1 = c.sim.getState('earth')!.velocity;
    expect((v1[2] - v0[2]) / KMS).toBeCloseTo(5, 9);
    expect(v1[0]).toBe(v0[0]);
    expect(c.run('launch Earth --dir sideways').kinds[0]).toBe('error');
    c.run('undo');
    expect(c.sim.getState('earth')!.velocity).toEqual(v0);
  });

  it('freeze pins position while gravity still acts; unfreeze resumes the stored velocity', () => {
    const c = makeConsole();
    const st = c.sim.getState('jupiter')!;
    c.run('freeze Jupiter');
    c.sim.stepFixed(160);
    expect(c.sim.getState('jupiter')!.position).toEqual(st.position);
    expect(c.sim.getState('jupiter')!.velocity).toEqual(st.velocity);
    c.run('unfreeze all');
    expect(c.sim.isFrozen('jupiter')).toBe(false);
    c.sim.stepFixed(16);
    expect(c.sim.getState('jupiter')!.position).not.toEqual(st.position);
    expect(c.run('body velocity Jupiter 0 0 0 km/s').kinds[0]).toBe('success');
    c.run('freeze all');
    expect(c.run('launch Earth').kinds[0]).toBe('error'); // frozen bodies refuse velocity edits
  });

  it('blackhole spawn adds a real massive body with Schwarzschild radius', () => {
    const c = makeConsole();
    const r = c.run('blackhole spawn 10 Msun --at 0 0 30 au');
    expect(r.kinds[0]).toBe('success');
    const bh = c.sim.def('blackhole-1')!;
    expect(bh.physical.massKg).toBeCloseTo(10 * MSUN_KG, -22);
    expect(bh.physical.meanRadiusKm).toBeCloseTo(29.5, 0);
    c.sim.getState('blackhole-1')!.position.forEach((x, i) => expect(x).toBeCloseTo([0, 0, 30][i], 12));
    expect(c.run('blackhole spawn 1000 Msun').kinds[0]).toBe('error');
    // the Sun starts falling toward it
    c.sim.stepFixed(16 * 30);
    expect(c.sim.getState('sun')!.position[2]).toBeGreaterThan(0.0005);
  });

  it('supernova needs --confirm, removes 70% of the mass and unbinds Earth', () => {
    const c = makeConsole();
    expect(c.run('supernova Sun').kinds[0]).toBe('warning');
    expect(c.sim.def('sun')!.physical.massKg).toBe(1.98841e30);
    expect(c.run('supernova Earth --confirm').kinds[0]).toBe('error');
    expect(c.run('supernova Sun --confirm').kinds[0]).toBe('success');
    expect(c.sim.def('sun')!.physical.massKg).toBeCloseTo(0.3 * 1.98841e30, -24);
    c.sim.stepFixed(16 * 365 * 3);
    const e = c.sim.getState('earth')!.position, s = c.sim.getState('sun')!.position;
    expect(Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2])).toBeGreaterThan(3);
  });

  it('universe status reports the real state', () => {
    const c = makeConsole();
    c.run('explode Mars');
    const t = c.run('universe status').text;
    expect(t).toMatch(/bodies {6}16/);
    expect(t).toMatch(/2026-01-01 00:00 TDB/);
    expect(t).toMatch(/god-mode changes are active/);
  });
});

describe('undo safety', () => {
  it('only records successful, state-changing commands', () => {
    const c = makeConsole();
    c.run('body info Earth');
    c.run('body set Earth mass -1 kg');
    expect(c.run('undo').kinds[0]).toBe('error');
    c.run('body set Earth mass 3 Mearth');
    c.run('undo');
    expect(c.sim.def('earth')!.physical.massKg).toBe(ME);
    expect(c.run('undo').text).toMatch(/Nothing to undo/);
  });

  it('a halted simulation refuses edits but undo recovers it', () => {
    const c = makeConsole();
    c.run('body velocity Mercury 0 0 0 km/s'); // falls into the Sun
    c.sim.stepFixed(16 * 60);
    expect(c.sim.status.kind).toBe('halted');
    expect(c.run('explode Earth').kinds[0]).toBe('error');
    c.run('undo');
    expect(c.sim.status.kind).toBe('ok');
    expect(c.sim.time).toBe(0);
  });
});

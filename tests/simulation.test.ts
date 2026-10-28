import { describe, expect, it } from 'vitest';
import { SOLAR_SYSTEM } from '../src/data/solarSystem';
import { GravitySimulation, STEP_DAYS } from '../src/simulation/GravitySimulation';
import { SimulationClock, MAX_STEPS_PER_ADVANCE } from '../src/physics/SimulationClock';
import { auToScene, SCENE_UNITS_PER_AU, BODY_SCALES, visualRadius, kmToScene } from '../src/scene/presentation';

const snapshot = (sim: GravitySimulation) => SOLAR_SYSTEM.map((b) => sim.getState(b.id)!);

describe('determinism', () => {
  it('identical inputs give bit-identical states', () => {
    const a = new GravitySimulation(SOLAR_SYSTEM), b = new GravitySimulation(SOLAR_SYSTEM);
    a.stepFixed(5000);
    b.stepFixed(5000);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('simulated time does not depend on frame rate', () => {
    const rate = 30;
    const fast = new GravitySimulation(SOLAR_SYSTEM, rate), slow = new GravitySimulation(SOLAR_SYSTEM, rate);
    for (let i = 0; i < 240; i++) fast.step(1 / 240); // 1 s at 240 fps
    for (let i = 0; i < 20; i++) slow.step(1 / 20); //   1 s at 20 fps
    expect(fast.time).toBeCloseTo(30, 9);
    expect(slow.time).toBeCloseTo(fast.time, 9);
    expect(snapshot(slow)).toEqual(snapshot(fast));
  });
});

describe('clock controls', () => {
  it('pause stops time, resume continues it', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM, 1);
    sim.paused = true;
    sim.step(0.2);
    expect(sim.time).toBe(0);
    sim.paused = false;
    sim.step(0.2);
    expect(sim.time).toBeCloseTo(0.1875, 9); // 0.2 d floored to whole 1/16-day steps
  });

  it('rate changes scale simulated time and reject invalid values', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM, 1);
    sim.rate = 8;
    sim.step(0.25);
    expect(sim.time).toBeCloseTo(2, 9);
    for (const bad of [-1, NaN, Infinity]) expect(() => (sim.rate = bad)).toThrow(RangeError);
    expect(sim.rate).toBe(8);
  });

  it('ignores invalid frame deltas and clamps long frames', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM, 1);
    for (const bad of [NaN, -1, 0, Infinity]) sim.step(bad);
    expect(sim.time).toBe(0);
    sim.step(10); // e.g. tab was hidden; clamped to 0.25 s
    expect(sim.time).toBeCloseTo(0.25, 9);
  });

  it('caps work per frame and flags lag instead of freezing', () => {
    const clock = new SimulationClock(STEP_DAYS, 1e6);
    expect(clock.advance(0.1)).toBe(MAX_STEPS_PER_ADVANCE);
    expect(clock.lagging).toBe(true);
  });

  it('reset restores the epoch state exactly and bumps the generation', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const initial = snapshot(sim);
    sim.stepFixed(1000);
    expect(snapshot(sim)).not.toEqual(initial);
    sim.reset();
    expect(sim.time).toBe(0);
    expect(sim.generation).toBe(1);
    expect(snapshot(sim)).toEqual(initial);
  });

  it('path prediction does not disturb the live state', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const before = snapshot(sim);
    const paths = sim.predictPaths(90);
    expect(paths.size).toBe(8);
    expect(snapshot(sim)).toEqual(before);
    // Earth path closes on itself after one sidereal year (N-body, so only approximately).
    const earth = paths.get('earth')!;
    const [a, z] = [earth[0], earth.at(-1)!];
    expect(Math.hypot(a[0] - z[0], a[1] - z[1], a[2] - z[2])).toBeLessThan(0.01);
  });
});

describe('presentation scaling is separate from physics', () => {
  it('size presets are visual only: planets stay proportional, physical radii untouched', () => {
    const sun = SOLAR_SYSTEM[0], earth = SOLAR_SYSTEM[3], jup = SOLAR_SYSTEM[5];
    const mercuryPerihelionScene = 46_001_200 / 1e6;
    for (const scale of BODY_SCALES) {
      expect(visualRadius(earth, scale)).toBeCloseTo(kmToScene(earth.physical.meanRadiusKm) * scale.planet, 12);
      expect(visualRadius(jup, scale) / visualRadius(earth, scale)).toBeCloseTo(jup.physical.meanRadiusKm / earth.physical.meanRadiusKm, 12);
      expect(visualRadius(sun, scale)).toBeLessThan(mercuryPerihelionScene);
    }
    expect(visualRadius(earth)).toBeCloseTo(kmToScene(6371.01), 12); // default is true size
    expect(sun.physical.meanRadiusKm).toBe(695700);
    expect(earth.physical.meanRadiusKm).toBe(6371.01);
  });

  it('maps au to scene units linearly without mutating inputs', () => {
    const p: [number, number, number] = [1, 2, 3];
    const o: [number, number, number] = [0.5, 0.5, 0.5];
    const s = auToScene(p, o);
    expect(p).toEqual([1, 2, 3]);
    expect(s[0]).toBeCloseTo(0.5 * SCENE_UNITS_PER_AU);
    expect(s[1]).toBeCloseTo(2.5 * SCENE_UNITS_PER_AU); // ecliptic z → scene y
  });

  it('the simulation radius used for contact detection is the true radius, not the visual one', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const sys = (sim as unknown as { system: { radius: Float64Array } }).system;
    expect(sys.radius[0] * 149_597_870.7).toBeCloseTo(695700, 3);
  });
});

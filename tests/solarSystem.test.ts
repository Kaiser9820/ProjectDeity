import { describe, expect, it } from 'vitest';
import { SOLAR_SYSTEM } from '../src/data/solarSystem';
import { EPOCH_JD_TDB, initialStateFor } from '../src/simulation/initialConditions';
import { GravitySimulation, STEP_DAYS, buildSystem } from '../src/simulation/GravitySimulation';
import validation from './fixtures/horizons-2027-01-01.json';

describe('catalog', () => {
  it('contains the Sun and the eight planets, in order', () => {
    expect(SOLAR_SYSTEM.map((b) => b.name)).toEqual(['Sun', 'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']);
  });

  it('carries JPL physical values (spot checks against Horizons / DE440)', () => {
    const by = Object.fromEntries(SOLAR_SYSTEM.map((b) => [b.id, b]));
    expect(by.sun.physical.meanRadiusKm).toBe(695700);
    expect(by.sun.dynamics.gmKm3s2).toBeCloseTo(132712440041.939, 2);
    expect(by.earth.physical.meanRadiusKm).toBe(6371.01);
    expect(by.earth.dynamics.gmKm3s2).toBeCloseTo(403503.235554, 5); // Earth + Moon
    expect(by.jupiter.dynamics.gmKm3s2).toBe(126712764.1);
    expect(by.mercury.orbit!.eccentricity).toBeCloseTo(0.2056, 4);
    for (const b of SOLAR_SYSTEM) {
      expect(b.physical.massKg).toBeGreaterThan(0);
      // mass and GM must agree via G within 0.1 %
      expect((b.physical.massKg * 6.6743e-11) / 1e9 / b.physical.gmKm3s2).toBeCloseTo(1, 2);
    }
  });
});

describe('initial conditions', () => {
  it('loads the Horizons epoch and state vectors unchanged', () => {
    expect(EPOCH_JD_TDB).toBe(2461041.5);
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    for (const b of SOLAR_SYSTEM) {
      const s = sim.getState(b.id)!;
      expect(s.position).toEqual(initialStateFor(b.id).position);
      expect(s.velocity).toEqual(initialStateFor(b.id).velocity);
    }
  });

  it('is barycentric: total momentum of the 9 bodies is near zero', () => {
    const sys = buildSystem(SOLAR_SYSTEM);
    const p = [0, 0, 0];
    let total = 0;
    for (let i = 0; i < sys.n; i++) for (let k = 0; k < 3; k++) p[k] += sys.gm[i] * sys.v[3 * i + k];
    for (let i = 0; i < sys.n; i++) total += sys.gm[i];
    // Residual comes from bodies not modelled (Pluto, asteroids, …); relative to Sun momentum scale.
    expect(Math.hypot(...p) / total).toBeLessThan(1e-7);
  });
});

describe('integration against JPL Horizons', () => {
  it('one year from the epoch, positions agree with Horizons to the expected accuracy', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const days = validation.epoch.jdTDB - EPOCH_JD_TDB; // 365
    sim.stepFixed(Math.round(days / STEP_DAYS));
    expect(sim.time).toBeCloseTo(days, 9);
    const errors: Record<string, number> = {};
    for (const b of SOLAR_SYSTEM) {
      const ref = (validation.states as Record<string, { r: number[] }>)[b.id].r;
      const s = sim.getState(b.id)!.position;
      errors[b.id] = Math.hypot(s[0] - ref[0], s[1] - ref[1], s[2] - ref[2]);
    }
    // Limits: Newtonian point masses lack GR (Mercury), asteroids, Pluto and planetary oblateness.
    expect(errors.mercury).toBeLessThan(2e-4);
    for (const id of ['sun', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) expect(errors[id]).toBeLessThan(5e-5);
  });

  it('keeps relative energy error small over 50 years', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const e0 = buildSystem(SOLAR_SYSTEM).energy();
    let worst = 0;
    for (let y = 0; y < 50; y++) {
      sim.stepFixed(Math.round(365.25 / STEP_DAYS));
      worst = Math.max(worst, sim.energyDrift(e0));
    }
    expect(sim.status.kind).toBe('ok');
    expect(worst).toBeLessThan(1e-7);
    const earth = sim.getState('earth')!.position, sun = sim.getState('sun')!.position;
    const r = Math.hypot(earth[0] - sun[0], earth[1] - sun[1], earth[2] - sun[2]);
    expect(r).toBeGreaterThan(0.98);
    expect(r).toBeLessThan(1.02);
  }, 30_000);
});

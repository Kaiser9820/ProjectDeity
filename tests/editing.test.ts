import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SOLAR_SYSTEM } from '../src/data/solarSystem';
import { GravitySimulation } from '../src/simulation/GravitySimulation';
import { NBodySystem } from '../src/physics/NBodySystem';
import { auToScene, sceneDeltaToAu, PHYSICAL_AXES } from '../src/scene/presentation';
import { choosePick, rankPicks, type PickCandidate } from '../src/scene/picking';
import { closestAxisParam } from '../src/scene/TranslateGizmo';
import type { Vec3 } from '../src/types';

const accel = (sys: NBodySystem) => (sys as unknown as { a: Float64Array }).a;
const sysOf = (sim: GravitySimulation) => (sim as unknown as { system: NBodySystem }).system;

describe('editing a body position', () => {
  it('moves the physical state, keeps velocity/GM/radius, and refreshes accelerations', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const before = sim.getState('earth')!;
    const sys = sysOf(sim);
    const gm = sys.gm.slice(), radius = sys.radius.slice();
    const target: Vec3 = [1.5, 0.2, 0.01];
    expect(sim.setBodyPosition('earth', target)).toEqual({ ok: true });
    expect(sim.getState('earth')!.position).toEqual(target);
    expect(sim.getState('earth')!.velocity).toEqual(before.velocity);
    expect(sys.gm).toEqual(gm);
    expect(sys.radius).toEqual(radius);
    expect(sim.revision).toBe(1);
    // cached accelerations equal a fresh computation from the edited state
    const fresh = new NBodySystem({
      gm: [...sys.gm], radius: [...sys.radius],
      positions: SOLAR_SYSTEM.map((_, i) => sys.position(i)),
      velocities: SOLAR_SYSTEM.map((_, i) => sys.velocity(i)),
    });
    expect(accel(sys)).toEqual(accel(fresh));
  });

  it('the edited body then follows gravity from its new state (no restoring force)', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const sun = sim.getState('sun')!.position;
    // Same ~30 km/s at 1.5× the distance exceeds the local circular speed (~24 km/s) but not
    // escape speed (~35 km/s): the new point becomes perihelion and Earth climbs outward.
    const e = sim.getState('earth')!.position;
    const moved: Vec3 = [sun[0] + (e[0] - sun[0]) * 1.5, sun[1] + (e[1] - sun[1]) * 1.5, e[2]];
    sim.setBodyPosition('earth', moved);
    const r0 = Math.hypot(moved[0] - sun[0], moved[1] - sun[1]);
    sim.stepFixed(16 * 120);
    const s = sim.getState('earth')!.position, su = sim.getState('sun')!.position;
    expect(Math.hypot(s[0] - su[0], s[1] - su[1])).toBeGreaterThan(r0 + 0.05);
    expect(sim.status.kind).toBe('ok');
  });

  it('path prediction reflects the edit', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const before = sim.predictPaths(30).get('mars')![0];
    sim.setBodyPosition('mars', [3, 0, 0]);
    expect(sim.predictPaths(30).get('mars')![0]).toEqual([3, 0, 0]);
    expect(before).not.toEqual([3, 0, 0]);
  });

  it('rejects overlaps and invalid input without changing anything', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const sun = sim.getState('sun')!.position;
    const earth = sim.getState('earth')!.position;
    const res = sim.setBodyPosition('earth', [sun[0] + 0.001, sun[1], sun[2]]);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/overlap Sun/);
    expect(sim.setBodyPosition('earth', [NaN, 0, 0]).ok).toBe(false);
    expect(sim.setBodyPosition('pluto', [1, 0, 0]).ok).toBe(false);
    expect(sim.getState('earth')!.position).toEqual(earth);
    expect(sim.revision).toBe(0);
    expect(sim.status.kind).toBe('ok');
  });

  it('suspends integration during an edit and restores the previous run state', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM, 1);
    sim.beginEdit();
    expect(sim.editing).toBe(true);
    sim.step(0.2);
    expect(sim.time).toBe(0);
    expect(sim.paused).toBe(false);
    sim.endEdit();
    sim.step(0.125);
    expect(sim.time).toBeCloseTo(0.125, 9);
    // a user pause survives an edit
    sim.paused = true;
    sim.beginEdit();
    sim.endEdit();
    expect(sim.paused).toBe(true);
  });

  it('reset clears edits', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    const p = sim.getState('venus')!.position;
    sim.setBodyPosition('venus', [0.5, 0.5, 0]);
    sim.reset();
    expect(sim.getState('venus')!.position).toEqual(p);
  });
});

describe('gizmo math', () => {
  it('scene ↔ physical axis mapping is consistent', () => {
    for (const { phys, scene } of Object.values(PHYSICAL_AXES)) {
      const back = sceneDeltaToAu(scene);
      back.forEach((c, i) => expect(c * auToScene([1, 0, 0])[0]).toBeCloseTo(phys[i], 12));
    }
    const p: Vec3 = [0.3, -1.2, 0.05];
    const sc = auToScene(p);
    sceneDeltaToAu(sc).forEach((c, i) => expect(c).toBeCloseTo(p[i], 12));
  });

  it('closest point on an axis to a pointer ray', () => {
    const a = new THREE.Vector3(0, 0, 0), d = new THREE.Vector3(1, 0, 0);
    // ray from (3, 5, 0) straight down passes the x-axis at x = 3
    expect(closestAxisParam(a, d, new THREE.Vector3(3, 5, 0), new THREE.Vector3(0, -1, 0))).toBeCloseTo(3, 12);
    // ray parallel to the axis is rejected rather than jumping
    expect(closestAxisParam(a, d, new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))).toBeNull();
  });
});

describe('picking', () => {
  const c = (id: string, x: number, y: number, screenRadius: number, depth: number): PickCandidate => ({ id, x, y, screenRadius, depth });

  it('selects a sub-pixel body within the tolerance', () => {
    expect(rankPicks([c('mercury', 100, 100, 0.2, 10)], 112, 105, 18)).toEqual(['mercury']);
    expect(rankPicks([c('mercury', 100, 100, 0.2, 10)], 130, 100, 18)).toEqual([]);
  });

  it('prefers a small marker over a large disc it sits on, and the nearest disc when overlapping', () => {
    const sun = c('sun', 100, 100, 40, 50), mercury = c('mercury', 120, 100, 0.5, 45);
    expect(rankPicks([sun, mercury], 121, 101, 18)[0]).toBe('mercury');
    expect(rankPicks([sun, mercury], 85, 100, 18)[0]).toBe('sun');
    const near = c('earth', 100, 100, 60, 1), far = c('mars', 101, 100, 0.3, 500);
    expect(rankPicks([near, far], 100, 100, 18)).toEqual(['earth']); // mars hidden behind earth
  });

  it('repeated clicks on the same spot cycle through overlapping bodies', () => {
    const ranked = ['earth', 'mars'];
    expect(choosePick(ranked, null, false)).toBe('earth');
    expect(choosePick(ranked, 'earth', true)).toBe('mars');
    expect(choosePick(ranked, 'mars', true)).toBe('earth');
    expect(choosePick(ranked, 'earth', false)).toBe('earth');
  });

  it('interaction tolerance never touches physical radii', () => {
    const sim = new GravitySimulation(SOLAR_SYSTEM);
    expect(sysOf(sim).radius[3] * 149_597_870.7).toBeCloseTo(SOLAR_SYSTEM[3].physical.meanRadiusKm, 6);
  });
});

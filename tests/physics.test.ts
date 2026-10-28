import { describe, expect, it } from 'vitest';
import { NBodySystem } from '../src/physics/NBodySystem';
import { AU_KM, DAY_S, gmToAuDay } from '../src/physics/units';

describe('units', () => {
  it('GM_sun in au^3/day^2 equals the Gaussian gravitational constant squared', () => {
    const k = 0.01720209895;
    expect(gmToAuDay(132712440041.93938) / (k * k)).toBeCloseTo(1, 7);
  });

  it('round-trips km^3/s^2 through au^3/day^2', () => {
    const gm = 398600.435436;
    expect((gmToAuDay(gm) * AU_KM ** 3) / DAY_S ** 2).toBeCloseTo(gm, 6);
  });
});

describe('gravitational acceleration', () => {
  it('matches GM/r^2 for two bodies, directed toward the attractor, with Newton’s third law', () => {
    const gmA = 2e-4, gmB = 3e-7;
    const sys = new NBodySystem({
      gm: [gmA, gmB], radius: [0, 0],
      positions: [[0, 0, 0], [2, 0, 0]], velocities: [[0, 0, 0], [0, 0, 0]],
    });
    sys.computeAccelerations();
    const a = (sys as unknown as { a: Float64Array }).a;
    expect(a[3]).toBeCloseTo(-gmA / 4, 15);
    expect(a[0]).toBeCloseTo(gmB / 4, 15);
    // momentum: m_A a_A + m_B a_B = 0  (masses ∝ GM)
    expect(gmA * a[0] + gmB * a[3]).toBeCloseTo(0, 18);
    expect([a[1], a[2], a[4], a[5]]).toEqual([0, 0, 0, 0]);
  });

  it('a circular two-body orbit returns to its start after one period', () => {
    const gm = gmToAuDay(132712440041.93938);
    const r = 1;
    const v = Math.sqrt(gm / r);
    const period = (2 * Math.PI * r) / v;
    // Test particle (tiny GM) around a fixed-ish heavy body.
    const sys = new NBodySystem({
      gm: [gm, 1e-20], radius: [0, 0],
      positions: [[0, 0, 0], [r, 0, 0]], velocities: [[0, 0, 0], [0, v, 0]],
    });
    const steps = 4000;
    for (let i = 0; i < steps; i++) sys.step(period / steps);
    const [x, y] = sys.position(1);
    expect(Math.hypot(x - r, y)).toBeLessThan(1e-4);
  });
});

describe('numerical safeguards', () => {
  it('rejects invalid initial data', () => {
    const ok = { gm: [1e-4], radius: [0], positions: [[0, 0, 0]] as [number, number, number][], velocities: [[0, 0, 0]] as [number, number, number][] };
    expect(() => new NBodySystem({ ...ok, gm: [NaN] })).toThrow();
    expect(() => new NBodySystem({ ...ok, gm: [-1] })).toThrow();
    expect(() => new NBodySystem({ ...ok, positions: [[Infinity, 0, 0]] })).toThrow();
    expect(() => new NBodySystem({ ...ok, radius: [] })).toThrow();
  });

  it('rejects invalid timesteps', () => {
    const sys = new NBodySystem({ gm: [1e-4], radius: [0], positions: [[0, 0, 0]], velocities: [[0, 0, 0]] });
    for (const dt of [0, -1, NaN, Infinity]) expect(() => sys.step(dt)).toThrow(RangeError);
  });

  it('halts on physical contact without corrupting state', () => {
    const sys = new NBodySystem({
      gm: [1e-4, 1e-4], radius: [0.01, 0.01],
      positions: [[0, 0, 0], [0.05, 0, 0]], velocities: [[0, 0, 0], [-0.01, 0, 0]],
    });
    let steps = 0;
    while (sys.step(0.1) && steps < 10_000) steps++;
    expect(sys.status.kind).toBe('collision');
    for (const c of [...sys.r, ...sys.v]) expect(Number.isFinite(c)).toBe(true);
    const frozen = sys.r.slice();
    expect(sys.step(0.1)).toBe(false);
    expect(sys.r).toEqual(frozen);
  });
});

import type { BodyState, CelestialBodyDef, Simulation, SimulationStatus, Vec3 } from '../types';
import { NBodySystem, type SetPositionResult } from '../physics/NBodySystem';
import { SimulationClock } from '../physics/SimulationClock';
import { AU_KM, DAY_S, G_SI, gmToAuDay } from '../physics/units';
import { EPOCH_JD_TDB, initialStateFor } from './initialConditions';
import { predictPaths, type PathRequest } from './predictPaths';

/** Fixed integration step: 1/16 day = 1.5 h. Mercury’s 88-day orbit gets ≈1 400 steps. */
export const STEP_DAYS = 1 / 16;

/** Simulated days per real second. */
export const RATE_PRESETS: { label: string; daysPerSecond: number }[] = [
  { label: '1 h/s', daysPerSecond: 1 / 24 },
  { label: '1 d/s', daysPerSecond: 1 },
  { label: '1 wk/s', daysPerSecond: 7 },
  { label: '30 d/s', daysPerSecond: 30 },
  { label: '1 yr/s', daysPerSecond: 365.25 },
  { label: '4 yr/s', daysPerSecond: 4 * 365.25 },
];
export const DEFAULT_RATE_INDEX = 2;
/** Upper bound for the run rate: 10 simulated years per real second. */
export const MAX_RATE_DAYS_PER_S = 10 * 365.25;
/** Upper bound for a single `sim step`, to keep the UI responsive. */
export const MAX_STEP_DAYS = 200 * 365.25;
/** Hard cap on the number of bodies (cost is O(N²) per step). */
export const MAX_BODIES = 160;

export function buildSystem(bodies: readonly CelestialBodyDef[]): NBodySystem {
  const init = bodies.map((b) => initialStateFor(b.id));
  return new NBodySystem({
    gm: bodies.map((b) => gmToAuDay(b.dynamics.gmKm3s2)),
    radius: bodies.map((b) => b.physical.meanRadiusKm / AU_KM),
    positions: init.map((s) => s.position),
    velocities: init.map((s) => s.velocity),
  });
}

export type EditResult = { ok: true } | { ok: false; message: string };

/** A new body to insert: its definition plus barycentric state (au, au/day). */
export interface NewBody {
  def: CelestialBodyDef;
  position: Vec3;
  velocity: Vec3;
}

/** Complete physical state, sufficient to restore the universe exactly (used by undo). */
export interface SimulationSnapshot {
  bodies: CelestialBodyDef[];
  gm: number[];
  radius: number[];
  r: number[];
  v: number[];
  frozen: boolean[];
  t: number;
}

const clone = <T,>(x: T): T => structuredClone(x);

/** Real Newtonian N-body simulation of the bodies, started from Horizons state vectors. */
export class GravitySimulation implements Simulation {
  readonly epochJD = EPOCH_JD_TDB;
  private readonly initialBodies: readonly CelestialBodyDef[];
  private _bodies: CelestialBodyDef[];
  private system: NBodySystem;
  private clock: SimulationClock;
  private index = new Map<string, number>();
  private _generation = 0;
  private _revision = 0;
  private editHolds = 0;

  constructor(bodies: readonly CelestialBodyDef[], rateDaysPerSecond = RATE_PRESETS[DEFAULT_RATE_INDEX].daysPerSecond) {
    this.initialBodies = clone(bodies);
    this._bodies = clone(bodies as CelestialBodyDef[]);
    this.system = buildSystem(this._bodies);
    this.clock = new SimulationClock(STEP_DAYS, rateDaysPerSecond);
    this.reindex();
  }

  /** Current bodies. Definitions are owned by the simulation; physical values here match the integrator. */
  get bodies(): readonly CelestialBodyDef[] { return this._bodies; }
  get time() { return this.system.t; }
  get generation() { return this._generation; }
  /** Incremented whenever the physical state or body set is edited (not by normal integration). */
  get revision() { return this._revision; }
  /** True while an interactive edit holds the clock; the user's paused flag is untouched. */
  get editing() { return this.editHolds > 0; }
  get rate() { return this.clock.rate; }
  set rate(v: number) {
    if (v > MAX_RATE_DAYS_PER_S) throw new RangeError(`Rate above ${MAX_RATE_DAYS_PER_S} d/s`);
    this.clock.rate = v;
  }
  get paused() { return this.clock.paused; }
  set paused(v: boolean) { this.clock.paused = v; }
  get lagging() { return this.clock.lagging; }

  get status(): SimulationStatus {
    const s = this.system.status;
    if (s.kind === 'ok') return s;
    if (s.kind === 'collision')
      return { kind: 'halted', reason: `Close approach: ${this._bodies[s.a].name} and ${this._bodies[s.b].name} touched (${(s.separationAu * AU_KM).toFixed(0)} km).` };
    return { kind: 'halted', reason: 'Numerical failure (non-finite state). State was preserved at the last valid step.' };
  }

  private reindex() {
    this.index = new Map(this._bodies.map((b, i) => [b.id, i]));
  }

  private touched() {
    this._revision++;
  }

  step(realSeconds: number): void {
    if (this.editHolds > 0) return;
    const n = this.clock.advance(realSeconds);
    for (let i = 0; i < n; i++) if (!this.system.step(STEP_DAYS)) break;
  }

  /** Advance by an exact number of fixed steps, independent of the clock (tests, tools). Returns steps taken. */
  stepFixed(count: number): number {
    let done = 0;
    for (; done < count; done++) if (!this.system.step(STEP_DAYS)) break;
    return done;
  }

  /**
   * Advance by a simulated duration regardless of pause state. The duration is rounded to the
   * nearest whole fixed step (minimum one step), so integration rules are identical to a run.
   */
  stepDuration(days: number): { ok: true; steps: number; days: number } | { ok: false; message: string; steps: number; days: number } {
    if (!(days > 0) || !Number.isFinite(days)) return { ok: false, message: 'Duration must be a positive, finite time.', steps: 0, days: 0 };
    if (days > MAX_STEP_DAYS) return { ok: false, message: `Duration exceeds the ${MAX_STEP_DAYS / 365.25}-year limit for one step command.`, steps: 0, days: 0 };
    if (this.status.kind !== 'ok') return { ok: false, message: 'The simulation is halted. Reset or undo first.', steps: 0, days: 0 };
    const steps = Math.max(1, Math.round(days / STEP_DAYS));
    const done = this.stepFixed(steps);
    this.clock.reset();
    this.touched();
    if (done < steps) return { ok: false, message: `Halted after ${done} of ${steps} steps: ${(this.status as { reason?: string }).reason ?? ''}`, steps: done, days: done * STEP_DAYS };
    return { ok: true, steps, days: steps * STEP_DAYS };
  }

  has(id: string) {
    return this.index.has(id);
  }

  def(id: string): CelestialBodyDef | undefined {
    const i = this.index.get(id);
    return i === undefined ? undefined : this._bodies[i];
  }

  getState(id: string): BodyState | undefined {
    const i = this.index.get(id);
    if (i === undefined) return undefined;
    return { id, position: this.system.position(i), velocity: this.system.velocity(i) };
  }

  isFrozen(id: string): boolean {
    const i = this.index.get(id);
    return i !== undefined && this.system.frozen[i] === 1;
  }

  /** Suspend advancement during an interactive edit. Pair every call with endEdit(). */
  beginEdit(): void {
    this.editHolds++;
  }

  endEdit(): void {
    this.editHolds = Math.max(0, this.editHolds - 1);
    // Drop time accumulated before the hold so the run resumes without a catch-up jump.
    if (this.editHolds === 0) this.clock.reset();
  }

  private describe(res: SetPositionResult, i: number, what: string): EditResult {
    if (res.ok) return res;
    const name = this._bodies[i]?.name ?? '?';
    const message = {
      'unknown-body': 'Unknown body.',
      'non-finite': `${what} must be a finite, positive number.`,
      halted: 'The simulation is halted. Reset or undo before editing.',
      overlap: `Blocked: ${name} would overlap ${res.reason === 'overlap' ? this._bodies[res.other].name : ''}.`,
    }[res.reason];
    return { ok: false, message };
  }

  private lookup(id: string): number | EditResult {
    const i = this.index.get(id);
    return i === undefined ? { ok: false, message: `Unknown body "${id}".` } : i;
  }

  /**
   * Physically relocates a body (barycentric ecliptic J2000, au). Velocity, mass and radius are
   * kept; the subsequent motion follows from gravity. Overlaps are rejected, never corrected.
   */
  setBodyPosition(id: string, position: Vec3): EditResult {
    const i = this.lookup(id);
    if (typeof i !== 'number') return i;
    const res = this.describe(this.system.setPosition(i, position), i, 'Position');
    if (res.ok) this.touched();
    return res;
  }

  /** Sets a body's barycentric velocity (au/day). */
  setBodyVelocity(id: string, velocity: Vec3): EditResult {
    const i = this.lookup(id);
    if (typeof i !== 'number') return i;
    if (this.system.frozen[i]) return { ok: false, message: `${this._bodies[i].name} is frozen. Unfreeze it first.` };
    const res = this.describe(this.system.setVelocity(i, velocity), i, 'Velocity');
    if (res.ok) this.touched();
    return res;
  }

  /**
   * Sets a body's own mass. The gravitating GM changes by the same amount, so for system
   * barycentres (planet + moons) the moons' share is kept: GM_sys' = GM_sys − GM_body + GM_body'.
   */
  setBodyMass(id: string, massKg: number): EditResult {
    const i = this.lookup(id);
    if (typeof i !== 'number') return i;
    if (!(massKg > 0) || !Number.isFinite(massKg)) return { ok: false, message: 'Mass must be a finite, positive number.' };
    const def = this._bodies[i];
    const newBodyGm = (G_SI * massKg) / 1e9;
    const satellites = Math.max(0, def.dynamics.gmKm3s2 - def.physical.gmKm3s2);
    const sysGm = newBodyGm + satellites;
    const res = this.describe(this.system.setGM(i, gmToAuDay(sysGm)), i, 'Mass');
    if (!res.ok) return res;
    const radiusM = def.physical.meanRadiusKm * 1e3;
    def.physical = { ...def.physical, massKg, gmKm3s2: newBodyGm, meanDensityGcm3: massKg / ((4 / 3) * Math.PI * radiusM ** 3) / 1000 };
    def.dynamics = { ...def.dynamics, gmKm3s2: sysGm };
    this.touched();
    return { ok: true };
  }

  /** Sets a body's mean radius (km). Equatorial radius scales proportionally; mass is kept, density follows. */
  setBodyRadius(id: string, radiusKm: number): EditResult {
    const i = this.lookup(id);
    if (typeof i !== 'number') return i;
    if (!(radiusKm > 0) || !Number.isFinite(radiusKm)) return { ok: false, message: 'Radius must be a finite, positive number.' };
    const res = this.describe(this.system.setRadius(i, radiusKm / AU_KM), i, 'Radius');
    if (!res.ok) return res;
    const def = this._bodies[i];
    const k = radiusKm / def.physical.meanRadiusKm;
    const radiusM = radiusKm * 1e3;
    def.physical = {
      ...def.physical,
      meanRadiusKm: radiusKm,
      equatorialRadiusKm: def.physical.equatorialRadiusKm * k,
      meanDensityGcm3: def.physical.massKg / ((4 / 3) * Math.PI * radiusM ** 3) / 1000,
    };
    this.touched();
    return { ok: true };
  }

  /** Freeze (pin) or unfreeze a body. Its stored velocity is kept untouched while frozen. */
  setFrozen(id: string, frozen: boolean): EditResult {
    const i = this.lookup(id);
    if (typeof i !== 'number') return i;
    if (this.status.kind !== 'ok') return { ok: false, message: 'The simulation is halted. Reset or undo first.' };
    this.system.frozen[i] = frozen ? 1 : 0;
    this.touched();
    return { ok: true };
  }

  /**
   * Structural edit: removes `removeIds` and inserts `add`, atomically. Validates the resulting
   * state (finite values, no overlaps, body cap) before committing; on failure nothing changes.
   */
  replaceBodies(removeIds: readonly string[], add: readonly NewBody[]): EditResult {
    if (this.status.kind !== 'ok') return { ok: false, message: 'The simulation is halted. Reset or undo first.' };
    for (const id of removeIds) if (!this.index.has(id)) return { ok: false, message: `Unknown body "${id}".` };
    const remove = new Set(removeIds);
    const keep = this._bodies.map((b, i) => ({ b, i })).filter(({ b }) => !remove.has(b.id));
    if (keep.length + add.length > MAX_BODIES) return { ok: false, message: `That would exceed the ${MAX_BODIES}-body limit.` };
    if (keep.length + add.length === 0) return { ok: false, message: 'A universe needs at least one body. Use `sim reset` to start over.' };
    const ids = new Set(keep.map(({ b }) => b.id));
    for (const n of add) {
      if (ids.has(n.def.id)) return { ok: false, message: `Duplicate body id "${n.def.id}".` };
      ids.add(n.def.id);
    }
    const s = this.system;
    let next: NBodySystem;
    try {
      next = new NBodySystem({
        gm: [...keep.map(({ i }) => s.gm[i]), ...add.map((n) => gmToAuDay(n.def.dynamics.gmKm3s2))],
        radius: [...keep.map(({ i }) => s.radius[i]), ...add.map((n) => n.def.physical.meanRadiusKm / AU_KM)],
        positions: [...keep.map(({ i }) => s.position(i)), ...add.map((n) => n.position)],
        velocities: [...keep.map(({ i }) => s.velocity(i)), ...add.map((n) => n.velocity)],
        frozen: [...keep.map(({ i }) => s.frozen[i] === 1), ...add.map(() => false)],
      });
    } catch (e) {
      return { ok: false, message: `Invalid new state: ${(e as Error).message}.` };
    }
    if (next.status.kind !== 'ok') {
      const st = next.status;
      const all = [...keep.map(({ b }) => b), ...add.map((n) => n.def)];
      return { ok: false, message: st.kind === 'collision' ? `Blocked: ${all[st.a].name} would overlap ${all[st.b].name}.` : 'Invalid new state.' };
    }
    next.t = s.t;
    this.system = next;
    this._bodies = [...keep.map(({ b }) => b), ...add.map((n) => clone(n.def))];
    this.reindex();
    this.touched();
    return { ok: true };
  }

  /** Full copy of the physical state (for undo). */
  snapshot(): SimulationSnapshot {
    const s = this.system;
    return {
      bodies: clone(this._bodies),
      gm: Array.from(s.gm), radius: Array.from(s.radius), r: Array.from(s.r), v: Array.from(s.v),
      frozen: Array.from(s.frozen, (f) => f === 1), t: s.t,
    };
  }

  /**
   * Checks that a snapshot can be loaded: consistent array sizes, valid values, unique ids and no
   * overlapping bodies. Returns an error message, or null if it is loadable. Never mutates anything.
   */
  static checkSnapshot(snap: SimulationSnapshot): string | null {
    const n = snap.bodies.length;
    if (n < 1 || n > MAX_BODIES) return `A universe must have 1–${MAX_BODIES} bodies (got ${n}).`;
    if (snap.gm.length !== n || snap.radius.length !== n || snap.frozen.length !== n || snap.r.length !== 3 * n || snap.v.length !== 3 * n)
      return 'Inconsistent state arrays.';
    if (new Set(snap.bodies.map((b) => b.id)).size !== n) return 'Duplicate body ids.';
    if (!(snap.t >= 0) || !Number.isFinite(snap.t)) return 'Simulated time must be a finite, non-negative number.';
    let sys: NBodySystem;
    try {
      sys = GravitySimulation.systemFrom(snap);
    } catch (e) {
      return (e as Error).message;
    }
    const st = sys.status;
    if (st.kind === 'collision') return `${snap.bodies[st.a].name} and ${snap.bodies[st.b].name} overlap.`;
    return null;
  }

  private static systemFrom(snap: SimulationSnapshot): NBodySystem {
    const n = snap.bodies.length;
    const tri = (a: number[], i: number) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]] as const;
    const sys = new NBodySystem({
      gm: snap.gm, radius: snap.radius,
      positions: Array.from({ length: n }, (_, i) => tri(snap.r, i)),
      velocities: Array.from({ length: n }, (_, i) => tri(snap.v, i)),
      frozen: snap.frozen,
    });
    sys.t = snap.t;
    return sys;
  }

  /** Restores a snapshot exactly, including simulated time; clears any halted status. */
  restore(snap: SimulationSnapshot): void {
    const sys = GravitySimulation.systemFrom(snap);
    this.system = sys;
    this._bodies = clone(snap.bodies);
    this.reindex();
    this.clock.reset();
    this.touched();
  }

  /** Restores the documented initial universe: Horizons epoch, catalogue bodies, nothing frozen. */
  reset(): void {
    this._bodies = clone(this.initialBodies as CelestialBodyDef[]);
    this.system = buildSystem(this._bodies);
    this.reindex();
    this.clock.reset();
    this._generation++;
    this.touched();
  }

  /** Total mass of all bodies, kg (from the gravitating GM, so moons of barycentres are included). */
  totalMassKg(): number {
    let gm = 0;
    for (const g of this.system.gm) gm += g;
    return (gm * AU_KM ** 3 * 1e9) / (DAY_S * DAY_S) / G_SI;
  }

  /** Total momentum in the barycentric frame, kg·m/s. */
  totalMomentum(): Vec3 {
    const s = this.system, p: Vec3 = [0, 0, 0];
    for (let i = 0; i < s.n; i++) {
      const m = (s.gm[i] * AU_KM ** 3 * 1e9) / (DAY_S * DAY_S) / G_SI;
      for (let k = 0; k < 3; k++) p[k] += m * s.v[3 * i + k] * (AU_KM * 1000 / DAY_S);
    }
    return p;
  }

  /** Relative energy drift since the epoch; a diagnostic of integration error. */
  energyDrift(reference = buildSystem(this.initialBodies).energy()): number {
    return Math.abs((this.system.energy() - reference) / reference);
  }

  /** Copy of the current physical state, for off-thread path prediction. */
  exportState(): PathRequest {
    return {
      gm: Array.from(this.system.gm), radius: Array.from(this.system.radius),
      r: Array.from(this.system.r), v: Array.from(this.system.v),
      periods: this._bodies.map((b) => b.orbit?.siderealPeriodDays ?? 0),
      ids: this._bodies.map((b) => b.id),
      frozen: Array.from(this.system.frozen, (f) => f === 1),
    };
  }

  /** Synchronous path prediction (see predictPaths). The live simulation is not touched. */
  predictPaths(samplesPerOrbit = 360): Map<string, Vec3[]> {
    return predictPaths(this.exportState(), samplesPerOrbit);
  }
}

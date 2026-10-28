/**
 * Newtonian N-body integrator (velocity Verlet / kick-drift-kick leapfrog).
 *
 * - Pure TypeScript, no rendering dependencies.
 * - State is stored in Float64Arrays in barycentric coordinates: au, au/day.
 * - Accelerations use pairwise Newtonian gravity a_i = Σ_j GM_j (r_j − r_i) / |r_j − r_i|^3.
 * - No softening, no fudge forces. Physical close approaches (separation below the sum of the
 *   physical radii) and any non-finite value halt the integration with an explicit status
 *   rather than producing NaN or "teleporting" bodies.
 *
 * Velocity Verlet is second-order and symplectic: for a fixed timestep the energy error stays
 * bounded and oscillates instead of drifting secularly, which is why it suits long orbital runs.
 */

export type NBodyStatus =
  | { kind: 'ok' }
  | { kind: 'collision'; a: number; b: number; separationAu: number }
  | { kind: 'non-finite' };

export type SetPositionResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-body' | 'non-finite' | 'halted' }
  | { ok: false; reason: 'overlap'; other: number };

export interface NBodyInit {
  /** GM of each body in au^3/day^2. */
  gm: readonly number[];
  /** Physical radius of each body in au, used only for close-approach detection. */
  radius: readonly number[];
  positions: readonly (readonly [number, number, number])[];
  velocities: readonly (readonly [number, number, number])[];
  /** Optional per-body freeze flags (see `frozen`). */
  frozen?: readonly boolean[];
}

export class NBodySystem {
  readonly n: number;
  readonly gm: Float64Array;
  readonly radius: Float64Array;
  readonly r: Float64Array;
  readonly v: Float64Array;
  /**
   * Frozen bodies (god-mode): they keep exerting gravity but are not integrated, so their position
   * stays fixed and their stored velocity is preserved untouched until they are unfrozen.
   */
  readonly frozen: Uint8Array;
  private a: Float64Array;
  // Scratch buffers for rollback, reused to avoid per-step allocation.
  private r0: Float64Array;
  private v0: Float64Array;
  private a0: Float64Array;
  status: NBodyStatus = { kind: 'ok' };
  /** Simulated time since initial conditions, days. */
  t = 0;

  constructor(init: NBodyInit) {
    const n = init.gm.length;
    if (n === 0) throw new Error('N-body system needs at least one body');
    if (init.radius.length !== n || init.positions.length !== n || init.velocities.length !== n)
      throw new Error('N-body init arrays must have equal length');
    for (let i = 0; i < n; i++) {
      if (!(init.gm[i] > 0) || !Number.isFinite(init.gm[i])) throw new Error(`Invalid GM for body ${i}`);
      if (!(init.radius[i] >= 0)) throw new Error(`Invalid radius for body ${i}`);
      for (const c of [...init.positions[i], ...init.velocities[i]])
        if (!Number.isFinite(c)) throw new Error(`Non-finite initial state for body ${i}`);
    }
    this.n = n;
    this.gm = Float64Array.from(init.gm);
    this.radius = Float64Array.from(init.radius);
    this.r = Float64Array.from(init.positions.flat());
    this.v = Float64Array.from(init.velocities.flat());
    this.frozen = Uint8Array.from(init.frozen ?? [], (f) => (f ? 1 : 0));
    if (this.frozen.length !== n) this.frozen = new Uint8Array(n);
    this.a = new Float64Array(3 * n);
    this.r0 = new Float64Array(3 * n);
    this.v0 = new Float64Array(3 * n);
    this.a0 = new Float64Array(3 * n);
    this.computeAccelerations();
  }

  clone(): NBodySystem {
    const c = Object.create(NBodySystem.prototype) as NBodySystem;
    Object.assign(c, {
      n: this.n, gm: this.gm, radius: this.radius,
      r: this.r.slice(), v: this.v.slice(), a: this.a.slice(), frozen: this.frozen.slice(),
      r0: new Float64Array(3 * this.n), v0: new Float64Array(3 * this.n), a0: new Float64Array(3 * this.n),
      status: this.status, t: this.t,
    });
    return c;
  }

  /** Fills this.a. Returns false (and sets status) on a close approach. */
  computeAccelerations(): boolean {
    const { n, r, a, gm, radius } = this;
    a.fill(0);
    for (let i = 0; i < n; i++) {
      const ix = 3 * i;
      for (let j = i + 1; j < n; j++) {
        const jx = 3 * j;
        const dx = r[jx] - r[ix], dy = r[jx + 1] - r[ix + 1], dz = r[jx + 2] - r[ix + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const d = Math.sqrt(d2);
        if (d <= radius[i] + radius[j]) {
          this.status = { kind: 'collision', a: i, b: j, separationAu: d };
          return false;
        }
        const inv3 = 1 / (d2 * d);
        a[ix] += gm[j] * dx * inv3; a[ix + 1] += gm[j] * dy * inv3; a[ix + 2] += gm[j] * dz * inv3;
        a[jx] -= gm[i] * dx * inv3; a[jx + 1] -= gm[i] * dy * inv3; a[jx + 2] -= gm[i] * dz * inv3;
      }
    }
    return true;
  }

  /**
   * Advances by one fixed step `dt` (days). Returns false if the system is halted.
   * On failure the previous state is restored, so the stored state is never corrupted.
   */
  step(dt: number): boolean {
    if (this.status.kind !== 'ok') return false;
    if (!(dt > 0) || !Number.isFinite(dt)) throw new RangeError(`Invalid timestep: ${dt}`);
    const { r, v, a, r0, v0, a0, frozen } = this;
    r0.set(r); v0.set(v); a0.set(a);
    const h = dt / 2;
    for (let k = 0; k < r.length; k++) {
      if (frozen[(k / 3) | 0]) continue;
      v[k] += a[k] * h;
      r[k] += v[k] * dt;
    }
    const ok = this.computeAccelerations();
    if (ok) for (let k = 0; k < r.length; k++) if (!frozen[(k / 3) | 0]) v[k] += a[k] * h;

    let finite = ok;
    if (ok) for (let k = 0; k < r.length; k++) if (!Number.isFinite(r[k]) || !Number.isFinite(v[k])) { finite = false; break; }
    if (!finite) {
      if (this.status.kind === 'ok') this.status = { kind: 'non-finite' };
      r.set(r0); v.set(v0); a.set(a0);
      return false;
    }
    this.t += dt;
    return true;
  }

  /**
   * Moves body `i` to `p` (au), keeping its velocity, GM and radius. Rejected, with the state left
   * untouched, if the position is non-finite, the system is halted, or the body would overlap
   * another body. Accelerations are recomputed so the next step starts from the edited state.
   */
  setPosition(i: number, p: readonly [number, number, number]): SetPositionResult {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) return { ok: false, reason: 'unknown-body' };
    if (!p.every(Number.isFinite)) return { ok: false, reason: 'non-finite' };
    if (this.status.kind !== 'ok') return { ok: false, reason: 'halted' };
    const { r, radius } = this;
    for (let j = 0; j < this.n; j++) {
      if (j === i) continue;
      const d = Math.hypot(r[3 * j] - p[0], r[3 * j + 1] - p[1], r[3 * j + 2] - p[2]);
      if (d <= radius[i] + radius[j]) return { ok: false, reason: 'overlap', other: j };
    }
    r[3 * i] = p[0]; r[3 * i + 1] = p[1]; r[3 * i + 2] = p[2];
    this.computeAccelerations();
    return { ok: true };
  }

  /** Sets body i's velocity (au/day). Position, GM and radius are untouched. */
  setVelocity(i: number, vel: readonly [number, number, number]): SetPositionResult {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) return { ok: false, reason: 'unknown-body' };
    if (!vel.every(Number.isFinite)) return { ok: false, reason: 'non-finite' };
    if (this.status.kind !== 'ok') return { ok: false, reason: 'halted' };
    this.v.set(vel, 3 * i);
    return { ok: true };
  }

  /** Sets body i's gravitational parameter (au^3/day^2) and refreshes accelerations on every body. */
  setGM(i: number, gm: number): SetPositionResult {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) return { ok: false, reason: 'unknown-body' };
    if (!(gm > 0) || !Number.isFinite(gm)) return { ok: false, reason: 'non-finite' };
    if (this.status.kind !== 'ok') return { ok: false, reason: 'halted' };
    this.gm[i] = gm;
    this.computeAccelerations();
    return { ok: true };
  }

  /** Sets body i's physical radius (au), rejecting a radius that would touch another body. */
  setRadius(i: number, radius: number): SetPositionResult {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) return { ok: false, reason: 'unknown-body' };
    if (!(radius > 0) || !Number.isFinite(radius)) return { ok: false, reason: 'non-finite' };
    if (this.status.kind !== 'ok') return { ok: false, reason: 'halted' };
    const { r } = this;
    for (let j = 0; j < this.n; j++) {
      if (j === i) continue;
      const d = Math.hypot(r[3 * j] - r[3 * i], r[3 * j + 1] - r[3 * i + 1], r[3 * j + 2] - r[3 * i + 2]);
      if (d <= radius + this.radius[j]) return { ok: false, reason: 'overlap', other: j };
    }
    this.radius[i] = radius;
    return { ok: true };
  }

  /** Total energy per unit G (au^5/day^2 · …), useful only for relative drift checks. */
  energy(): number {
    const { n, r, v, gm } = this;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const ix = 3 * i;
      e += 0.5 * gm[i] * (v[ix] ** 2 + v[ix + 1] ** 2 + v[ix + 2] ** 2);
      for (let j = i + 1; j < n; j++) {
        const jx = 3 * j;
        e -= (gm[i] * gm[j]) / Math.hypot(r[jx] - r[ix], r[jx + 1] - r[ix + 1], r[jx + 2] - r[ix + 2]);
      }
    }
    return e;
  }

  position(i: number): [number, number, number] {
    return [this.r[3 * i], this.r[3 * i + 1], this.r[3 * i + 2]];
  }

  velocity(i: number): [number, number, number] {
    return [this.v[3 * i], this.v[3 * i + 1], this.v[3 * i + 2]];
  }
}

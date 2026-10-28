/**
 * Fixed-timestep accumulator. Converts wall-clock frame time into an integer number of
 * physics steps of constant size, so simulated results never depend on frame rate.
 */
export const MAX_STEPS_PER_ADVANCE = 4000;
/** Longest frame delta honoured; longer gaps (tab hidden, debugger) are clamped. */
export const MAX_FRAME_SECONDS = 0.25;

export class SimulationClock {
  private accumulator = 0;
  private _rate: number;
  paused = false;
  /** True if the last advance had to drop time because the step budget was exceeded. */
  lagging = false;

  constructor(
    /** Physics step, days. */
    readonly stepDays: number,
    /** Simulated days per real second. */
    rate: number,
  ) {
    if (!(stepDays > 0) || !Number.isFinite(stepDays)) throw new RangeError(`Invalid step: ${stepDays}`);
    this._rate = SimulationClock.checkRate(rate);
  }

  get rate() {
    return this._rate;
  }

  set rate(value: number) {
    this._rate = SimulationClock.checkRate(value);
  }

  private static checkRate(v: number) {
    if (!(v >= 0) || !Number.isFinite(v)) throw new RangeError(`Invalid simulation rate: ${v}`);
    return v;
  }

  /** Returns how many fixed steps to run for `realSeconds` of wall time. */
  advance(realSeconds: number): number {
    if (!Number.isFinite(realSeconds) || realSeconds <= 0 || this.paused) return 0;
    this.accumulator += Math.min(realSeconds, MAX_FRAME_SECONDS) * this._rate;
    let steps = Math.floor(this.accumulator / this.stepDays + 1e-9);
    this.lagging = steps > MAX_STEPS_PER_ADVANCE;
    if (this.lagging) steps = MAX_STEPS_PER_ADVANCE;
    this.accumulator = this.lagging ? 0 : Math.max(0, this.accumulator - steps * this.stepDays);
    return steps;
  }

  reset() {
    this.accumulator = 0;
    this.lagging = false;
  }
}

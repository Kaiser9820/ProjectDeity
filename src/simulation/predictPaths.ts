import { NBodySystem } from '../physics/NBodySystem';
import type { Vec3 } from '../types';

export interface PathRequest {
  ids: string[];
  gm: number[];
  radius: number[];
  /** Flat xyz arrays, au and au/day. */
  r: number[];
  v: number[];
  /** Sidereal period per body in days; 0 = no path. */
  periods: number[];
  /** Frozen flags; frozen bodies stay put in the prediction too. */
  frozen?: boolean[];
}

const tri = (a: number[], i: number) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]] as const;

/**
 * Predicts each body's path by integrating a copy of the given state forward with the same
 * Newtonian model (1-day step, adequate for drawing). Each body is sampled over one sidereal
 * period. Returns barycentric positions in au.
 */
export function predictPaths(req: PathRequest, samplesPerOrbit = 360): Map<string, Vec3[]> {
  const sys = new NBodySystem({
    gm: req.gm, radius: req.radius,
    positions: req.ids.map((_, i) => tri(req.r, i)),
    velocities: req.ids.map((_, i) => tri(req.v, i)),
    frozen: req.frozen,
  });
  const dt = 1;
  const plans = req.ids
    .map((id, i) => ({ id, i, period: req.periods[i], points: [] as Vec3[], nextT: 0 }))
    .filter((p) => p.period > 0);
  if (!plans.length) return new Map();
  const horizon = Math.max(...plans.map((p) => p.period));
  for (let t = 0; t <= horizon + dt; t += dt) {
    for (const p of plans) {
      if (t >= p.nextT && p.points.length <= samplesPerOrbit) {
        p.points.push(sys.position(p.i));
        p.nextT += p.period / samplesPerOrbit;
      }
    }
    if (!sys.step(dt)) break;
  }
  return new Map(plans.map((p) => [p.id, p.points]));
}

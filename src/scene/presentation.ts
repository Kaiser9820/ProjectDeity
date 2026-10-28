import type { CelestialBodyDef, Vec3 } from '../types';
import { AU_KM } from '../physics/units';

/**
 * Presentation-only mapping from physical quantities to scene units.
 * Nothing in this file is ever read by the physics engine.
 *
 * Spatial scale: 1 scene unit = 1 000 000 km (linear, uniform, no compression).
 * Earth's orbit is ≈150 units across, Earth's radius is 0.006371 units.
 *
 * Body sizes are a user-selectable presentation choice (BODY_SCALES). Planets are always
 * magnified by one common factor, so they stay proportional to one another. The Sun gets its own
 * factor, because magnifying it like the planets would swallow Mercury's orbit. Orbits and distances
 * are never scaled. "True" draws planets at real size (Sun ×10).
 */
export const KM_PER_SCENE_UNIT = 1_000_000;
export const SCENE_UNITS_PER_AU = AU_KM / KM_PER_SCENE_UNIT;

export interface BodyScale {
  id: string;
  label: string;
  /** Common magnification of every planet. */
  planet: number;
  /** Magnification of the Sun (kept small enough to stay inside Mercury's perihelion, 46 M km). */
  sun: number;
}

export const BODY_SCALES: readonly BodyScale[] = [
  { id: 'true', label: 'True size', planet: 1, sun: 10 },
  { id: 'x100', label: 'Size ×100', planet: 100, sun: 20 },
  { id: 'x500', label: 'Size ×500', planet: 500, sun: 45 },
  { id: 'x1000', label: 'Size ×1000', planet: 1000, sun: 55 },
];
export const DEFAULT_BODY_SCALE = 'x1000';
export const TRUE_SCALE = BODY_SCALES[0];

export function bodyScaleById(id: string): BodyScale {
  return BODY_SCALES.find((b) => b.id === id) ?? TRUE_SCALE;
}

/**
 * Black holes are drawn far larger than their few-km Schwarzschild radius so they can be seen:
 * 1.5 million km at true size, growing with the size preset (≈4 million km at ×1000).
 */
export const BLACK_HOLE_VISUAL_KM = 1.5e6;

/** Visual magnification applied to a body under a scale preset. Self-luminous bodies use the Sun's factor. */
export function magnification(body: CelestialBodyDef, scale: BodyScale = TRUE_SCALE): number {
  if (body.kind === 'black-hole') return (BLACK_HOLE_VISUAL_KM * Math.max(1, scale.sun / 20)) / body.physical.meanRadiusKm;
  return body.kind === 'star' || body.emissive ? scale.sun : scale.planet;
}

export function kmToScene(km: number): number {
  return km / KM_PER_SCENE_UNIT;
}

/** Physical position (au) relative to an origin (au) → scene units. Pure; does not mutate inputs. */
export function auToScene(p: Readonly<Vec3>, origin: Readonly<Vec3> = [0, 0, 0]): Vec3 {
  return [
    (p[0] - origin[0]) * SCENE_UNITS_PER_AU,
    // Ecliptic J2000 has +z toward the ecliptic north pole; Three.js is y-up.
    (p[2] - origin[2]) * SCENE_UNITS_PER_AU,
    -(p[1] - origin[1]) * SCENE_UNITS_PER_AU,
  ];
}

/** Rendered (mean) radius in scene units under a size preset. Never used by physics. */
export function visualRadius(body: CelestialBodyDef, scale: BodyScale = TRUE_SCALE): number {
  return kmToScene(body.physical.meanRadiusKm) * magnification(body, scale);
}

/** Scene-space displacement → physical displacement in au (inverse of auToScene's axis mapping). */
export function sceneDeltaToAu(d: Readonly<Vec3>): Vec3 {
  return [d[0] / SCENE_UNITS_PER_AU, -d[2] / SCENE_UNITS_PER_AU, d[1] / SCENE_UNITS_PER_AU];
}

/**
 * Gizmo axes: physical ecliptic X, Y, Z expressed as scene directions.
 * X → scene +x, Y → scene −z, Z (ecliptic north) → scene +y.
 */
export const PHYSICAL_AXES = {
  x: { phys: [1, 0, 0] as Vec3, scene: [1, 0, 0] as Vec3 },
  y: { phys: [0, 1, 0] as Vec3, scene: [0, 0, -1] as Vec3 },
  z: { phys: [0, 0, 1] as Vec3, scene: [0, 1, 0] as Vec3 },
} as const;
export type Axis = keyof typeof PHYSICAL_AXES;

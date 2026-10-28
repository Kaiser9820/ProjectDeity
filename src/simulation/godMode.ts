/**
 * God-mode operations. These are deliberate interventions, not natural Newtonian evolution.
 * Each one says exactly what it conserves and what it violates. Each one goes through the
 * GravitySimulation editing API, so the integrator remains the single source of truth.
 */
import type { CelestialBodyDef, Vec3 } from '../types';
import { AU_KM, DAY_S, G_SI } from '../physics/units';
import type { EditResult, GravitySimulation, NewBody } from './GravitySimulation';

export const C_KM_S = 299_792.458;
export const MSUN_KG = 1.98841e30;
const KM_S_TO_AU_D = DAY_S / AU_KM;

const add = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Readonly<Vec3>, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Readonly<Vec3>) => Math.hypot(a[0], a[1], a[2]);

/* ------------------------------------------------------------------ explode */

export const EXPLODE_FRAGMENTS = 8;
export const EXPLODE_FORCE = { min: 1, max: 20, default: 1.5 };

export interface ExplodePlan {
  remove: string[];
  add: NewBody[];
  /** Fragment launch speed relative to the parent, km/s. */
  kickKmS: number;
  /** Kinetic energy injected (god-mode), joules. */
  energyJ: number;
}

/**
 * Splits a body into 8 equal fragments.
 * - Mass: the full gravitating mass (a planet together with any moons folded into its system
 *   barycentre) is shared exactly between 8 fragments of radius R/2. Mass is conserved.
 * - Placement: fragments sit at the corners of a cube, 1.5 R from the old centre. The centre of
 *   mass is unchanged.
 * - Velocity: parent velocity plus a radial kick of force × v_esc, where v_esc = √(2GM/R) is the
 *   parent's surface escape speed. Kicks come in opposite pairs, so total momentum is exactly
 *   conserved.
 * - Energy: the kicks inject ½ M (force·v_esc)² of kinetic energy from nowhere. This is the
 *   nonphysical, god-mode part.
 */
export function planExplosion(sim: GravitySimulation, id: string, force: number): ExplodePlan | { error: string } {
  const def = sim.def(id), st = sim.getState(id);
  if (!def || !st) return { error: `Unknown body "${id}".` };
  if (!(force >= EXPLODE_FORCE.min && force <= EXPLODE_FORCE.max)) return { error: `Force must be between ${EXPLODE_FORCE.min} and ${EXPLODE_FORCE.max}.` };
  if (def.kind === 'black-hole') return { error: `${def.name} is a black hole. Nothing gets out, including a shockwave.` };
  const M = (def.dynamics.gmKm3s2 * 1e9) / G_SI; // gravitating mass, incl. moons of a barycentre
  const R = def.physical.meanRadiusKm;
  const vEsc = Math.sqrt((2 * G_SI * M) / (R * 1e3)) / 1e3; // km/s
  const kick = force * vEsc;
  const m = M / EXPLODE_FRAGMENTS;
  const r = R / Math.cbrt(EXPLODE_FRAGMENTS);
  const add: NewBody[] = [];
  let k = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const dir: Vec3 = scale([sx, sy, sz], 1 / Math.sqrt(3));
    k++;
    const fragId = `${id}~f${k}-${Math.round(sim.time * 1e3)}`;
    const name = `${def.name.replace(/[-~]f\d+$/, '')}-f${k}`;
    const gm = (G_SI * m) / 1e9;
    const frag: CelestialBodyDef = {
      id: fragId,
      name: uniqueName(sim, name),
      kind: 'fragment',
      color: def.color,
      texture: def.texture,
      emissive: def.emissive || def.kind === 'star',
      physical: {
        massKg: m, gmKm3s2: gm, meanRadiusKm: r, equatorialRadiusKm: r,
        meanDensityGcm3: m / ((4 / 3) * Math.PI * (r * 1e3) ** 3) / 1000, siderealRotationHours: def.physical.siderealRotationHours, obliquityDeg: 0,
      },
      dynamics: { horizonsId: '—', horizonsName: `Fragment of ${def.name}`, gmKm3s2: gm },
      godMode: `Fragment ${k}/8 of ${def.name}. Created by explode at force ${force}: mass and momentum conserved, ${fmtJ(0.5 * M * (kick * 1e3) ** 2)} of kinetic energy injected.`,
    };
    add.push({
      def: frag,
      position: add3(st.position, scale(dir, (1.5 * R) / AU_KM)),
      velocity: add3(st.velocity, scale(dir, kick * KM_S_TO_AU_D)),
    });
  }
  return { remove: [id], add, kickKmS: kick, energyJ: 0.5 * M * (kick * 1e3) ** 2 };
}

const add3 = add;

function uniqueName(sim: GravitySimulation, base: string): string {
  const names = new Set(sim.bodies.map((b) => b.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base}.${i}`.toLowerCase())) return `${base}.${i}`;
}

export function fmtJ(j: number): string {
  const e = Math.floor(Math.log10(j));
  return `${(j / 10 ** e).toFixed(1)}e${e} J`;
}

/* ------------------------------------------------------------------ launch */

export type LaunchDir = 'prograde' | 'retrograde' | 'outward' | 'inward' | 'north' | 'south';
export const LAUNCH_DIRS: LaunchDir[] = ['prograde', 'retrograde', 'outward', 'inward', 'north', 'south'];

/**
 * Instant velocity impulse Δv (no reaction mass, so momentum is NOT conserved; god-mode).
 * Directions are relative to the body's motion around the most massive body (usually the Sun);
 * north and south are along the ecliptic pole.
 */
export function launch(sim: GravitySimulation, id: string, dvKmS: number, dir: LaunchDir): EditResult {
  const st = sim.getState(id);
  if (!st) return { ok: false, message: `Unknown body "${id}".` };
  if (!(dvKmS > 0) || dvKmS > C_KM_S * 0.01) return { ok: false, message: `Δv must be between 0 and ${(C_KM_S * 0.01).toFixed(0)} km/s.` };
  const primary = dominantBody(sim, id);
  const ps = primary ? sim.getState(primary)! : { position: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3 };
  const relV: Vec3 = [st.velocity[0] - ps.velocity[0], st.velocity[1] - ps.velocity[1], st.velocity[2] - ps.velocity[2]];
  const relR: Vec3 = [st.position[0] - ps.position[0], st.position[1] - ps.position[1], st.position[2] - ps.position[2]];
  let unit: Vec3;
  switch (dir) {
    case 'prograde': unit = relV; break;
    case 'retrograde': unit = scale(relV, -1); break;
    case 'outward': unit = relR; break;
    case 'inward': unit = scale(relR, -1); break;
    case 'north': unit = [0, 0, 1]; break;
    case 'south': unit = [0, 0, -1]; break;
  }
  const n = norm(unit);
  if (!(n > 0)) return { ok: false, message: `No defined ${dir} direction for this body right now. Try north or south.` };
  return sim.setBodyVelocity(id, add(st.velocity, scale(unit, (dvKmS * KM_S_TO_AU_D) / n)));
}

/** Most massive other body: the reference for prograde/outward directions. */
export function dominantBody(sim: GravitySimulation, id: string): string | null {
  let best: string | null = null, m = -1;
  for (const b of sim.bodies) if (b.id !== id && b.dynamics.gmKm3s2 > m) { m = b.dynamics.gmKm3s2; best = b.id; }
  return best;
}

/* ------------------------------------------------------------------ black hole */

export const BLACKHOLE_MASS = { minMsun: 0.1, maxMsun: 100, defaultMsun: 5 };
export const BLACKHOLE_DEFAULT_AT: Vec3 = [0, 0, 25];

/**
 * A Newtonian point mass with the Schwarzschild radius r_s = 2GM/c² as its collision radius.
 * No relativity is modelled (no event horizon physics, no light bending, no gravitational waves).
 * Mass, position and velocity are explicit, so nothing comes from nowhere except the black hole itself.
 */
export function planBlackHole(sim: GravitySimulation, massKg: number, position: Vec3, velocity: Vec3): NewBody | { error: string } {
  const msun = massKg / MSUN_KG;
  if (!(msun >= BLACKHOLE_MASS.minMsun && msun <= BLACKHOLE_MASS.maxMsun)) return { error: `Black hole mass must be ${BLACKHOLE_MASS.minMsun}–${BLACKHOLE_MASS.maxMsun} Msun.` };
  if (![...position, ...velocity].every(Number.isFinite)) return { error: 'Position and velocity must be finite.' };
  if (norm(velocity) * (AU_KM / DAY_S) >= C_KM_S * 0.05) return { error: 'Black hole speed must stay below 5% of light speed.' };
  let n = 1;
  while (sim.has(`blackhole-${n}`)) n++;
  const gm = (G_SI * massKg) / 1e9;
  const rsKm = (2 * gm) / (C_KM_S * C_KM_S);
  const def: CelestialBodyDef = {
    id: `blackhole-${n}`,
    name: `BH-${n}`,
    kind: 'black-hole',
    color: '#c9a7ff',
    texture: '',
    physical: {
      massKg, gmKm3s2: gm, meanRadiusKm: rsKm, equatorialRadiusKm: rsKm,
      meanDensityGcm3: massKg / ((4 / 3) * Math.PI * (rsKm * 1e3) ** 3) / 1000,
      siderealRotationHours: 0, obliquityDeg: 0,
    },
    dynamics: { horizonsId: '—', horizonsName: 'Spawned by god-mode', gmKm3s2: gm },
    godMode: `Spawned by blackhole spawn. Newtonian point mass of ${msun.toPrecision(3)} Msun with radius r_s = 2GM/c² = ${rsKm.toFixed(1)} km. No relativistic effects are modelled.`,
  };
  return { def, position, velocity };
}

/* ------------------------------------------------------------------ supernova */

/** Fraction of the star's mass left behind as a compact remnant. */
export const SUPERNOVA_REMNANT_FRACTION = 0.3;
export const SUPERNOVA_REMNANT_RADIUS_KM = 7000;

/**
 * Instantaneous mass loss. The star keeps 30% of its mass as an Earth-sized remnant. The other
 * 70% is ejected and leaves the simulation (it no longer gravitates), so mass is deliberately not
 * conserved. Planets keep their positions and velocities. With less than half the central mass
 * left, orbits that were near-circular become unbound. The real Sun is far too light to go
 * supernova; this is fiction.
 */
export function supernova(sim: GravitySimulation, id: string): EditResult & { ejectedKg?: number } {
  const def = sim.def(id);
  if (!def) return { ok: false, message: `Unknown body "${id}".` };
  if (def.kind !== 'star') return { ok: false, message: `${def.name} is not a star.` };
  if (def.godMode?.startsWith('Supernova remnant')) return { ok: false, message: `${def.name} has already gone supernova.` };
  const before = sim.snapshot();
  const M = (def.dynamics.gmKm3s2 * 1e9) / G_SI; // gravitating mass, incl. moons of a barycentre
  const shrink = sim.setBodyRadius(id, SUPERNOVA_REMNANT_RADIUS_KM);
  if (!shrink.ok) return shrink;
  const mass = sim.setBodyMass(id, M * SUPERNOVA_REMNANT_FRACTION);
  if (!mass.ok) {
    sim.restore(before);
    return mass;
  }
  const d = sim.def(id)!;
  d.godMode = `Supernova remnant: ${SUPERNOVA_REMNANT_FRACTION * 100}% of the original mass in a ${SUPERNOVA_REMNANT_RADIUS_KM} km core. ${fmtMass(M * (1 - SUPERNOVA_REMNANT_FRACTION))} was ejected and removed from the simulation (mass not conserved; god-mode).`;
  return { ok: true, ejectedKg: M * (1 - SUPERNOVA_REMNANT_FRACTION) };
}

export function fmtMass(kg: number) {
  return kg >= 1e29 ? `${(kg / MSUN_KG).toPrecision(3)} Msun` : `${kg.toExponential(3)} kg`;
}

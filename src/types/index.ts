/** Shared domain types. Framework-agnostic so physics, parsing and persistence modules can reuse them. */

export type Vec3 = [number, number, number];

export type BodyKind = 'star' | 'terrestrial' | 'gas-giant' | 'ice-giant' | 'fragment' | 'black-hole';

/** Measured physical properties of the body itself (not its satellite system). */
export interface PhysicalProperties {
  massKg: number;
  /** Gravitational parameter of the body alone, km^3/s^2. */
  gmKm3s2: number;
  meanRadiusKm: number;
  equatorialRadiusKm: number;
  meanDensityGcm3: number;
  /** Sidereal rotation period in hours; negative = retrograde. */
  siderealRotationHours: number;
  /** Obliquity to orbit, degrees. */
  obliquityDeg: number;
  geometricAlbedo?: number;
}

/** Reference heliocentric orbital elements (display only; the simulation never reads them). */
export interface ReferenceOrbit {
  semiMajorAxisAu: number;
  eccentricity: number;
  inclinationDeg: number;
  siderealPeriodDays: number;
}

/** How the body enters the N-body model. */
export interface DynamicsSource {
  horizonsId: string;
  horizonsName: string;
  /** GM used for gravity, km^3/s^2. For planets with moons this is the whole system. */
  gmKm3s2: number;
  note?: string;
}

export interface CelestialBodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  /** UI marker colour; not a physical quantity. */
  color: string;
  texture: string;
  physical: PhysicalProperties;
  orbit?: ReferenceOrbit;
  dynamics: DynamicsSource;
  rings?: { innerKm: number; outerKm: number; texture: string };
  /** Self-luminous (stars and fragments of stars). */
  emissive?: boolean;
  /** Set on bodies created or altered by god-mode commands; explains the nonphysical origin. */
  godMode?: string;
}

/** Snapshot of one body read from the simulation. Barycentric ecliptic J2000, au and au/day. */
export interface BodyState {
  id: string;
  position: Vec3;
  velocity: Vec3;
}

export type SimulationStatus =
  | { kind: 'ok' }
  | { kind: 'halted'; reason: string };

/**
 * Contract between the scene/UI and whatever drives motion. Rendering code only reads from it.
 */
export interface Simulation {
  readonly bodies: readonly CelestialBodyDef[];
  /** Julian date (TDB) of the initial conditions. */
  readonly epochJD: number;
  /** Simulated days elapsed since the epoch. */
  readonly time: number;
  /** Simulated days per real second. */
  rate: number;
  paused: boolean;
  readonly status: SimulationStatus;
  /** Advance by wall-clock seconds; the simulation decides how many fixed steps that is. */
  step(realSeconds: number): void;
  getState(id: string): BodyState | undefined;
  reset(): void;
  /** Incremented on reset, so views can rebuild derived data. */
  readonly generation: number;
}

export type TerminalLineKind = 'input' | 'output' | 'system' | 'error' | 'success' | 'warning' | 'muted';

export interface TerminalLine {
  id: number;
  kind: TerminalLineKind;
  text: string;
  prompt?: string;
  /** Epoch milliseconds when the line was written. */
  at: number;
}

export interface Settings {
  reducedMotion: 'system' | 'on' | 'off';
  showOrbits: boolean;
  showLabels: boolean;
  /** Simulated days per real second. */
  rate: number;
  /** Id from BODY_SCALES (presentation only). */
  bodyScale: string;
}
